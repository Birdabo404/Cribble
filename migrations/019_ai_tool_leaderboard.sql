-- ============================================================
-- Migration 019: THE AI LEADERBOARD — ai_tool_totals RPC
-- ============================================================
-- Site-wide per-tool usage totals powering /api/leaderboard/ai.
-- One SQL aggregate replaces fetching every user's events.
--
-- The API passes p_tool_map, a domain→tool-name JSONB built from the
-- canonical registries (src/lib/toolNames.ts + src/lib/aiDomains.ts,
-- assembled in src/lib/aiLeaderboard.ts). The map plays two roles:
--   1. Merge table: domains of the same product collapse INSIDE the
--      query — that is what keeps pilot counts honest, because
--      COUNT(DISTINCT user) per tool must union claude.ai +
--      anthropic.com users, which no post-hoc merge of per-domain
--      counts can reconstruct.
--   2. Allowlist: rows whose domain is not a map key are excluded
--      entirely (pre-allowlist legacy rows can hold anything), so
--      unknown domains never pollute the board or the grand totals.
--
-- Row semantics mirror normalizeLegacyEventValues (src/lib/scoring.ts):
-- heartbeat rows (visits = 0) contribute verified active time only;
-- visit rows (visits >= 1) count as exactly one visit and none of
-- their unverified wall-clock active_ms. Scoring (active seconds +
-- flat visit points) happens in the API; per-session multipliers are
-- deliberately skipped — they need per-user sessionization, which
-- does not survive a site-wide GROUP BY.
--
-- The GROUPING SETS () row (tool IS NULL) carries the grand totals,
-- including the one number the per-tool rows cannot produce: the
-- site-wide DISTINCT pilot count (users overlap across tools).
--
-- Banned/suspended accounts are excluded exactly like the global
-- board (status NULL predates migration 003 and means active), and
-- cribble.dev is excluded outright — our own dashboard must not rank
-- itself on our own AI board (the API also omits it from the map;
-- the SQL guard is belt-and-braces).
--
-- events_raw identity: deployments differ (legacy INTEGER
-- twitter_user_id next to a UUID user_id, vs the migrated INTEGER
-- user_id — see src/lib/eventsIdentity.ts), so the function is created
-- against whichever integer column this database has, using the same
-- priority as the app's runtime probe.
-- Safe to run multiple times.
-- ============================================================

DO $$
DECLARE
  ident_col TEXT;
  user_id_type TEXT;
BEGIN
  SELECT data_type INTO user_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events_raw'
      AND column_name = 'user_id';

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events_raw'
      AND column_name = 'twitter_user_id'
  ) THEN
    ident_col := 'twitter_user_id';
  ELSIF user_id_type = 'integer' THEN
    ident_col := 'user_id';
  ELSE
    RAISE EXCEPTION
      'events_raw has no integer user identity column (user_id is %)',
      COALESCE(user_id_type, 'missing');
  END IF;

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION ai_tool_totals(
      p_tool_map JSONB,
      p_since TIMESTAMPTZ DEFAULT NULL
    )
    RETURNS TABLE (tool TEXT, active_ms BIGINT, visits BIGINT, pilots BIGINT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $body$
      SELECT
        (p_tool_map ->> e.domain)::TEXT AS tool,
        COALESCE(SUM(
          CASE WHEN COALESCE(e.visits, 0) = 0
               THEN GREATEST(COALESCE(e.active_ms, 0), 0)
               ELSE 0 END
        ), 0)::BIGINT AS active_ms,
        COUNT(*) FILTER (WHERE COALESCE(e.visits, 0) >= 1)::BIGINT AS visits,
        COUNT(DISTINCT e.%1$I)::BIGINT AS pilots
      FROM events_raw e
      JOIN users u ON u.id = e.%1$I
      WHERE (u.status IS NULL OR u.status = 'active')
        AND e.domain IS NOT NULL
        AND p_tool_map ? e.domain
        AND e.domain <> 'cribble.dev'
        AND (p_since IS NULL OR e.timestamp >= p_since)
      GROUP BY GROUPING SETS ((p_tool_map ->> e.domain), ())
    $body$;
  $fn$, ident_col);
END $$;

-- Same execute posture as the other SECURITY DEFINER RPCs
-- (migrations 008/014/015): only the service role may call it.
REVOKE ALL ON FUNCTION ai_tool_totals(JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_tool_totals(JSONB, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION ai_tool_totals(JSONB, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION ai_tool_totals(JSONB, TIMESTAMPTZ) TO service_role;
