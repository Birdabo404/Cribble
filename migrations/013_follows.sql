-- ============================================================
-- Migration 013: Follows (social graph)
-- ============================================================
-- One row per follow edge. Powers follower/following counts on
-- public profiles, the "follows you" reciprocity chip, mutual-
-- follow social proof, and 'social' notifications.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id),
    CONSTRAINT follows_no_self_follow CHECK (follower_id <> followee_id)
);

-- The PK covers "who does X follow"; these cover "who follows X"
-- and keep both list endpoints ordered newest-first without a sort.
CREATE INDEX IF NOT EXISTS idx_follows_followee_created
    ON follows(followee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_follower_created
    ON follows(follower_id, created_at DESC);

-- RLS with no policies: only the service role (used by the app's
-- API routes) can read or write follow edges.
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
