-- 027: First-class device relinking (account switch on the same browser).
--
-- Bug: sign in with GitHub, link the extension, log out, sign in with a
-- different account (e.g. X/Twitter). The dashboard handshake re-registers
-- the same device UUID for the new session user, but register_user_device
-- (migration 007) refused to rebind a device that was still actively linked
-- to a different account (RAISE ... check_violation). The handshake then
-- failed forever (409/500), the dashboard showed "offline", and the
-- extension kept its OLD sync token — silently ingesting usage into the
-- previous account.
--
-- Fix: a registration by a different user is now an explicit, atomic
-- TRANSFER of the device binding:
--   * the user_devices row is rebound to the claiming user;
--   * the previous account's ingest credential is revoked in the same
--     statement (sync_token_hash = NULL), so the old token dies exactly at
--     the ownership boundary — the API immediately rotates a fresh token
--     for the new owner afterwards;
--   * the previous owner's users.active_device_uuid pointer is cleared.
-- Relinking to the SAME account remains an idempotent success (reactivate +
-- refresh metadata), exactly as before.
--
-- Authorization model: the only caller is the service-role API route
-- (/api/extension/sync, registration path), which always passes the
-- DASHBOARD SESSION's user id — so a transfer requires a signed-in browser
-- that knows the device UUID (the UUID is a 122-bit random value that the
-- extension only reveals to allowlisted dashboard origins).
--
-- Historical data is NOT transferred: events_raw rows keep their original
-- user attribution; only future ingestion follows the new binding.

CREATE OR REPLACE FUNCTION register_user_device(
  p_user_id INTEGER,
  p_device_uuid UUID,
  p_device_name TEXT DEFAULT NULL,
  p_browser_info JSONB DEFAULT NULL,
  p_last_sync_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_user INTEGER;
BEGIN
  -- Serialize concurrent registrations of the same device: two dashboard
  -- handshakes racing each other must not interleave the transfer steps.
  SELECT user_id
    INTO v_existing_user
    FROM user_devices
    WHERE device_uuid = p_device_uuid
    FOR UPDATE;

  -- One active device per user: deactivate the claiming user's others.
  UPDATE user_devices
    SET is_active = FALSE, deactivated_at = NOW()
    WHERE user_id = p_user_id AND device_uuid <> p_device_uuid AND is_active = TRUE;

  IF v_existing_user IS NOT NULL AND v_existing_user <> p_user_id THEN
    -- Account switch on the same physical device: transfer the binding and
    -- revoke the previous account's sync token atomically.
    UPDATE user_devices
      SET user_id = p_user_id,
          device_name = COALESCE(p_device_name, device_name),
          browser_info = COALESCE(p_browser_info, browser_info),
          is_active = TRUE,
          last_sync_at = p_last_sync_at,
          deactivated_at = NULL,
          sync_token_hash = NULL
      WHERE device_uuid = p_device_uuid;

    -- The previous owner's dashboard must stop pointing at this device.
    UPDATE users
      SET active_device_uuid = NULL
      WHERE id = v_existing_user AND active_device_uuid = p_device_uuid;
  ELSE
    -- New device, or idempotent re-registration by the current owner.
    INSERT INTO user_devices (user_id, device_uuid, device_name, browser_info, is_active, last_sync_at, created_at)
    VALUES (p_user_id, p_device_uuid, p_device_name, p_browser_info, TRUE, p_last_sync_at, NOW())
    ON CONFLICT (device_uuid) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      device_name = COALESCE(EXCLUDED.device_name, user_devices.device_name),
      browser_info = COALESCE(EXCLUDED.browser_info, user_devices.browser_info),
      is_active = TRUE,
      last_sync_at = EXCLUDED.last_sync_at,
      deactivated_at = NULL;
  END IF;

  UPDATE users SET active_device_uuid = p_device_uuid WHERE id = p_user_id;

  RETURN TRUE;
END;
$$;

-- CREATE OR REPLACE preserves existing grants for an identical signature,
-- but restate them (idempotent) so this migration is safe to run on a
-- database that somehow missed 014.
REVOKE ALL ON FUNCTION register_user_device(INTEGER, UUID, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_user_device(INTEGER, UUID, TEXT, JSONB, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION register_user_device(INTEGER, UUID, TEXT, JSONB, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION register_user_device(INTEGER, UUID, TEXT, JSONB, TIMESTAMPTZ) TO service_role;
