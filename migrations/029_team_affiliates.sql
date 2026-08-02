-- ============================================================
-- Migration 029: Team affiliate accounts
-- ============================================================
-- Companies upgrade their own user account to the TEAM tier
-- ($50/mo / $500/yr via Polar) and can affiliate up to 10 member
-- accounts (pending invites hold a seat — the cap is enforced in
-- the /api/team/* routes, not here):
--   - users.subscription_tier learns 'TEAM' (CHECK from 003).
--   - users.team_review_status is the pay-first anti-impersonation
--     gate: NULL until the first team grant, 'pending' once the
--     webhook grants, approved/rejected by the owner in /admin
--     (team_approved_at stamps the approval). Badge surfaces always
--     join the team's row and render only while the team has
--     subscription_tier = 'TEAM' AND team_review_status = 'approved'
--     — a lapsed subscription hides every affiliate badge and a
--     renewal re-lights them without touching these columns or the
--     affiliation rows.
--   - team_affiliations: one row per (team, member) pair. A member
--     may hold any number of pending invites but only one ACTIVE
--     affiliation (partial unique index below).
-- Safe to run multiple times.
-- ============================================================

-- 1. Allow the TEAM tier (refreshes the CHECK from migration 003).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_subscription_tier_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_subscription_tier;
ALTER TABLE users ADD CONSTRAINT users_subscription_tier_check
    CHECK (subscription_tier IN ('FREE', 'BASIC', 'PRO', 'PREMIUM', 'AFFILIATE', 'TEAM'));

-- 2. Review gate columns (nullable — non-team accounts never touch them).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'team_review_status'
    ) THEN
        ALTER TABLE users
            ADD COLUMN team_review_status TEXT
            CHECK (team_review_status IN ('pending', 'approved', 'rejected'));
    END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS team_approved_at TIMESTAMPTZ;

-- 3. Affiliations. The UNIQUE (team_user_id, member_user_id) pair both
--    dedupes invites and — as its backing index — serves roster
--    lookups by team.
CREATE TABLE IF NOT EXISTS team_affiliations (
    id BIGSERIAL PRIMARY KEY,
    team_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    UNIQUE (team_user_id, member_user_id),
    CONSTRAINT team_affiliations_no_self CHECK (team_user_id <> member_user_id)
);

-- One ACTIVE affiliation per member, ever; pending invites from any
-- number of teams may coexist until one is accepted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_affiliations_one_active
    ON team_affiliations(member_user_id)
    WHERE status = 'active';

-- Member-side lookups: the invite inbox (pending) and the badge join
-- (active) both start from member_user_id.
CREATE INDEX IF NOT EXISTS idx_team_affiliations_member
    ON team_affiliations(member_user_id, status);

-- RLS with no policies + revoked grants: service-role only, the same
-- lockdown as referral_rewards (026) and feedback (028).
ALTER TABLE team_affiliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE team_affiliations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE team_affiliations TO service_role;
