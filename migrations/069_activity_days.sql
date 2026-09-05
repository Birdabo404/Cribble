-- ============================================================
-- Migration 069: Per-day activity rollup for the profile grid
-- ============================================================
-- Adds one jsonb column to the migration-036 stats rollup:
-- activity_days = [{ "date": "YYYY-MM-DD", "activeMs": n }, ...],
-- the last 91 UTC days that carried verified active time, ascending.
-- Written on score recalculation (extension sync) alongside the other
-- rollup columns and lazily backfilled on read: a row with
-- activity_days NULL replays events_raw once, exactly like a row with
-- stats_updated_at NULL did after 036. Feeds the ACTIVITY GRID on
-- /u/[username] (privacy-gated with top tools / badges).
-- Safe to run multiple times.
-- ============================================================

alter table public.user_scores
  add column if not exists activity_days jsonb;

comment on column public.user_scores.activity_days is 'Rollup: [{date: YYYY-MM-DD, activeMs}] for the last 91 UTC days with activity, ascending; NULL means backfill from events_raw';
