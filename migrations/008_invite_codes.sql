-- ============================================================
-- Migration 008: Invite codes and admin flag
-- ============================================================
-- Adds an is_admin flag to users, invite_codes + invite_redemptions
-- tables, and an atomic redeem function. New GitHub signups must
-- redeem a valid invite code; admins can generate codes.
-- Safe to run multiple times.
-- ============================================================

-- 1. Add is_admin flag to users (only if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='is_admin') THEN
        ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- 2. Invite codes table
CREATE TABLE IF NOT EXISTS invite_codes (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note TEXT,
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(UPPER(code));
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes(created_by);

-- 3. Redemption log
CREATE TABLE IF NOT EXISTS invite_redemptions (
    id BIGSERIAL PRIMARY KEY,
    invite_code_id BIGINT NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    redeemed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_redemptions_code ON invite_redemptions(invite_code_id);
CREATE INDEX IF NOT EXISTS idx_invite_redemptions_user ON invite_redemptions(user_id);

-- 4. Lock the tables down: RLS with no policies means only the
--    service role (used by the app's API routes) can touch them.
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_redemptions ENABLE ROW LEVEL SECURITY;

-- 5. Atomic redeem: increments use_count only when the code is
--    active, unexpired, unrevoked, and has uses remaining.
--    Returns the invite code id, or NULL if the code is not usable.
CREATE OR REPLACE FUNCTION redeem_invite_code(p_code TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    UPDATE invite_codes
    SET use_count = use_count + 1
    WHERE UPPER(code) = UPPER(TRIM(p_code))
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
      AND use_count < max_uses
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- Only the service role should be able to redeem codes.
REVOKE ALL ON FUNCTION redeem_invite_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION redeem_invite_code(TEXT) FROM anon;
REVOKE ALL ON FUNCTION redeem_invite_code(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION redeem_invite_code(TEXT) TO service_role;

-- 6. Admin access is NOT seeded here. Admin usernames live in the
--    ADMIN_USERNAMES environment variable; the GitHub OAuth callback
--    re-grants the flag on every login for allowlisted accounts.
