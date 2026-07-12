-- ============================================================
-- Migration 011: Achievements
-- ============================================================
-- Persistent unlock ledger for the achievements system. The
-- catalog itself (names, targets, icons) lives in code
-- (src/lib/achievements.ts); this table only records which
-- achievement ids a user has unlocked and when, mirroring the
-- notifications dedupe pattern from migration 010.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_achievements (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    unlocked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- One unlock per achievement per user; makes evaluation idempotent
-- so the post-sync hook can re-run on every sync without duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_achievements_user_achievement
    ON user_achievements(user_id, achievement_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_unlocked
    ON user_achievements(user_id, unlocked_at DESC);

-- RLS with no policies: only the service role (used by the app's
-- API routes) can read or write unlocks.
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
