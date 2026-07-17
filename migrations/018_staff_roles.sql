-- ============================================================
-- Migration 018: Staff roles (two-tier admin)
-- ============================================================
-- Adds users.staff_role: NULL for regular users, 'moderator' for
-- staff, 'owner' for the site operator. Permission rules live in
-- src/lib/staffAuth.ts; the ADMIN_USERNAMES env allowlist remains
-- an owner-level breakglass so the operator can never be locked out.
--
-- Existing is_admin=TRUE rows (migration 008) are backfilled as
-- 'owner' — before this migration the only admins were the operator.
-- The admin_activity_log table (migration 003) is reused as-is for
-- the mandatory audit trail.
-- Safe to run multiple times.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='staff_role') THEN
        ALTER TABLE users ADD COLUMN staff_role VARCHAR(20) DEFAULT NULL
        CHECK (staff_role IN ('owner', 'moderator'));
    END IF;
END $$;

UPDATE users
SET staff_role = 'owner'
WHERE is_admin = TRUE AND staff_role IS NULL;

-- Partial index: staff lookups scan a handful of rows, never the table.
CREATE INDEX IF NOT EXISTS idx_users_staff_role ON users(staff_role) WHERE staff_role IS NOT NULL;
