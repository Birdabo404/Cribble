-- ============================================================
-- Migration 066: Team owners and the hiring bar
-- ============================================================
-- Two front-office features that ride existing tables:
--   - team_affiliations.role promotes a signed member to OWNER:
--     full command-deck powers from their personal login. This is
--     a per-franchise roster role, entirely distinct from the
--     site-staff users.staff_role ('owner'/'moderator', migration
--     018) — the two never mix. The 3-owner cap is app-side
--     (TEAM_OWNER_LIMIT, beside TEAM_SEAT_LIMIT), enforced at
--     promote time in /api/team/roster.
--   - users.team_req_min_* is the team's published HIRING BAR,
--     beside the other team_* columns from 029/064: per-metric
--     thresholds every APPLY surface stamps pilots against
--     (MET / BELOW / UNVERIFIED). NULL = that metric is off.
--     Soft signal only — no route ever gates an application on it.
-- Safe to run multiple times.
-- ============================================================

-- 1. Roster role. It rides the affiliation row, so an owner who leaves
--    or is released loses authority with the row, and a lapsed team
--    fails the live gate — no cleanup writes anywhere.
ALTER TABLE team_affiliations ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'owner'));

-- 2. The hiring bar. Score and tokens are whole-number thresholds
--    against BIGINT-scale facts; burn is whole USD (NUMERIC to match
--    the cost_usd aggregates it is compared with). App-side clamps
--    live in src/lib/teamHiring.ts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_req_min_score BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_req_min_tokens BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_req_min_burn_usd NUMERIC;

-- No new indexes: owner-authority lookups start from
-- (member_user_id, status), which idx_team_affiliations_member (029)
-- already covers — role is a final filter on at most one row (the
-- one-active partial index), and team-side queue reads keep using
-- idx_team_affiliations_team (064).
