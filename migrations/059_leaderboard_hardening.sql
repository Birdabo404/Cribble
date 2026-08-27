-- ============================================================
-- Migration 059: Canonical leaderboard ranking and snapshots
-- ============================================================
-- One database function now owns live leaderboard eligibility,
-- score selection, ordering, tie-breaking and the top-100 limit.
-- Both the API and the snapshot refresher consume that function.
--
-- Snapshot refresh is a single transaction (one RPC call), serialized
-- with an advisory transaction lock. The refresh stages one canonical
-- standing, removes users who fell out of the top 100, and upserts all
-- changed rows atomically so readers never observe a half-applied rank
-- movement.
-- ============================================================

CREATE OR REPLACE FUNCTION public.leaderboard_standings(
    p_board TEXT DEFAULT 'season',
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    user_id INTEGER,
    rank INTEGER,
    score BIGINT,
    total_score BIGINT,
    today_score BIGINT,
    week_score BIGINT,
    season_score BIGINT,
    last_calculated_at TIMESTAMPTZ,
    top_tools JSONB,
    twitter_username TEXT,
    twitter_name TEXT,
    twitter_profile_image TEXT,
    created_at TIMESTAMPTZ,
    last_extension_sync TIMESTAMPTZ,
    subscription_tier TEXT,
    user_type TEXT,
    metadata JSONB,
    device_last_sync_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_season_start TIMESTAMPTZ;
BEGIN
    IF p_board IS NULL OR p_board NOT IN ('season', 'alltime') THEN
        RAISE EXCEPTION 'Invalid leaderboard board: %', p_board
            USING ERRCODE = '22023';
    END IF;
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Leaderboard limit must be between 1 and 100'
            USING ERRCODE = '22023';
    END IF;

    IF p_board = 'season' THEN
        SELECT season.starts_at
        INTO v_season_start
        FROM public.seasons AS season
        WHERE season.status = 'active'
        ORDER BY season.number
        LIMIT 1;
    END IF;

    RETURN QUERY
    WITH ranked AS (
        SELECT
            scores.user_id AS ranked_user_id,
            ROW_NUMBER() OVER (
                ORDER BY
                    CASE
                        WHEN p_board = 'season' AND v_season_start IS NOT NULL
                            THEN COALESCE(scores.season_score, 0)
                        ELSE COALESCE(scores.total_score, 0)
                    END DESC,
                    scores.user_id ASC
            )::INTEGER AS canonical_rank,
            CASE
                WHEN p_board = 'season' AND v_season_start IS NOT NULL
                    THEN COALESCE(scores.season_score, 0)::BIGINT
                ELSE COALESCE(scores.total_score, 0)::BIGINT
            END AS canonical_score
        FROM public.user_scores AS scores
        INNER JOIN public.users AS account
            ON account.id = scores.user_id
        WHERE (account.status IS NULL OR account.status = 'active')
          AND (
              p_board = 'alltime'
              OR v_season_start IS NULL
              OR scores.last_calculated_at >= v_season_start
          )
    ),
    top_ranked AS MATERIALIZED (
        SELECT
            ranked.ranked_user_id,
            ranked.canonical_rank,
            ranked.canonical_score
        FROM ranked
        WHERE ranked.canonical_rank <= p_limit
    )
    SELECT
        top_ranked.ranked_user_id,
        top_ranked.canonical_rank,
        top_ranked.canonical_score,
        COALESCE(scores.total_score, 0)::BIGINT,
        COALESCE(scores.today_score, 0)::BIGINT,
        COALESCE(scores.week_score, 0)::BIGINT,
        COALESCE(scores.season_score, 0)::BIGINT,
        scores.last_calculated_at,
        scores.top_tools,
        account.twitter_username::TEXT,
        account.twitter_name::TEXT,
        account.twitter_profile_image,
        account.created_at AT TIME ZONE 'UTC',
        account.last_extension_sync,
        account.subscription_tier::TEXT,
        account.user_type::TEXT,
        account.metadata,
        (
            SELECT MAX(device.last_sync_at)
            FROM public.user_devices AS device
            WHERE device.user_id = top_ranked.ranked_user_id
        )
    FROM top_ranked
    INNER JOIN public.user_scores AS scores
        ON scores.user_id = top_ranked.ranked_user_id
    INNER JOIN public.users AS account
        ON account.id = top_ranked.ranked_user_id
    ORDER BY top_ranked.canonical_rank;
END;
$$;

COMMENT ON FUNCTION public.leaderboard_standings(TEXT, INTEGER) IS
    'Canonical live leaderboard ranking. Owns eligibility, season staleness, score ordering, user-id tie-break and top-100 limiting.';

REVOKE ALL ON FUNCTION public.leaderboard_standings(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leaderboard_standings(TEXT, INTEGER)
    TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_leaderboard_snapshot()
RETURNS TABLE (
    user_id INTEGER,
    rank INTEGER,
    score BIGINT,
    prev_rank INTEGER,
    rank_moved_at TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    refreshed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ;
    v_bootstrap BOOLEAN;
BEGIN
    -- Blocking is intentional. If sync B updates a score while sync A is
    -- refreshing, B waits and then publishes a second snapshot containing
    -- its own committed score instead of skipping the only refresh that
    -- could have observed it.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('cribble:leaderboard-snapshot-refresh', 0)
    );
    v_now := clock_timestamp();

    -- During intermission the API serves immutable season_results. Leave
    -- the movement ledger frozen until season_tick clears it at next start.
    IF EXISTS (SELECT 1 FROM public.seasons)
       AND NOT EXISTS (
           SELECT 1
           FROM public.seasons AS season
           WHERE season.status = 'active'
       )
    THEN
        RETURN;
    END IF;

    SELECT NOT EXISTS (SELECT 1 FROM public.leaderboard_ranks)
    INTO v_bootstrap;

    RETURN QUERY
    WITH standings AS MATERIALIZED (
        SELECT
            canonical.user_id AS standing_user_id,
            canonical.rank AS standing_rank,
            canonical.score AS standing_score
        FROM public.leaderboard_standings('season', 100) AS canonical
    ),
    stale AS (
        DELETE FROM public.leaderboard_ranks AS old_snapshot
        WHERE NOT EXISTS (
            SELECT 1
            FROM standings
            WHERE standings.standing_user_id = old_snapshot.user_id
        )
        RETURNING old_snapshot.user_id
    ),
    changed AS (
        INSERT INTO public.leaderboard_ranks AS current_snapshot (
            user_id,
            rank,
            score,
            prev_rank,
            rank_moved_at,
            first_seen_at,
            updated_at
        )
        SELECT
            standings.standing_user_id,
            standings.standing_rank,
            standings.standing_score,
            NULL,
            NULL,
            CASE
                WHEN v_bootstrap THEN v_now - INTERVAL '48 hours'
                ELSE v_now
            END,
            v_now
        FROM standings
        ON CONFLICT ON CONSTRAINT leaderboard_ranks_pkey DO UPDATE
        SET
            rank = EXCLUDED.rank,
            score = EXCLUDED.score,
            prev_rank = CASE
                WHEN current_snapshot.rank IS DISTINCT FROM EXCLUDED.rank
                    THEN current_snapshot.rank
                ELSE current_snapshot.prev_rank
            END,
            rank_moved_at = CASE
                WHEN current_snapshot.rank IS DISTINCT FROM EXCLUDED.rank
                    THEN v_now
                ELSE current_snapshot.rank_moved_at
            END,
            updated_at = v_now
        WHERE current_snapshot.rank IS DISTINCT FROM EXCLUDED.rank
           OR current_snapshot.score IS DISTINCT FROM EXCLUDED.score
        RETURNING
            current_snapshot.user_id,
            current_snapshot.rank,
            current_snapshot.score,
            current_snapshot.prev_rank,
            current_snapshot.rank_moved_at,
            current_snapshot.first_seen_at,
            current_snapshot.updated_at
    )
    SELECT
        changed.user_id,
        changed.rank,
        changed.score,
        changed.prev_rank,
        changed.rank_moved_at,
        changed.first_seen_at,
        changed.updated_at,
        v_now
    FROM changed
    ORDER BY changed.rank;
END;
$$;

COMMENT ON FUNCTION public.refresh_leaderboard_snapshot() IS
    'Transactionally refreshes the canonical top-100 rank ledger under an advisory lock and deletes stale rows.';

REVOKE ALL ON FUNCTION public.refresh_leaderboard_snapshot()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_leaderboard_snapshot()
    TO service_role;
