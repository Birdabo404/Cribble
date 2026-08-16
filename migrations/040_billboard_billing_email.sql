-- ============================================================
-- Migration 040: Billboard billing email
-- ============================================================
-- Adds billboard_ads.billing_email, the buyer's billing contact for
-- the email-first payment flow: on approval the payment instructions
-- are emailed here (Resend), with X DM demoted to the backup channel.
-- Required on every new buyer submission and edit — the buyer routes
-- validate and lowercase it with validateEmail before writing. NULL
-- marks rows from before this migration and admin-created external-
-- sponsor ads (no account behind them): the approve flow skips the
-- send for those and reports it, so ops falls back to X DM.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE billboard_ads ADD COLUMN IF NOT EXISTS billing_email TEXT;

-- Length guard, matching validateEmail's 254 cap in lib/validation.ts.
-- NULL passes a CHECK (unknown is not a violation), so pre-existing
-- rows stay valid.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billboard_ads_billing_email_length'
          AND conrelid = 'billboard_ads'::regclass
    ) THEN
        ALTER TABLE billboard_ads
            ADD CONSTRAINT billboard_ads_billing_email_length
            CHECK (char_length(billing_email) <= 254);
    END IF;
END $$;
