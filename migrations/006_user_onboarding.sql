-- 006_user_onboarding.sql
-- Adds columns to support the first-run onboarding wizard.
--
-- - onboarded_at: UTC timestamp when the user completed the wizard.
--                 NULL means the user has never completed onboarding
--                 (used to decide whether /welcome should show the wizard
--                 or auto-bounce to the dashboard).
-- - metadata:    free-form JSONB for onboarding answers + future profile
--                fields (primary_goal, referral_source, top_tools, etc.).
--                Defaults to empty object so JSON path queries are safe.
--
-- Idempotent: safe to re-run.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Useful for filtering "needs onboarding" without a full table scan.
CREATE INDEX IF NOT EXISTS idx_users_onboarded_at
  ON users (onboarded_at);
