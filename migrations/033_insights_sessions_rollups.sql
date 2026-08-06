-- ============================================================
-- Migration 033: Usage sessions + daily insight rollups
-- ============================================================
-- Second half of the aggregate-insights foundation (with 032):
--
--   1. usage_sessions: per-user sessions derived nightly from
--      events_raw by /api/cron/insights-rollup using the SAME
--      sessionization the score policy uses (src/lib/scoring.ts:
--      same-domain events with gaps <= 5 minutes; focus ratio =
--      active_ms / wall time). Rebuildable at any time from
--      events_raw; deleted with the account like user_scores.
--   2. daily_tool_aggregates: one row per (date, domain,
--      country, role) slice with vendor/category stamped from
--      tool_taxonomy. TRUE aggregates only — no user ids — so
--      rows persist after account deletion, as the privacy
--      policy states. Users with metadata.insights_opt_out are
--      excluded at rollup time.
--   3. model_releases: launch annotations for before/after
--      tool-switching analysis. Editable seed data.
--
-- Safe to run multiple times.
-- ============================================================

-- 1) Per-user derived sessions ---------------------------------

CREATE TABLE IF NOT EXISTS usage_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    active_ms BIGINT NOT NULL DEFAULT 0,
    total_ms BIGINT NOT NULL DEFAULT 0,
    visits INTEGER NOT NULL DEFAULT 0,
    focus_ratio REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE usage_sessions IS
  'Sessions derived nightly from events_raw (same 5-minute-gap sessionization as scoring). Per-user rows: service-role only, erased on account deletion.';

CREATE INDEX IF NOT EXISTS idx_usage_sessions_started_at
  ON usage_sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_usage_sessions_user_started
  ON usage_sessions (user_id, started_at);

-- 2) Daily aggregate slices ------------------------------------

CREATE TABLE IF NOT EXISTS daily_tool_aggregates (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    domain TEXT NOT NULL,
    vendor TEXT NOT NULL,
    category TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'unknown',
    role TEXT NOT NULL DEFAULT 'unknown',
    distinct_users INTEGER NOT NULL DEFAULT 0,
    total_active_ms BIGINT NOT NULL DEFAULT 0,
    total_visits INTEGER NOT NULL DEFAULT 0,
    session_count INTEGER NOT NULL DEFAULT 0,
    median_session_ms BIGINT,
    median_focus_ratio REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT daily_tool_aggregates_slice_key
      UNIQUE (date, domain, country, role)
);

COMMENT ON TABLE daily_tool_aggregates IS
  'True aggregates only (no user ids); persists after account deletion. Service-role/admin-only today. Any future PUBLIC surface must enforce a minimum cohort of 50 distinct users per slice at read time.';

CREATE INDEX IF NOT EXISTS idx_daily_tool_aggregates_date
  ON daily_tool_aggregates (date);

-- 3) Model release annotations ---------------------------------

CREATE TABLE IF NOT EXISTS model_releases (
    id BIGSERIAL PRIMARY KEY,
    vendor TEXT NOT NULL,
    product TEXT NOT NULL,
    release_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT model_releases_launch_key
      UNIQUE (vendor, product, release_date)
);

COMMENT ON TABLE model_releases IS
  'Launch annotations for before/after usage analysis on the admin trends view. Editable seed data.';

-- RLS with no policies + revoked grants: service-role only, the
-- same lockdown as tool_taxonomy (032) and billboard_ads (030).
ALTER TABLE usage_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_tool_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_releases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE usage_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE daily_tool_aggregates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE model_releases FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE usage_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE daily_tool_aggregates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE model_releases TO service_role;

GRANT USAGE, SELECT ON SEQUENCE usage_sessions_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE daily_tool_aggregates_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE model_releases_id_seq TO service_role;

-- Seed: notable 2025-2026 launches (dates from vendor announcements).
INSERT INTO model_releases (vendor, product, release_date, notes) VALUES
    ('DeepSeek', 'DeepSeek-R1', '2025-01-20', 'Open-weights reasoning model; the January 2025 "DeepSeek moment".'),
    ('xAI', 'Grok 4', '2025-07-10', 'Grok 4 and Grok 4 Heavy.'),
    ('OpenAI', 'GPT-5', '2025-08-07', 'Unified fast/thinking system replacing the GPT-4-era lineup in ChatGPT.'),
    ('Anthropic', 'Claude Sonnet 4.5', '2025-09-29', 'Sonnet 4.5 with long-horizon agentic coding.'),
    ('OpenAI', 'Sora 2', '2025-09-30', 'Second-generation video model, launched with the Sora app.'),
    ('OpenAI', 'GPT-5.1', '2025-11-12', 'GPT-5.1 Instant and Thinking.'),
    ('Google', 'Gemini 3 Pro', '2025-11-18', 'Gemini 3 Pro preview across the Gemini app, AI Studio, and Search.'),
    ('Anthropic', 'Claude Opus 4.5', '2025-11-24', 'Opus 4.5 with the effort parameter and lower pricing.'),
    ('OpenAI', 'GPT-5.2', '2025-12-11', 'GPT-5.2, OpenAI''s response to Gemini 3.'),
    ('OpenAI', 'GPT-5.4', '2026-03-05', 'GPT-5.4 Thinking and Pro; mini/nano followed on March 17.'),
    ('Anthropic', 'Claude Opus 4.7', '2026-04-16', 'Opus 4.7 update.'),
    ('DeepSeek', 'DeepSeek V4', '2026-04-24', 'V4 Pro and Flash, MIT licensed.'),
    ('Anthropic', 'Claude Fable 5', '2026-06-09', 'Fable 5 and Mythos 5 launch.')
ON CONFLICT (vendor, product, release_date) DO NOTHING;
