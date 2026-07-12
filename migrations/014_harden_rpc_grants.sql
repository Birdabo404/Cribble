-- ============================================================
-- Migration 014: lock down SECURITY DEFINER RPC execute grants
-- ============================================================
-- register_user_device and recalculate_user_score are SECURITY
-- DEFINER and were created without explicit grants, so they kept
-- the default PUBLIC EXECUTE — meaning the anon key could call
-- them through PostgREST to rebind devices or rewrite scores.
-- Apply the same hardening redeem_invite_code already has
-- (migration 008): only the service role may execute them.
-- Safe to run multiple times.
-- ============================================================

REVOKE ALL ON FUNCTION register_user_device(INTEGER, UUID, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_user_device(INTEGER, UUID, TEXT, JSONB, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION register_user_device(INTEGER, UUID, TEXT, JSONB, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION register_user_device(INTEGER, UUID, TEXT, JSONB, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION recalculate_user_score(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION recalculate_user_score(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION recalculate_user_score(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION recalculate_user_score(INTEGER) TO service_role;
