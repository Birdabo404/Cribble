-- ============================================================
-- Migration 064: Team applications (transfer requests)
-- ============================================================
-- The member-initiated mirror of the invite flow from 029: a pilot
-- files a "transfer request" against a team, and the team SIGNS
-- (applied -> active) or PASSES (hard delete) in /api/team/*:
--   - team_affiliations.status learns 'applied' ('pending' stays
--     team-initiated invites). Applications hold NO seat — the
--     10-seat cap counts only ('pending', 'active') rows and is
--     enforced at accept time, so inbound requests can never
--     starve a team's cap.
--   - team_affiliations.message is the pilot's pitch (≤280 chars,
--     enforced app-side; the column stays plain TEXT).
--   - users.team_recruiting is the OPEN ROSTER / CLOSED lamp —
--     closed teams can't receive applications. Defaults TRUE so
--     every existing team starts recruiting.
--   - 029's UNIQUE (team_user_id, member_user_id) already dedupes
--     invite-vs-application collisions, and its one-active partial
--     index still backstops the accept race; nothing to add there.
-- Safe to run multiple times.
-- ============================================================

-- 1. Widen the status CHECK. It was declared inline in 029's CREATE
--    TABLE, so Postgres auto-named it; DROP + re-ADD keeps the pair
--    idempotent (the same treatment 029 gave the tier CHECK from 003).
ALTER TABLE team_affiliations DROP CONSTRAINT IF EXISTS team_affiliations_status_check;
ALTER TABLE team_affiliations ADD CONSTRAINT team_affiliations_status_check
    CHECK (status IN ('pending', 'active', 'applied'));

-- 2. The pilot's pitch, rendered in the team's inbound-transfer queue.
ALTER TABLE team_affiliations ADD COLUMN IF NOT EXISTS message TEXT;

-- 3. The recruiting toggle lives on the team's users row, beside the
--    other team_* columns from 029.
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_recruiting BOOLEAN NOT NULL DEFAULT TRUE;

-- 4. Team-side queue reads (the applications inbox scans this team's
--    'applied' rows) — the team-keyed twin of
--    idx_team_affiliations_member (029).
CREATE INDEX IF NOT EXISTS idx_team_affiliations_team
    ON team_affiliations(team_user_id, status);
