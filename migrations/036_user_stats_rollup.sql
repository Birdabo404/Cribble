-- ============================================================
-- Migration 036: Per-user stats rollup columns
-- ============================================================
-- Written on score recalculation (extension sync) and lazily
-- backfilled on read. Replaces per-request replays of events_raw
-- for /api/user/me, /api/user/tools, /api/leaderboard top-tools
-- decoration, and public profiles.
-- Safe to run multiple times.
-- ============================================================

alter table public.user_scores
  add column if not exists top_tools jsonb,
  add column if not exists active_days integer,
  add column if not exists longest_streak integer,
  add column if not exists total_active_ms bigint,
  add column if not exists stats_updated_at timestamptz;

comment on column public.user_scores.top_tools is 'Rollup: ranked tools (rankToolsFromEvents output, capped ~20), refreshed on sync/lazy backfill';
comment on column public.user_scores.stats_updated_at is 'Null means rollup columns need backfill from events_raw';
