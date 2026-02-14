-- Add missing user fields for admin management (Safe version)
-- Execute these in Supabase SQL editor

-- 1. Add subscription tier field (only if it doesn't exist)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subscription_tier') THEN
        ALTER TABLE users ADD COLUMN subscription_tier VARCHAR(20) DEFAULT 'FREE' 
        CHECK (subscription_tier IN ('FREE', 'BASIC', 'PRO', 'PREMIUM', 'AFFILIATE'));
    ELSE
        -- Refresh constraint to include AFFILIATE
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_subscription_tier_check;
        ALTER TABLE users DROP CONSTRAINT IF EXISTS check_subscription_tier;
        ALTER TABLE users ADD CONSTRAINT users_subscription_tier_check 
        CHECK (subscription_tier IN ('FREE', 'BASIC', 'PRO', 'PREMIUM', 'AFFILIATE'));
    END IF;
END $$;

-- 2. Add user type field (only if it doesn't exist)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='user_type') THEN
        ALTER TABLE users ADD COLUMN user_type VARCHAR(30) DEFAULT 'developer'
        CHECK (user_type IN ('student', 'developer', 'researcher', 'analyst', 'content_creator', 'crypto', 'affiliate'));
    ELSE
        -- Update constraint if column exists but constraint might be different
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
        -- Also drop legacy-named constraint if present
        ALTER TABLE users DROP CONSTRAINT IF EXISTS check_user_type;
        ALTER TABLE users ADD CONSTRAINT users_user_type_check 
        CHECK (user_type IN ('student', 'developer', 'researcher', 'analyst', 'content_creator', 'crypto', 'affiliate'));
    END IF;
END $$;

-- 3. Add account status field (only if it doesn't exist)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='status') THEN
        ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'banned', 'suspended'));
    END IF;
END $$;

-- 4. Add admin notes field (only if it doesn't exist)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='admin_notes') THEN
        ALTER TABLE users ADD COLUMN admin_notes TEXT DEFAULT NULL;
    END IF;
END $$;

-- 5. Update existing users to have default values (safely)
UPDATE users 
SET subscription_tier = 'FREE' 
WHERE subscription_tier IS NULL;

UPDATE users 
SET user_type = 'developer' 
WHERE user_type IS NULL OR user_type NOT IN ('student', 'developer', 'researcher', 'analyst', 'content_creator', 'crypto');

UPDATE users 
SET status = 'active' 
WHERE status IS NULL;

-- 6. Create indexes (only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_users_subscription_tier ON users(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);

-- 7. Create admin activity log table (only if it doesn't exist)
CREATE TABLE IF NOT EXISTS admin_activity_log (
    id BIGSERIAL PRIMARY KEY,
    admin_user_id INTEGER REFERENCES users(id),
    target_user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_log_admin_user ON admin_activity_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_log_target_user ON admin_activity_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_log_created_at ON admin_activity_log(created_at);

-- Show current schema for verification
SELECT 
    column_name, 
    data_type, 
    column_default,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('subscription_tier', 'user_type', 'status', 'admin_notes')
ORDER BY column_name;

-- Success message
SELECT 'Database schema updated successfully for admin management!' as message;

-- EVENTS AND DEVICES SCHEMA (apply separately if missing)
-- 1) events_raw: unified keys
-- CREATE TABLE IF NOT EXISTS events_raw (
--   id BIGSERIAL PRIMARY KEY,
--   user_id INTEGER NOT NULL,               -- references users.id
--   device_uuid UUID NOT NULL,              -- references user_devices.device_uuid
--   timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
--   domain TEXT,
--   active_ms BIGINT DEFAULT 0,
--   total_ms  BIGINT DEFAULT 0,
--   visits INTEGER DEFAULT 0,
--   client_version TEXT
-- );
-- CREATE INDEX IF NOT EXISTS idx_events_user_time ON events_raw(user_id, timestamp DESC);
-- CREATE INDEX IF NOT EXISTS idx_events_device_time ON events_raw(device_uuid, timestamp DESC);
-- CREATE INDEX IF NOT EXISTS idx_events_domain ON events_raw(domain);

-- 2) user_devices: devices per user
-- CREATE TABLE IF NOT EXISTS user_devices (
--   id BIGSERIAL PRIMARY KEY,
--   user_id INTEGER NOT NULL REFERENCES users(id),
--   device_uuid UUID UNIQUE NOT NULL,
--   device_name TEXT,
--   browser_info JSONB,
--   is_active BOOLEAN DEFAULT TRUE,
--   last_sync_at TIMESTAMP WITH TIME ZONE,
--   created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
--   deactivated_at TIMESTAMP WITH TIME ZONE
-- );
-- CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);
