-- ============================================================
-- Migration 052: Billboard hype events
-- ============================================================
-- One-shot hype moments for the Billboard train: throne takes,
-- TOP 3 / TOP 10 breakthroughs (optionally carrying the displaced
-- player) and score-milestone clubs (100K+). Rows are written at
-- the moment the thing happens — rank kinds by the leaderboard
-- snapshot diff pass, clubs by the score-notification flow —
-- replacing the old top-3 hype the billboard API re-derived from
-- leaderboard_ranks (012) on every read, which re-aired the same
-- story for the whole 48h movement window.
--
-- The API reads recent rows (last 48h, newest first, tightest kind
-- wins per user); airing once per visitor is the ticker's job via
-- a client-side seen gate, not the database's.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS billboard_hype_events (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('throne', 'top3', 'top10', 'club')),
    -- The celebrated player; the moment dies with the account.
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Landing rank and the rank climbed from — rank kinds only,
    -- NULL on club events.
    rank INTEGER,
    prev_rank INTEGER,
    -- The displaced player a rank event optionally calls out. Their
    -- deletion degrades the card to victimless — the celebration
    -- survives, the callout doesn't.
    victim_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- Score milestone crossed — club events only, NULL on rank kinds.
    threshold BIGINT,
    -- Insert-time replay guard, paired with user_id below. Rank kinds
    -- use 48h-windowed keys (hype_throne_{window}) so retaking the
    -- throne next window airs again; clubs are forever-once
    -- (hype_club_{threshold}).
    dedupe_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Producers insert with ignoreDuplicates against this — a re-run of
-- the same diff or notification pass lands on the conflict, not a
-- second airing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billboard_hype_events_user_dedupe
    ON billboard_hype_events(user_id, dedupe_key);

-- Freshness read: the public train fetches the recent window newest
-- first.
CREATE INDEX IF NOT EXISTS idx_billboard_hype_events_created
    ON billboard_hype_events(created_at);

-- RLS with no policies + revoked grants: service-role only, the
-- same lockdown as billboard_announcements (051).
ALTER TABLE billboard_hype_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE billboard_hype_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE billboard_hype_events TO service_role;
