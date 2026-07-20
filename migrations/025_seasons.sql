-- ============================================================
-- Migration 025: Season lifecycle
-- ============================================================
-- Seasons stop being a hardcoded UI constant and become data:
--   - seasons: the calendar (upcoming | active | complete).
--     "Intermission" is derived — no active row, next one upcoming.
--   - season_results: final standings archived once at close.
--   - user_scores.season_score: the season-window score the
--     leaderboard ranks by (written by the same v3 TS recalc that
--     maintains total/today/week, see src/lib/scoring.ts).
--   - season_tick(): the whole lifecycle in one idempotent
--     function — ending notices (7d/3d/24h), close (archive +
--     placements + auto-schedule next), start (reset + fan-out).
--   - pg_cron runs the tick every 15 minutes;
--     /api/cron/season (CRON_SECRET) is the manual backup trigger.
--
-- Close snapshots user_scores.season_score rather than recomputing
-- from events_raw: the SQL v1 formula below is legacy/opt-in and
-- does NOT match the session-based v3 scores users watched on the
-- board all season. Late syncs after close don't move the archive —
-- standings lock at the horn.
--
-- Seeds SEASON 01 as active, 2026-04-01 → 2026-10-01 UTC (the old
-- constant's Jul 1 end was a placeholder that already expired).
-- Safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. SEASONS
-- ============================================================
CREATE TABLE IF NOT EXISTS seasons (
    id SERIAL PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE CHECK (number > 0),
    name TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'upcoming'
        CHECK (status IN ('upcoming', 'active', 'complete')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons(status);

-- RLS with no policies: only the service role (used by the app's
-- API routes) can read or write seasons.
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. SEASON RESULTS (final standings, written once at close)
-- ============================================================
CREATE TABLE IF NOT EXISTS season_results (
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    final_rank INTEGER NOT NULL,
    final_score BIGINT NOT NULL DEFAULT 0,
    -- Denormalized so a single row can render "#3 of 41".
    total_players INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (season_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_season_results_rank
    ON season_results(season_id, final_rank);

ALTER TABLE season_results ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. SEASON SCORE COLUMN
-- ============================================================
ALTER TABLE user_scores ADD COLUMN IF NOT EXISTS season_score INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_user_scores_season ON user_scores(season_score DESC);

-- ============================================================
-- 4. LEGACY SCORE RPC LEARNS THE SEASON WINDOW
-- ============================================================
-- Still the v1 formula and still opt-in only (ENABLE_LEGACY_SCORE_RPC);
-- the shipping path is the TS v3 recalc. Updated so the opt-in path
-- doesn't silently zero season_score. CREATE OR REPLACE keeps the
-- migration 014 grants (service_role only).
CREATE OR REPLACE FUNCTION recalculate_user_score(p_user_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_today BIGINT;
  v_week BIGINT;
  v_month BIGINT;
  v_season BIGINT := 0;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  -- Total score (all time)
  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_total
    FROM events_raw WHERE user_id = p_user_id;

  -- Today score
  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_today
    FROM events_raw
    WHERE user_id = p_user_id
      AND timestamp >= date_trunc('day', NOW());

  -- Week score
  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_week
    FROM events_raw
    WHERE user_id = p_user_id
      AND timestamp >= NOW() - INTERVAL '7 days';

  -- Month score
  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_month
    FROM events_raw
    WHERE user_id = p_user_id
      AND timestamp >= NOW() - INTERVAL '30 days';

  -- Season score (active season window; 0 during intermission)
  SELECT starts_at, ends_at INTO v_start, v_end
    FROM seasons WHERE status = 'active' ORDER BY number LIMIT 1;
  IF FOUND THEN
    SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
      INTO v_season
      FROM events_raw
      WHERE user_id = p_user_id
        AND timestamp >= v_start AND timestamp < v_end;
  END IF;

  -- Upsert into user_scores
  INSERT INTO user_scores (user_id, total_score, today_score, week_score, month_score, season_score, last_calculated_at, created_at, updated_at)
  VALUES (p_user_id, v_total, v_today, v_week, v_month, v_season, NOW(), NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    total_score = EXCLUDED.total_score,
    today_score = EXCLUDED.today_score,
    week_score = EXCLUDED.week_score,
    month_score = EXCLUDED.month_score,
    season_score = EXCLUDED.season_score,
    last_calculated_at = NOW(),
    updated_at = NOW();
END;
$$;

-- ============================================================
-- 5. SEASON TICK — the entire lifecycle, idempotent
-- ============================================================
CREATE OR REPLACE FUNCTION season_tick()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_actions JSONB := '[]'::jsonb;
  v_season seasons%ROWTYPE;
  v_next seasons%ROWTYPE;
  v_players INTEGER;
  v_inserted INTEGER;
  v_next_number INTEGER;
  v_next_starts TIMESTAMPTZ;
  v_next_ends TIMESTAMPTZ;
  v_remaining INTERVAL;
  v_days INTEGER;
  v_key TEXT;
  v_title TEXT;
  v_body TEXT;
BEGIN
  -- pg_cron and the manual /api/cron/season route can overlap; only
  -- one tick may run at a time.
  IF NOT pg_try_advisory_xact_lock(hashtext('season_tick')::BIGINT) THEN
    RETURN jsonb_build_object('skipped', 'concurrent tick holds the lock');
  END IF;

  ------------------------------------------------------------
  -- CLOSE: any active season past its end.
  ------------------------------------------------------------
  FOR v_season IN
    SELECT * FROM seasons
    WHERE status = 'active' AND ends_at <= v_now
    ORDER BY number
  LOOP
    UPDATE seasons SET status = 'complete', updated_at = v_now
      WHERE id = v_season.id;

    -- Archive final standings from the same column the live board
    -- ranked by. last_calculated_at guard drops rows whose score
    -- predates this season (never synced since it started); ties
    -- break by user id — the same rule as the leaderboard route.
    WITH standings AS (
      SELECT s.user_id,
             s.season_score,
             ROW_NUMBER() OVER (ORDER BY s.season_score DESC, s.user_id ASC) AS rnk,
             COUNT(*) OVER () AS total
        FROM user_scores s
        JOIN users u ON u.id = s.user_id
       WHERE s.season_score > 0
         AND s.last_calculated_at >= v_season.starts_at
         AND (u.status IS NULL OR u.status = 'active')
    )
    INSERT INTO season_results (season_id, user_id, final_rank, final_score, total_players)
    SELECT v_season.id, user_id, rnk, season_score, total
      FROM standings
    ON CONFLICT (season_id, user_id) DO NOTHING;

    SELECT COUNT(*)::INT INTO v_players
      FROM season_results WHERE season_id = v_season.id;

    -- Broadcast the close to every active account.
    INSERT INTO notifications (user_id, type, title, body, data, dedupe_key)
    SELECT u.id, 'season',
           v_season.name || ' COMPLETE',
           'The season has ended. Final standings are locked on the leaderboard.',
           jsonb_build_object('season', v_season.name, 'seasonNumber', v_season.number),
           'season_' || v_season.number || '_complete'
      FROM users u
     WHERE (u.status IS NULL OR u.status = 'active')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    -- Personal placements for everyone on the final board.
    INSERT INTO notifications (user_id, type, title, body, data, dedupe_key)
    SELECT r.user_id, 'season',
           CASE WHEN r.final_rank = 1
                THEN v_season.name || ' CHAMPION'
                ELSE 'FINAL PLACEMENT — #' || r.final_rank
           END,
           CASE WHEN r.final_rank = 1
                THEN 'You finished #1 of ' || r.total_players || '. The crown is yours.'
                ELSE 'You finished #' || r.final_rank || ' of ' || r.total_players || ' with ' || r.final_score || ' points.'
           END,
           jsonb_build_object(
             'season', v_season.name, 'seasonNumber', v_season.number,
             'rank', r.final_rank, 'score', r.final_score,
             'totalPlayers', r.total_players
           ),
           'season_' || v_season.number || '_result'
      FROM season_results r
     WHERE r.season_id = v_season.id
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    -- Auto-schedule the next season unless the admin already has:
    -- 3-day intermission, then run to the end of that quarter (with
    -- a floor so a degenerate sliver of a season never auto-ships).
    IF NOT EXISTS (SELECT 1 FROM seasons WHERE status = 'upcoming') THEN
      SELECT COALESCE(MAX(number), 0) + 1 INTO v_next_number FROM seasons;
      v_next_starts := v_season.ends_at + INTERVAL '3 days';
      v_next_ends := date_trunc('quarter', v_next_starts) + INTERVAL '3 months';
      IF v_next_ends - v_next_starts < INTERVAL '30 days' THEN
        v_next_ends := v_next_ends + INTERVAL '3 months';
      END IF;
      INSERT INTO seasons (number, name, starts_at, ends_at, status)
      VALUES (
        v_next_number,
        'SEASON ' || lpad(v_next_number::TEXT, 2, '0'),
        v_next_starts,
        v_next_ends,
        'upcoming'
      );
    END IF;

    v_actions := v_actions || jsonb_build_object('closed', v_season.name, 'players', v_players);
  END LOOP;

  ------------------------------------------------------------
  -- START: the next upcoming season whose time has come.
  ------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM seasons WHERE status = 'active') THEN
    SELECT * INTO v_next
      FROM seasons
     WHERE status = 'upcoming' AND starts_at <= v_now
     ORDER BY number
     LIMIT 1;

    IF FOUND THEN
      UPDATE seasons SET status = 'active', updated_at = v_now
        WHERE id = v_next.id;

      -- Fresh board: season scores to zero, movement baselines gone
      -- (everyone re-enters as NEW on the first read of the season).
      UPDATE user_scores SET season_score = 0, updated_at = v_now
        WHERE season_score <> 0;
      DELETE FROM leaderboard_ranks;

      INSERT INTO notifications (user_id, type, title, body, data, dedupe_key)
      SELECT u.id, 'season',
             v_next.name || ' IS LIVE',
             'Scores have reset. The board is open — climb.',
             jsonb_build_object('season', v_next.name, 'seasonNumber', v_next.number),
             'season_' || v_next.number || '_live'
        FROM users u
       WHERE (u.status IS NULL OR u.status = 'active')
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

      v_actions := v_actions || jsonb_build_object('started', v_next.name);
    END IF;
  END IF;

  ------------------------------------------------------------
  -- ENDING NOTICES: 7d / 3d / 24h before the end. Only the
  -- tightest applicable window fans out, so a user who joins
  -- late gets one ping, not three stacked.
  ------------------------------------------------------------
  SELECT * INTO v_season
    FROM seasons WHERE status = 'active' ORDER BY number LIMIT 1;

  IF FOUND THEN
    v_remaining := v_season.ends_at - v_now;
    v_days := CEIL(EXTRACT(EPOCH FROM v_remaining) / 86400.0)::INT;
    v_key := NULL;

    IF v_remaining > INTERVAL '0 seconds' AND v_remaining <= INTERVAL '24 hours' THEN
      v_key := 'season_' || v_season.number || '_ending_24h';
      v_title := v_season.name || ' — FINAL 24 HOURS';
      v_body := 'Standings lock within 24 hours. Last climb.';
    ELSIF v_remaining > INTERVAL '0 seconds' AND v_remaining <= INTERVAL '3 days' THEN
      v_key := 'season_' || v_season.number || '_ending_3d';
      v_title := v_season.name || ' — FINAL DAYS';
      v_body := v_days || CASE WHEN v_days = 1 THEN ' day' ELSE ' days' END
                || ' left. Standings lock soon.';
    ELSIF v_remaining > INTERVAL '0 seconds' AND v_remaining <= INTERVAL '7 days' THEN
      v_key := 'season_' || v_season.number || '_ending_7d';
      v_title := v_season.name || ' — FINAL WEEK';
      v_body := v_days || ' days left to climb before standings lock.';
    END IF;

    IF v_key IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, body, data, dedupe_key)
      SELECT u.id, 'season', v_title, v_body,
             jsonb_build_object('season', v_season.name, 'seasonNumber', v_season.number, 'daysLeft', v_days),
             v_key
        FROM users u
       WHERE (u.status IS NULL OR u.status = 'active')
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted > 0 THEN
        v_actions := v_actions || jsonb_build_object('ending_notice', v_key, 'notified', v_inserted);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ranAt', v_now, 'actions', v_actions);
END;
$$;

-- Same hardening as migration 014: only the service role may execute.
REVOKE ALL ON FUNCTION season_tick() FROM PUBLIC;
REVOKE ALL ON FUNCTION season_tick() FROM anon;
REVOKE ALL ON FUNCTION season_tick() FROM authenticated;
GRANT EXECUTE ON FUNCTION season_tick() TO service_role;

-- ============================================================
-- 6. SCHEDULE: pg_cron runs the tick every 15 minutes.
-- ============================================================
-- cron.schedule upserts by job name, so re-running is safe.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('season-tick', '*/15 * * * *', 'SELECT public.season_tick()');

-- ============================================================
-- 7. SEED SEASON 01 (first run only)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM seasons) THEN
    INSERT INTO seasons (number, name, starts_at, ends_at, status)
    VALUES (1, 'SEASON 01', '2026-04-01T00:00:00+00', '2026-10-01T00:00:00+00', 'active');

    -- Every live event falls inside the seeded window (verified at
    -- migration time), so the lifetime total IS the season total.
    UPDATE user_scores SET season_score = total_score;
  END IF;
END $$;

-- The retired lazy generator announced the placeholder Jul 1 end
-- ("FINAL WEEK" / "COMPLETE"); those rows describe an end date that no
-- longer exists, so withdraw them. Outside the seed block because a
-- server still running the old code can re-insert them until the new
-- deploy lands — re-running this migration cleans up again.
DELETE FROM notifications
  WHERE dedupe_key IN ('season_01_final_week', 'season_01_complete');
