-- ============================================================
-- Migration 061: Fraud flags (leaderboard & token abuse review)
-- ============================================================
-- Backs the fraud-detection system. The detection engine
-- (src/lib/fraudDetection.ts) runs over events_raw and
-- agent_usage_daily and, when a user trips one or more abuse
-- signals, the service layer upserts one row PER CATEGORY
-- ('activity' or 'token') here for staff to review in
-- /admin/abuse.
--
-- Dedupe is by (user_id, fingerprint): the fingerprint is a
-- stable hash of the signal-code set, so a recurring pattern
-- bumps last_detected_at + detection_count on the existing row
-- instead of spawning duplicates, while a materially different
-- signal set (a new code appears) opens a fresh flag. A staff
-- decision (status confirmed/dismissed) is never silently
-- resurrected by a later detection — the sweep only refreshes
-- the detection metadata and risk fields.
--
-- Service-role only, like every other integrity table.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fraud_flags (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CONSTRAINT fraud_flags_category_supported
      CHECK (category IN ('activity', 'token')),
  risk_score SMALLINT NOT NULL
    CONSTRAINT fraud_flags_risk_score_bounds
      CHECK (risk_score BETWEEN 0 AND 100),
  level TEXT NOT NULL
    CONSTRAINT fraud_flags_level_supported
      CHECK (level IN ('low', 'medium', 'high', 'critical')),
  -- The full FraudSignal[] the flag fired on, carrying the raw
  -- evidence numbers so a human can audit the decision.
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Stable hash of the signal-code set (see fraudFingerprint).
  fingerprint TEXT NOT NULL
    CONSTRAINT fraud_flags_fingerprint_length
      CHECK (char_length(fingerprint) BETWEEN 1 AND 128),
  status TEXT NOT NULL DEFAULT 'open'
    CONSTRAINT fraud_flags_status_supported
      CHECK (status IN ('open', 'confirmed', 'dismissed')),
  detection_count INTEGER NOT NULL DEFAULT 1
    CONSTRAINT fraud_flags_detection_count_positive
      CHECK (detection_count >= 1),
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Populated when a staff member resolves the flag (confirm/dismiss).
  resolved_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_reason TEXT
    CONSTRAINT fraud_flags_resolution_reason_length
      CHECK (resolution_reason IS NULL OR char_length(resolution_reason) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fraud_flags_user_fingerprint_key UNIQUE (user_id, fingerprint),
  CONSTRAINT fraud_flags_seen_ordered CHECK (last_detected_at >= first_detected_at)
);

COMMENT ON TABLE public.fraud_flags IS
  'Leaderboard/token abuse flags raised by the fraud-detection sweep. One row per (user, category) signal set; staff triage them in /admin/abuse.';
COMMENT ON COLUMN public.fraud_flags.fingerprint IS
  'Stable hash of the signal-code set (fraudFingerprint). Dedupe key with user_id.';
COMMENT ON COLUMN public.fraud_flags.signals IS
  'FraudSignal[] snapshot with per-signal evidence, refreshed on each detection.';

-- Queue reads: open flags newest-detected first.
CREATE INDEX IF NOT EXISTS idx_fraud_flags_status_detected
  ON public.fraud_flags(status, last_detected_at DESC);
-- Per-user dossier lookups (admin user page, cascade housekeeping).
CREATE INDEX IF NOT EXISTS idx_fraud_flags_user
  ON public.fraud_flags(user_id);

ALTER TABLE public.fraud_flags ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.fraud_flags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.fraud_flags_id_seq FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fraud_flags TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.fraud_flags_id_seq TO service_role;

-- PostgREST caches the schema; a brand-new table is invisible to the REST
-- API (which the service client uses) until the cache reloads.
NOTIFY pgrst, 'reload schema';
