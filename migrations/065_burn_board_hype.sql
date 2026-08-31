-- ============================================================
-- Migration 065: Burn Board hype
-- ============================================================
-- The billboard learns to celebrate the Burn Board (the CLI token
-- leaderboard, migrations 041/047/057): burn rank breakthroughs
-- (burn_throne / burn_top3 / burn_top10, with "outburned" victims)
-- and forever-once $-milestone burn clubs (burn_club), riding the
-- same billboard_hype_events table 052 built for the score board.
--
-- Three pieces:
--   1. billboard_hype_events grows the burn kinds and a burn_usd
--      column (the celebrant's season burn at climb time).
--   2. burn_board_ranks — the burn twin of leaderboard_ranks (012):
--      one row per ranked opted-in player, tracking rank movement.
--   3. refresh_burn_board_snapshot(...) — the burn twin of
--      refresh_leaderboard_snapshot (060): advisory-locked recompute
--      + diff + stale delete returning only changed rows — plus
--      agent_lifetime_burn(user) feeding the club crossings.
-- Safe to run multiple times.
-- ============================================================

-- 1a. Widen the kind CHECK. It was declared inline in 052's CREATE
--     TABLE, so Postgres auto-named it; DROP + re-ADD keeps the pair
--     idempotent (the same treatment 064 gave team_affiliations).
ALTER TABLE billboard_hype_events
    DROP CONSTRAINT IF EXISTS billboard_hype_events_kind_check;
ALTER TABLE billboard_hype_events
    ADD CONSTRAINT billboard_hype_events_kind_check
    CHECK (kind IN (
        'throne', 'top3', 'top10', 'club',
        'burn_throne', 'burn_top3', 'burn_top10', 'burn_club'
    ));

-- 1b. The celebrant's SEASON burn at climb time, captured so the
--     announcement can flaunt the dollar figure. Burn rank kinds
--     only; NULL on score kinds and on burn_club rows (their story
--     is the crossed threshold, already carried as whole dollars in
--     the existing threshold column).
ALTER TABLE billboard_hype_events ADD COLUMN IF NOT EXISTS burn_usd NUMERIC;

-- 2. The Burn Board's movement ledger. Same shape and lifecycle as
--    leaderboard_ranks minus the score column: burn_usd is the
--    standing's measure. Rows exist only for currently ranked
--    (opted-in, active, total_tokens > 0) players — the refresher
--    deletes everyone else, which is how an opt-out leaves the board.
CREATE TABLE IF NOT EXISTS burn_board_ranks (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    -- Season-window burn backing the rank — exact NUMERIC, the same
    -- money type the usage tables carry.
    burn_usd NUMERIC NOT NULL,
    prev_rank INTEGER,
    rank_moved_at TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS with no policies + revoked grants: service-role only, the same
-- lockdown as billboard_hype_events (052).
ALTER TABLE burn_board_ranks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE burn_board_ranks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE burn_board_ranks TO service_role;

-- 3. Transactional snapshot refresh, mirroring the contract of
--    refresh_leaderboard_snapshot (060): advisory lock, canonical
--    standing, stale-row delete, diffing upsert, and a result set of
--    only inserted/changed rows all stamped with one refreshed_at so
--    the caller's hype derivation can identify movements from THIS
--    pass. The window arrives as parameters because the burn board's
--    season window is resolved in application code (the same
--    p_since/p_until + p_since_at/p_until_at split as
--    agent_token_leaderboard): exact timestamps win for v2 events,
--    legacy daily rows bucket by date. No timezone parameter — this
--    is the canonical server snapshot, and legacy dates gate at UTC.
CREATE OR REPLACE FUNCTION public.refresh_burn_board_snapshot(
    p_since DATE DEFAULT NULL,
    p_until DATE DEFAULT NULL,
    p_since_at TIMESTAMPTZ DEFAULT NULL,
    p_until_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    user_id INTEGER,
    rank INTEGER,
    burn_usd NUMERIC,
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
    -- Blocking is intentional, same as the score refresher: if sync B
    -- lands usage while sync A is refreshing, B waits and then
    -- publishes a second snapshot containing its own committed rows
    -- instead of skipping the only refresh that could observe them.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('cribble:burn-board-snapshot-refresh', 0)
    );
    v_now := clock_timestamp();

    -- Deliberately NO intermission freeze, unlike 060: the Burn Board
    -- keeps serving the completed season's window during intermission
    -- (resolveTokenBoardWindow pins season.current to it), so the
    -- caller's params freeze the standing naturally — and season_tick
    -- never clears this ledger, so a hard freeze here would make the
    -- first refresh of a NEW season diff against last season's ranks.

    SELECT NOT EXISTS (SELECT 1 FROM public.burn_board_ranks)
    INTO v_bootstrap;

    RETURN QUERY
    -- Consent gate + facts split copied from agent_token_leaderboard
    -- (057): opted-in v2 consenters only; legacy daily rows count only
    -- for clients still on schema v1 (v2 clients' history lives in
    -- events), exact v2 events for the rest. Burn needs none of 057's
    -- agent/model machinery, so the standing stays lean.
    WITH enabled_users AS (
        SELECT sharing.user_id AS enabled_user_id
        FROM public.agent_usage_sharing AS sharing
        WHERE sharing.leaderboard_enabled
          AND sharing.consent_version >= 2
    ),
    legacy AS (
        SELECT
            usage.user_id AS fact_user_id,
            usage.output_tokens::NUMERIC AS fact_output_tokens,
            usage.total_tokens::NUMERIC AS fact_total_tokens,
            usage.cost_usd AS fact_cost_usd
        FROM public.agent_usage_daily AS usage
        INNER JOIN enabled_users
            ON enabled_users.enabled_user_id = usage.user_id
        LEFT JOIN public.agent_usage_clients AS clients
            ON clients.user_id = usage.user_id
           AND clients.client_id = usage.client_id
        WHERE (p_since IS NULL OR usage.date >= p_since)
          AND (p_until IS NULL OR usage.date <= p_until)
          AND COALESCE(clients.schema_version, 1) < 2
    ),
    events AS (
        SELECT
            event.user_id AS fact_user_id,
            event.output_tokens::NUMERIC AS fact_output_tokens,
            event.total_tokens::NUMERIC AS fact_total_tokens,
            event.cost_usd AS fact_cost_usd
        FROM public.agent_usage_events AS event
        INNER JOIN enabled_users
            ON enabled_users.enabled_user_id = event.user_id
        WHERE (
                (p_since_at IS NOT NULL AND event.occurred_at >= p_since_at)
                OR (
                    p_since_at IS NULL
                    AND (
                        p_since IS NULL
                        OR event.occurred_at >= (
                            p_since::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'UTC'
                        )
                    )
                )
            )
          AND (
                (p_until_at IS NOT NULL AND event.occurred_at < p_until_at)
                OR (
                    p_until_at IS NULL
                    AND (
                        p_until IS NULL
                        OR event.occurred_at < (
                            (p_until + 1)::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'UTC'
                        )
                    )
                )
            )
    ),
    facts AS (
        SELECT
            legacy.fact_user_id,
            legacy.fact_output_tokens,
            legacy.fact_total_tokens,
            legacy.fact_cost_usd
        FROM legacy
        UNION ALL
        SELECT
            events.fact_user_id,
            events.fact_output_tokens,
            events.fact_total_tokens,
            events.fact_cost_usd
        FROM events
    ),
    totals AS (
        SELECT
            facts.fact_user_id,
            SUM(facts.fact_cost_usd) AS total_cost_usd,
            SUM(facts.fact_total_tokens) AS total_total_tokens,
            SUM(facts.fact_output_tokens) AS total_output_tokens
        FROM facts
        GROUP BY facts.fact_user_id
    ),
    -- Canonical burn standing: EXACTLY buildTokenBoard's ordering
    -- (cost desc, total tokens desc, output tokens desc, user id asc)
    -- and its total_tokens > 0 filter, active accounts only — the
    -- snapshot rank must match the rank the Burn Board renders.
    standings AS MATERIALIZED (
        SELECT
            totals.fact_user_id AS standing_user_id,
            ROW_NUMBER() OVER (
                ORDER BY
                    totals.total_cost_usd DESC,
                    totals.total_total_tokens DESC,
                    totals.total_output_tokens DESC,
                    totals.fact_user_id ASC
            )::INTEGER AS standing_rank,
            totals.total_cost_usd AS standing_burn
        FROM totals
        INNER JOIN public.users AS account
            ON account.id = totals.fact_user_id
           AND account.status = 'active'
        WHERE totals.total_total_tokens > 0
    ),
    stale AS (
        DELETE FROM public.burn_board_ranks AS old_snapshot
        WHERE NOT EXISTS (
            SELECT 1
            FROM standings
            WHERE standings.standing_user_id = old_snapshot.user_id
        )
        RETURNING old_snapshot.user_id
    ),
    changed AS (
        INSERT INTO public.burn_board_ranks AS current_snapshot (
            user_id,
            rank,
            burn_usd,
            prev_rank,
            rank_moved_at,
            first_seen_at,
            updated_at
        )
        SELECT
            standings.standing_user_id,
            standings.standing_rank,
            standings.standing_burn,
            NULL,
            NULL,
            -- Bootstrap backdates first_seen_at past the 48h entrant
            -- window so the first tracked pass can't flash NEW chips
            -- or (via prev_rank NULL) invent climbs.
            CASE
                WHEN v_bootstrap THEN v_now - INTERVAL '48 hours'
                ELSE v_now
            END,
            v_now
        FROM standings
        ON CONFLICT ON CONSTRAINT burn_board_ranks_pkey DO UPDATE
        SET
            rank = EXCLUDED.rank,
            burn_usd = EXCLUDED.burn_usd,
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
           OR current_snapshot.burn_usd IS DISTINCT FROM EXCLUDED.burn_usd
        RETURNING
            current_snapshot.user_id,
            current_snapshot.rank,
            current_snapshot.burn_usd,
            current_snapshot.prev_rank,
            current_snapshot.rank_moved_at,
            current_snapshot.first_seen_at,
            current_snapshot.updated_at
    )
    SELECT
        changed.user_id,
        changed.rank,
        changed.burn_usd,
        changed.prev_rank,
        changed.rank_moved_at,
        changed.first_seen_at,
        changed.updated_at,
        v_now
    FROM changed
    ORDER BY changed.rank;
END;
$$;

COMMENT ON FUNCTION public.refresh_burn_board_snapshot(DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ) IS
    'Transactionally refreshes the Burn Board rank ledger (burn_board_ranks) under an advisory lock: recomputes the season-window burn standing with buildTokenBoard''s exact ordering, deletes stale rows and returns only inserted/changed rows with one refreshed_at.';

REVOKE ALL ON FUNCTION public.refresh_burn_board_snapshot(DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_burn_board_snapshot(DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ)
    TO service_role;

-- 4. Lifetime burn for the club crossings: sum cost_usd across the
--    same legacy + events split, no window. The usage route reads it
--    on both sides of an ingest and celebrates the BURN_CLUB_THRESHOLDS
--    crossed in between. No consent gate here — the caller gates on
--    the sharing opt-in before celebrating; keeping the read dumb
--    keeps it cheap.
CREATE OR REPLACE FUNCTION public.agent_lifetime_burn(p_user_id INTEGER)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT SUM(usage.cost_usd)
        FROM public.agent_usage_daily AS usage
        LEFT JOIN public.agent_usage_clients AS clients
            ON clients.user_id = usage.user_id
           AND clients.client_id = usage.client_id
        WHERE usage.user_id = p_user_id
          AND COALESCE(clients.schema_version, 1) < 2
    ), 0)
    + COALESCE((
        SELECT SUM(event.cost_usd)
        FROM public.agent_usage_events AS event
        WHERE event.user_id = p_user_id
    ), 0);
$$;

COMMENT ON FUNCTION public.agent_lifetime_burn(INTEGER) IS
    'One user''s lifetime agent burn in USD: legacy daily rows from schema-v1 clients plus every v2 event, no window. Feeds burn-club threshold crossings.';

REVOKE ALL ON FUNCTION public.agent_lifetime_burn(INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_lifetime_burn(INTEGER)
    TO service_role;

-- PostgREST caches function signatures. CREATE OR REPLACE is not
-- enough; without a reload, the new RPCs return PGRST202 until the
-- API restarts.
NOTIFY pgrst, 'reload schema';
