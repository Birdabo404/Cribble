-- Rename twitter_* columns to generic auth columns
-- Run this ONLY when doing a fresh DB setup or planned migration
-- After running, update all Supabase queries to use new column names

-- Users table
ALTER TABLE users RENAME COLUMN twitter_id TO auth_provider_id;
ALTER TABLE users RENAME COLUMN twitter_username TO username;
ALTER TABLE users RENAME COLUMN twitter_name TO display_name;
ALTER TABLE users RENAME COLUMN twitter_profile_image TO profile_image;
ALTER TABLE users RENAME COLUMN twitter_access_token TO access_token;

-- Events table (legacy dual-write column)
ALTER TABLE events_raw RENAME COLUMN twitter_user_id TO legacy_user_id;
