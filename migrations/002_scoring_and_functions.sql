-- Cribble: Scoring system, RPC functions, and device management
-- Run this in Supabase SQL Editor after 001_events_devices_rls.sql

-- ============================================================
-- 1. USER SCORES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_scores (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_score INTEGER DEFAULT 0,
  today_score INTEGER DEFAULT 0,
  week_score INTEGER DEFAULT 0,
  month_score INTEGER DEFAULT 0,
  last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_scores_total ON user_scores(total_score DESC);

-- ============================================================
-- 2. UNIQUE CONSTRAINT FOR EVENT DEDUPLICATION
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_event_per_user_domain_timestamp'
  ) THEN
    ALTER TABLE events_raw
      ADD CONSTRAINT unique_event_per_user_domain_timestamp
      UNIQUE (user_id, domain, timestamp);
  END IF;
END $$;

-- ============================================================
-- 3. DEVICE REGISTRATION RPC
-- ============================================================
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
BEGIN
  -- Deactivate all other devices for this user
  UPDATE user_devices
    SET is_active = FALSE, deactivated_at = NOW()
    WHERE user_id = p_user_id AND device_uuid != p_device_uuid AND is_active = TRUE;

  -- Insert or update the device
  INSERT INTO user_devices (user_id, device_uuid, device_name, browser_info, is_active, last_sync_at, created_at)
  VALUES (p_user_id, p_device_uuid, p_device_name, p_browser_info, TRUE, p_last_sync_at, NOW())
  ON CONFLICT (device_uuid) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    device_name = COALESCE(EXCLUDED.device_name, user_devices.device_name),
    browser_info = COALESCE(EXCLUDED.browser_info, user_devices.browser_info),
    is_active = TRUE,
    last_sync_at = EXCLUDED.last_sync_at,
    deactivated_at = NULL;

  -- Update user's active device
  UPDATE users SET active_device_uuid = p_device_uuid WHERE id = p_user_id;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- 4. SCORE RECALCULATION RPC
-- ============================================================
CREATE OR REPLACE FUNCTION recalculate_user_score(p_user_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_today BIGINT;
  v_week BIGINT;
  v_month BIGINT;
BEGIN
  -- Total score (all time)
  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_total
    FROM events_raw WHERE user_id = p_user_id;

  -- Today score
  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_today
    FROM events_raw
    WHERE user_id = p_user_id
      AND timestamp >= date_trunc('day', NOW());

  -- Week score
  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_week
    FROM events_raw
    WHERE user_id = p_user_id
      AND timestamp >= NOW() - INTERVAL '7 days';

  -- Month score
  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_month
    FROM events_raw
    WHERE user_id = p_user_id
      AND timestamp >= NOW() - INTERVAL '30 days';

  -- Upsert into user_scores
  INSERT INTO user_scores (user_id, total_score, today_score, week_score, month_score, last_calculated_at, created_at, updated_at)
  VALUES (p_user_id, v_total, v_today, v_week, v_month, NOW(), NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    total_score = EXCLUDED.total_score,
    today_score = EXCLUDED.today_score,
    week_score = EXCLUDED.week_score,
    month_score = EXCLUDED.month_score,
    last_calculated_at = NOW(),
    updated_at = NOW();
END;
$$;

-- ============================================================
-- 5. AUTO-UPDATE DEVICE LAST SYNC ON EVENT INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION update_device_last_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE user_devices
    SET last_sync_at = NEW.timestamp
    WHERE device_uuid = NEW.device_uuid
      AND (last_sync_at IS NULL OR last_sync_at < NEW.timestamp);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_device_last_sync ON events_raw;
CREATE TRIGGER trigger_update_device_last_sync
  AFTER INSERT ON events_raw
  FOR EACH ROW
  EXECUTE FUNCTION update_device_last_sync();

-- ============================================================
-- 6. PARTIAL UNIQUE INDEX: ONE ACTIVE DEVICE PER USER
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_single_active
  ON user_devices(user_id) WHERE is_active = TRUE;

-- ============================================================
-- 7. DATA VALIDATION CONSTRAINTS
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_active_ms_positive') THEN
    ALTER TABLE events_raw ADD CONSTRAINT chk_active_ms_positive CHECK (active_ms >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_total_ms_positive') THEN
    ALTER TABLE events_raw ADD CONSTRAINT chk_total_ms_positive CHECK (total_ms >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_visits_positive') THEN
    ALTER TABLE events_raw ADD CONSTRAINT chk_visits_positive CHECK (visits >= 0);
  END IF;
END $$;

-- ============================================================
-- 8. DROP DEPRECATED TABLE
-- ============================================================
DROP TABLE IF EXISTS risk_openings CASCADE;
