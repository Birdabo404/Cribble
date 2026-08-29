-- ============================================================
-- Migration 062: Cursor profile burn board
-- ============================================================
-- The CURSOR source of THE BURN board: logged-in users claim their
-- public cursor.com/@username profile (trust-based, one per account,
-- unclaimed handles only) and a 6-hourly cron re-scrapes the public
-- profile page. No CLI required — this is the no-agent path onto the
-- board.
--
--   cursor_profiles      — one row per user: the claimed handle plus
--                          the LATEST scraped headline stats and the
--                          per-profile sync health.
--   cursor_profile_daily — (user_id, day) facts merged from the page's
--                          two rolling ~30-day series (tokensOverTime +
--                          agentsOverTime). cursor.com forgets days
--                          older than its window; this table does not,
--                          so SEASON/ALL windows grow richer over time.
--                          Each sync overwrites the days it fetched.
--
-- Self-reported ceiling: values are whatever cursor.com publishes on
-- the public profile — no cost estimates, no cache split. The board
-- ranks by window token sums only.
--
-- Safe to run multiple times. Service-role only; no RLS policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cursor_profiles (
  -- One profile per user; the claim dies with the account.
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  -- Claim key: lowercased, leading @ stripped. UNIQUE is the trust
  -- model — a handle belongs to whoever linked it first.
  cursor_username TEXT NOT NULL UNIQUE
    CONSTRAINT cursor_profiles_username_format
      CHECK (cursor_username ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  -- Latest scrape of the profile header.
  display_name TEXT,
  avatar_url TEXT,
  joined_date TIMESTAMPTZ,
  -- Latest scrape of the page's stats object (lifetime-ish values as
  -- cursor.com reports them, NOT window sums — those come from daily).
  current_streak INTEGER NOT NULL DEFAULT 0
    CONSTRAINT cursor_profiles_current_streak_nonnegative
      CHECK (current_streak >= 0),
  longest_streak INTEGER NOT NULL DEFAULT 0
    CONSTRAINT cursor_profiles_longest_streak_nonnegative
      CHECK (longest_streak >= 0),
  agents_local INTEGER NOT NULL DEFAULT 0
    CONSTRAINT cursor_profiles_agents_local_nonnegative
      CHECK (agents_local >= 0),
  agents_cloud INTEGER NOT NULL DEFAULT 0
    CONSTRAINT cursor_profiles_agents_cloud_nonnegative
      CHECK (agents_cloud >= 0),
  longest_agent_seconds INTEGER NOT NULL DEFAULT 0
    CONSTRAINT cursor_profiles_longest_agent_seconds_nonnegative
      CHECK (longest_agent_seconds >= 0),
  -- Ranked model names (JSON array of strings), most used first.
  top_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The board opt-in. Claiming implies joining; the settings toggle
  -- flips it without unlinking.
  board_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Per-profile sync health, written by every claim/cron attempt. The
  -- leaderboard only ranks rows whose last sync succeeded, so a
  -- profile going private or vanishing drops off the board at the
  -- next sync without deleting its history.
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT
    CONSTRAINT cursor_profiles_last_sync_status_supported
      CHECK (last_sync_status IN ('ok', 'not_found', 'private', 'parse_error', 'fetch_error')),
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.cursor_profiles IS
  'Trust-based link between a Cribble account and a public cursor.com profile, plus the latest scraped headline stats. Service-role only.';
COMMENT ON COLUMN public.cursor_profiles.cursor_username IS
  'Lowercased cursor.com handle without the leading @; unique — first claim wins.';
COMMENT ON COLUMN public.cursor_profiles.board_enabled IS
  'Whether the user shows on the CURSOR burn board; toggled in settings without unlinking.';
COMMENT ON COLUMN public.cursor_profiles.last_sync_status IS
  'Outcome of the most recent scrape; the leaderboard only ranks ok rows.';

CREATE TABLE IF NOT EXISTS public.cursor_profile_daily (
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  tokens BIGINT NOT NULL DEFAULT 0
    CONSTRAINT cursor_profile_daily_tokens_nonnegative
      CHECK (tokens >= 0),
  agents_local INTEGER NOT NULL DEFAULT 0
    CONSTRAINT cursor_profile_daily_agents_local_nonnegative
      CHECK (agents_local >= 0),
  agents_cloud INTEGER NOT NULL DEFAULT 0
    CONSTRAINT cursor_profile_daily_agents_cloud_nonnegative
      CHECK (agents_cloud >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);

COMMENT ON TABLE public.cursor_profile_daily IS
  'Per-user daily token/agent facts merged from the profile page''s rolling series. History accumulates beyond cursor.com''s ~30-day window; syncs overwrite the days they fetched.';

-- The leaderboard RPC scans a day range across all users; the PK only
-- serves per-user lookups.
CREATE INDEX IF NOT EXISTS idx_cursor_profile_daily_day
  ON public.cursor_profile_daily (day);

ALTER TABLE public.cursor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cursor_profile_daily ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cursor_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cursor_profile_daily FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cursor_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cursor_profile_daily TO service_role;

-- Window aggregate for the CURSOR burn board: sums the daily facts per
-- user over [p_start, p_end] (NULLs = all time), joins the profile meta
-- and the Cribble identity, and ranks by window tokens. Only opted-in
-- profiles whose LAST sync succeeded and whose account is active are
-- ranked — same shape of contract as agent_token_leaderboard (043).
CREATE OR REPLACE FUNCTION public.cursor_profile_leaderboard(
  p_start DATE DEFAULT NULL,
  p_end DATE DEFAULT NULL
)
RETURNS TABLE (
  user_id INTEGER,
  username TEXT,
  profile_image TEXT,
  cursor_username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  joined_date TIMESTAMPTZ,
  current_streak INTEGER,
  longest_streak INTEGER,
  longest_agent_seconds INTEGER,
  top_models JSONB,
  tokens BIGINT,
  agents_local BIGINT,
  agents_cloud BIGINT,
  active_days BIGINT,
  last_synced_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH totals AS (
    SELECT
      daily.user_id,
      SUM(daily.tokens)::BIGINT AS tokens,
      SUM(daily.agents_local)::BIGINT AS agents_local,
      SUM(daily.agents_cloud)::BIGINT AS agents_cloud,
      COUNT(*) FILTER (
        WHERE daily.tokens > 0 OR daily.agents_local > 0 OR daily.agents_cloud > 0
      )::BIGINT AS active_days
    FROM public.cursor_profile_daily AS daily
    INNER JOIN public.cursor_profiles AS gate
      ON gate.user_id = daily.user_id
     AND gate.board_enabled
     AND gate.last_sync_status = 'ok'
    WHERE (p_start IS NULL OR daily.day >= p_start)
      AND (p_end IS NULL OR daily.day <= p_end)
    GROUP BY daily.user_id
  )
  SELECT
    users.id AS user_id,
    COALESCE(NULLIF(users.twitter_username, ''), 'User' || users.id::TEXT) AS username,
    users.twitter_profile_image AS profile_image,
    profiles.cursor_username,
    profiles.display_name,
    profiles.avatar_url,
    profiles.joined_date,
    profiles.current_streak,
    profiles.longest_streak,
    profiles.longest_agent_seconds,
    profiles.top_models,
    totals.tokens,
    totals.agents_local,
    totals.agents_cloud,
    totals.active_days,
    profiles.last_synced_at
  FROM totals
  INNER JOIN public.cursor_profiles AS profiles
    ON profiles.user_id = totals.user_id
  INNER JOIN public.users AS users
    ON users.id = totals.user_id
   AND users.status = 'active'
  ORDER BY
    totals.tokens DESC,
    (totals.agents_local + totals.agents_cloud) DESC,
    users.id ASC;
$$;

COMMENT ON FUNCTION public.cursor_profile_leaderboard(DATE, DATE) IS
  'Service-only window aggregate for the CURSOR burn board. Values are scraped from public cursor.com profiles and are self-reported by cursor.com, not measured by Cribble.';

REVOKE ALL ON FUNCTION public.cursor_profile_leaderboard(DATE, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cursor_profile_leaderboard(DATE, DATE)
  TO service_role;
