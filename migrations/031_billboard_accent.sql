-- ============================================================
-- Migration 031: Billboard ad accent color
-- ============================================================
-- Adds billboard_ads.accent_color, the per-ad tint behind the v3
-- news-flipper sub-banner (stripe, background wash, logo ring).
-- Derived server-side at submit/edit time from the ad's logo — or
-- the owner-avatar fallback when logo_url is NULL — via sharp's
-- dominant-color stats, then clamped in HSL for legibility, and
-- always stored as lowercase '#rrggbb'. NULL means extraction
-- failed or there was no image; the ticker renders those ads in
-- the neutral monochrome look. Extraction is best-effort, so a
-- dead logo host never blocks a submission.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE billboard_ads ADD COLUMN IF NOT EXISTS accent_color TEXT;

-- Format guard: lowercase '#rrggbb' or NULL. The IS NULL arm is
-- explicit for readability (a NULL CHECK would pass anyway).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billboard_ads_accent_color_format'
          AND conrelid = 'billboard_ads'::regclass
    ) THEN
        ALTER TABLE billboard_ads
            ADD CONSTRAINT billboard_ads_accent_color_format
            CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-f]{6}$');
    END IF;
END $$;
