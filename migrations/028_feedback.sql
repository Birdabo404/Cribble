-- ============================================================
-- Migration 028: In-app beta feedback
-- ============================================================
-- Beta testers push feedback from the FEEDBACK button mounted on
-- every logged-in page (POST /api/feedback). Categories are fixed
-- (bug / idea / other), the message length check mirrors the API
-- validation (10-2000 chars after cleaning), page_path records
-- which page the report came from, and status carries admin triage
-- (new -> seen -> done). user_id cascades on delete so the GDPR
-- erasure flow stays complete.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'other')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  page_path TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Triage lists read newest-first within a status; the user index keeps
-- the ON DELETE CASCADE cheap when an account is erased.
CREATE INDEX IF NOT EXISTS idx_feedback_status_id ON feedback (status, id DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback (user_id);

-- RLS with no policies: only the service role (used by the app's
-- API routes) can read or write feedback — same lockdown as the
-- waitlist after migration 015.
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
