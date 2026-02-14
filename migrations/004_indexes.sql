-- Performance indexes for leaderboard and score queries
-- Run this against your Supabase database

-- events_raw: most queries filter by user_id
CREATE INDEX IF NOT EXISTS idx_events_raw_user_id ON events_raw(user_id);

-- events_raw: dashboard filters by user_id + timestamp for today/week/month scores
CREATE INDEX IF NOT EXISTS idx_events_raw_user_timestamp ON events_raw(user_id, timestamp DESC);

-- events_raw: deduplication checks during sync
CREATE INDEX IF NOT EXISTS idx_events_raw_dedup ON events_raw(user_id, domain, timestamp);

-- user_sessions: validated on every authenticated request
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(session_token, expires_at);

-- user_devices: looked up by device_uuid during sync
CREATE INDEX IF NOT EXISTS idx_user_devices_uuid ON user_devices(device_uuid);
CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id, is_active);

-- user_scores: leaderboard sorts by total_score
CREATE INDEX IF NOT EXISTS idx_user_scores_total ON user_scores(total_score DESC);
