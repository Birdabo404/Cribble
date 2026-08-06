-- ============================================================
-- Migration 030: Billboard ad spots
-- ============================================================
-- Paid promo slots for the sideways-scrolling Billboard train on
-- the dashboard + leaderboard, mixed at render time with free
-- top-3 hype items read from leaderboard_ranks (012). One row per
-- submitted ad, moving through a review lifecycle:
--
--   PENDING -> APPROVED | REJECTED | CHANGES_REQUESTED
--   (buyer edits + resubmits back to PENDING); ARCHIVED retires
--   a slot without losing its click stats.
--
-- An ad is LIVE when
--   status = 'APPROVED' AND paid_at IS NOT NULL
--   AND now() BETWEEN starts_at AND ends_at
-- Payment is manual in v1: after approval the admin marks the ad
-- paid + activates it, stamping paid_at and the 7-day
-- starts_at/ends_at window. At most 8 ads may be live at once —
-- enforced by the activation route in application code, not here.
-- updated_at is maintained by application code on write (no
-- trigger), same as user_scores and seasons.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS billboard_ads (
    id BIGSERIAL PRIMARY KEY,
    -- NULL = external-sponsor ad inserted by an admin on behalf
    -- of a buyer with no Cribble account.
    owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK (char_length(text) <= 80),
    link_url TEXT NOT NULL,
    -- NULL falls back to the owner's avatar at render time.
    logo_url TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'ARCHIVED')),
    -- Admin feedback surfaced to the buyer on redo / reject.
    review_note TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    clicks BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Live lookups: /api/billboard and the activation route's slot
-- count both filter APPROVED rows by window end.
CREATE INDEX IF NOT EXISTS idx_billboard_ads_status_ends
    ON billboard_ads(status, ends_at);

-- Buyer-side "my submissions" and admin per-owner views.
CREATE INDEX IF NOT EXISTS idx_billboard_ads_owner
    ON billboard_ads(owner_user_id);

-- RLS with no policies + revoked grants: service-role only, the
-- same lockdown as team_affiliations (029) and feedback (028).
ALTER TABLE billboard_ads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE billboard_ads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE billboard_ads TO service_role;
