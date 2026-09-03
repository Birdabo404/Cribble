-- ============================================================
-- Migration 070: Status log — operator notices on cribble.dev/status
-- ============================================================
-- The /status page was fully automated (vendor feeds + live probes)
-- with no way for the operator to say anything. This is the ship's
-- log behind the new BULLETIN block: one row per post, append-only.
-- Each line carries its own severity / phase / title, and the page
-- state — which incidents are open, what phase, when resolved — is
-- DERIVED from the lines (src/lib/status/notices.ts), never stored.
--
-- A thread is every row sharing an incident_id; the opening post
-- takes the default uuid, follow-ups pass it back. The newest line's
-- word wins: phase 'resolved' closes the thread, any later
-- non-resolved line reopens it. Corrections are new lines — the API
-- exposes no edit or delete; service_role keeps UPDATE/DELETE only as
-- the operator's SQL-editor escape hatch for a genuinely bad post.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS status_log_entries (
    id BIGSERIAL PRIMARY KEY,
    incident_id UUID NOT NULL DEFAULT gen_random_uuid(),
    severity TEXT NOT NULL
        CHECK (severity IN ('operational', 'degraded', 'outage')),
    phase TEXT NOT NULL
        CHECK (phase IN ('investigating', 'identified', 'monitoring', 'maintenance', 'resolved')),
    -- Carried onto every line of a thread so each row reads on its own.
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 600),
    -- The posting owner, for the audit trail's benefit; the line
    -- survives account deletion because it already shipped.
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public read: the recent window, newest first.
CREATE INDEX IF NOT EXISTS idx_status_log_entries_created
    ON status_log_entries(created_at DESC);
-- Thread lookup for follow-up posts.
CREATE INDEX IF NOT EXISTS idx_status_log_entries_incident
    ON status_log_entries(incident_id, created_at);

-- RLS with no policies + revoked grants: service-role only, the
-- same lockdown as billboard_announcements (051).
ALTER TABLE status_log_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE status_log_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE status_log_entries TO service_role;
