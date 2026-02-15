-- ============================================================
-- Cribble Full Database Setup
-- ============================================================
-- Run this in your Supabase SQL Editor to set up everything.
-- Safe to run multiple times (uses IF NOT EXISTS / CREATE OR REPLACE).
--
-- Prerequisites: You should already have a "users" table with columns:
--   id (serial PK), twitter_id, twitter_username, twitter_name,
--   twitter_profile_image, twitter_access_token, subscription_tier,
--   user_type, status, active_device_uuid, last_extension_sync,
--   created_at, last_login
--
-- Order: This script combines migrations 001, 002, and 004.
-- Migration 005 (column renames) is NOT included — run it separately
-- only when you're ready to rename twitter_* columns everywhere.
-- ============================================================


-- ============================================================
-- PART 1: EVENTS & DEVICES (from 001)
-- ============================================================

-- Ensure events_raw has all needed columns
ALTER TABLE IF EXISTS events_raw
  ADD COLUMN IF NOT EXISTS user_id INTEGER,
  ADD COLUMN IF NOT EXISTS device_uuid UUID,
  ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS active_ms BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ms BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_version TEXT;

-- Backfill user_id from legacy twitter_user_id if it exists
DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  SELECT data_type INTO user_id_type
  FROM information_schema.columns
  WHERE table_name = 'events_raw' AND column_name = 'user_id';

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events_raw' AND column_name = 'twitter_user_id'
  ) THEN
    IF user_id_type = 'integer' THEN
      UPDATE events_raw
        SET user_id = twitter_user_id::integer
        WHERE user_id IS NULL AND twitter_user_id IS NOT NULL;
    ELSE
      RAISE NOTICE 'user_id type is %; skipping twitter_user_id backfill', user_id_type;
    END IF;
  END IF;
END $$;

-- Create user_devices table
CREATE TABLE IF NOT EXISTS user_devices (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  device_uuid UUID UNIQUE NOT NULL,
  device_name TEXT,
  browser_info JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ
);

-- RLS (service role bypasses these)
ALTER TABLE events_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON events_raw FROM anon;
REVOKE ALL ON user_devices FROM anon;


-- ============================================================
-- PART 2: SCORING & RPC FUNCTIONS (from 002)
-- ============================================================

-- User scores table
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

-- Event deduplication constraint
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

-- Device registration RPC
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

-- Score recalculation RPC
CREATE OR REPLACE FUNCTION recalculate_user_score(p_user_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total BIGINT;
  v_today BIGINT;
  v_week BIGINT;
  v_month BIGINT;
BEGIN
  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_total
    FROM events_raw WHERE user_id = p_user_id;

  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_today
    FROM events_raw
    WHERE user_id = p_user_id
      AND timestamp >= date_trunc('day', NOW());

  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_week
    FROM events_raw
    WHERE user_id = p_user_id
      AND timestamp >= NOW() - INTERVAL '7 days';

  SELECT COALESCE(SUM((active_ms * 0.001) + (visits * 50)), 0)::BIGINT
    INTO v_month
    FROM events_raw
    WHERE user_id = p_user_id
      AND timestamp >= NOW() - INTERVAL '30 days';

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

-- Auto-update device last_sync on event insert
CREATE OR REPLACE FUNCTION update_device_last_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
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

-- One active device per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_single_active
  ON user_devices(user_id) WHERE is_active = TRUE;

-- Data validation constraints
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

-- Drop deprecated risk_openings table
DROP TABLE IF EXISTS risk_openings CASCADE;


-- ============================================================
-- PART 3: PERFORMANCE INDEXES (from 004)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_raw_user_id ON events_raw(user_id);
CREATE INDEX IF NOT EXISTS idx_events_raw_user_timestamp ON events_raw(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_raw_dedup ON events_raw(user_id, domain, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events_raw(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_device_time ON events_raw(device_uuid, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_domain ON events_raw(domain);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(session_token, expires_at);

CREATE INDEX IF NOT EXISTS idx_user_devices_uuid ON user_devices(device_uuid);
CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_active ON user_devices(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_user_scores_total ON user_scores(total_score DESC);


-- ============================================================
-- DONE! Your database is ready for Cribble.
-- ============================================================
