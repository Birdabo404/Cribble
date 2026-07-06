-- Cribble: defense-in-depth for device registration
-- Run in Supabase SQL Editor after the earlier migrations.
--
-- Context: the API route (/api/extension/sync) already refuses to rebind a
-- device that is actively linked to another account. This migration adds the
-- same guarantee at the database layer so the RPC cannot silently transfer an
-- active device to a different user even if called incorrectly.

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
  v_existing_active BOOLEAN;
BEGIN
  SELECT user_id, is_active
    INTO v_existing_user, v_existing_active
    FROM user_devices
    WHERE device_uuid = p_device_uuid;

  -- Refuse to steal a device that is currently active for a different user.
  IF v_existing_user IS NOT NULL
     AND v_existing_user <> p_user_id
     AND v_existing_active IS TRUE THEN
    RAISE EXCEPTION 'device % is already linked to another active account', p_device_uuid
      USING ERRCODE = 'check_violation';
  END IF;

  -- Deactivate all other devices for this user (one active device per user).
  UPDATE user_devices
    SET is_active = FALSE, deactivated_at = NOW()
    WHERE user_id = p_user_id AND device_uuid <> p_device_uuid AND is_active = TRUE;

  INSERT INTO user_devices (user_id, device_uuid, device_name, browser_info, is_active, last_sync_at, created_at)
  VALUES (p_user_id, p_device_uuid, p_device_name, p_browser_info, TRUE, p_last_sync_at, NOW())
  ON CONFLICT (device_uuid) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    device_name = COALESCE(EXCLUDED.device_name, user_devices.device_name),
    browser_info = COALESCE(EXCLUDED.browser_info, user_devices.browser_info),
    is_active = TRUE,
    last_sync_at = EXCLUDED.last_sync_at,
    deactivated_at = NULL;

  UPDATE users SET active_device_uuid = p_device_uuid WHERE id = p_user_id;

  RETURN TRUE;
END;
$$;
