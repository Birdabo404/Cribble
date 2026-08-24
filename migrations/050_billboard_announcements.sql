-- ============================================================
-- Migration 050: Billboard announcements
-- ============================================================
-- Owner-pushed ANNOUNCEMENT copy for the sideways-scrolling
-- Billboard train on the dashboard + leaderboard. Freeform hype the
-- operator writes by hand at /admin/announcements — distinct from
-- the automatic top-3 hype items read from leaderboard_ranks (012)
-- and the paid ad spots (030). One row per push.
--
-- An announcement is LIVE when
--   status = 'LIVE' AND starts_at <= now()
--   AND (ends_at IS NULL OR ends_at >= now())
-- ends_at comes from a duration preset (1h / 6h / 24h) at push time;
-- NULL = pinned until archived. At most one announcement is live at
-- a time — a new push archives the current one, enforced by the
-- admin route in application code, not here. updated_at is
-- maintained by application code on write (no trigger), same as
-- billboard_ads (030).
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS billboard_announcements (
    id BIGSERIAL PRIMARY KEY,
    headline TEXT NOT NULL CHECK (char_length(headline) <= 40),
    body TEXT NOT NULL CHECK (char_length(body) <= 80),
    link_url TEXT,
    status TEXT NOT NULL DEFAULT 'LIVE'
        CHECK (status IN ('LIVE', 'ARCHIVED')),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- NULL = pinned until archived.
    ends_at TIMESTAMPTZ,
    -- The pushing owner, kept for the audit trail's benefit; the row
    -- survives account deletion because the copy already shipped.
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Live lookup: the public train filters LIVE rows by window end.
CREATE INDEX IF NOT EXISTS idx_billboard_announcements_status_ends
    ON billboard_announcements(status, ends_at);

-- RLS with no policies + revoked grants: service-role only, the
-- same lockdown as billboard_ads (030).
ALTER TABLE billboard_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE billboard_announcements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE billboard_announcements TO service_role;
