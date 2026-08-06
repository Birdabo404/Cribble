-- ============================================================
-- Migration 034: Billboard company name
-- ============================================================
-- Adds billboard_ads.company_name, the bold title line of the v3.1
-- two-line sub-banner (company name above the ad text). Required on
-- every new submission and edit — the buyer routes trim, collapse
-- whitespace and cap it at 40 code points, the same cap the CHECK
-- below enforces (char_length counts code points too). NULL marks
-- rows from before this migration; the ticker renders those with
-- the link-domain fallback (link_url's hostname) until the owner
-- edits the ad, which requires the field going forward.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE billboard_ads ADD COLUMN IF NOT EXISTS company_name TEXT;

-- Length guard, matching the buyer routes. NULL passes a CHECK
-- (unknown is not a violation), so pre-existing rows stay valid.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billboard_ads_company_name_length'
          AND conrelid = 'billboard_ads'::regclass
    ) THEN
        ALTER TABLE billboard_ads
            ADD CONSTRAINT billboard_ads_company_name_length
            CHECK (char_length(company_name) <= 40);
    END IF;
END $$;
