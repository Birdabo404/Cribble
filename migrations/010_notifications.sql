-- ============================================================
-- Migration 010: In-app notifications
-- ============================================================
-- Persistent notification feed backing the dashboard bell.
-- Sync confirmations stay client-side (ephemeral toasts); rows
-- here are reserved for meaningful events: rank milestones,
-- score milestones, season updates, and future social activity.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(32) NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Stable key for one-time events (e.g. 'rank_top_10', 'score_100000').
    -- The partial unique index below makes creation idempotent, so rank
    -- fluctuating in and out of a bucket never re-notifies.
    dedupe_key TEXT,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications(user_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
    ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- RLS with no policies: only the service role (used by the app's
-- API routes) can read or write notifications.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
