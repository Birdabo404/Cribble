-- ============================================================
-- Migration 012: Leaderboard rank snapshots
-- ============================================================
-- Persistent per-user rank ledger powering the leaderboard's
-- movement indicators (climbed / dropped / new entry). The
-- /api/leaderboard route diffs the freshly-computed standing
-- against this table on every read and records movements, so
-- every viewer sees the same arrows and they survive reloads.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS leaderboard_ranks (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    score BIGINT NOT NULL DEFAULT 0,
    -- Rank held immediately before the most recent movement.
    prev_rank INTEGER,
    -- When the most recent movement happened (null = never moved).
    rank_moved_at TIMESTAMP WITH TIME ZONE,
    -- First time this user appeared on the board (drives the NEW chip).
    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_ranks_rank
    ON leaderboard_ranks(rank);

-- RLS with no policies: only the service role (used by the app's
-- API routes) can read or write snapshots.
ALTER TABLE leaderboard_ranks ENABLE ROW LEVEL SECURITY;
