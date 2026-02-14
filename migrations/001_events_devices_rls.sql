-- Safe schema alignment for events_raw and user_devices
-- Run in Supabase SQL editor or via migrations

-- 1) Ensure columns exist on events_raw
ALTER TABLE IF EXISTS events_raw
  ADD COLUMN IF NOT EXISTS user_id INTEGER,
  ADD COLUMN IF NOT EXISTS device_uuid UUID,
  ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS active_ms BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ms BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_version TEXT;

-- 2) Backfill user_id from legacy twitter_user_id (handle type differences)
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
    ELSIF user_id_type = 'uuid' THEN
      -- If user_id is uuid in your current schema, skip backfill (not compatible)
      RAISE NOTICE 'events_raw.user_id is UUID; skipping twitter_user_id backfill';
    ELSE
      RAISE NOTICE 'Unknown user_id type (%). Manual migration required', user_id_type;
    END IF;
  END IF;
END $$;

-- 3) Attempt to backfill device_uuid from legacy user_id values that look like UUIDs
-- (no-op if user_id is already numeric or values are not UUIDs)
UPDATE events_raw
SET device_uuid = user_id::text::uuid
WHERE device_uuid IS NULL
  AND user_id IS NOT NULL
  AND user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- 4) Create helpful indexes
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events_raw(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_device_time ON events_raw(device_uuid, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_domain ON events_raw(domain);

-- 5) Ensure user_devices exists with expected columns
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

CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_active ON user_devices(user_id, is_active);

-- 6) Enable Row Level Security (service role bypasses these policies)
ALTER TABLE events_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- Optional: Restrict anon roles explicitly (service role bypasses RLS; this just clarifies intent)
REVOKE ALL ON events_raw FROM anon;
REVOKE ALL ON user_devices FROM anon;

-- For now, do not add permissive policies for anon/authenticated users since the API uses service role.
-- Future: add policies to allow users to read their own rows once auth is integrated.

-- 7) Optional cleanup: drop legacy twitter_user_id after verifying backfill and code deploy
-- ALTER TABLE events_raw DROP COLUMN IF EXISTS twitter_user_id;


