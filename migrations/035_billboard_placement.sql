-- ============================================================
-- Migration 035: Billboard placement + profile rail slots
-- ============================================================
-- Second Billboard product: 8 always-on sponsor rail slots
-- (L1-L4 left, R1-R4 right) flanking the profile pages, sold
-- separately from the rotating flipper train. placement says
-- which product a row is; every pre-035 row backfills to
-- 'flipper' via the column default.
--
-- rail_slot is the slot a rail ad occupies while live. It is
-- never buyer-settable: it stays NULL through submission and
-- review, and the admin activation route assigns it at go-live.
-- Slot exclusivity among LIVE rail ads (LIVE per migration 030:
-- APPROVED + paid_at set + now() between starts_at and ends_at)
-- is a time-windowed rule, so it cannot be a UNIQUE constraint
-- here — the activate route enforces it in app code, exactly
-- like the flipper's 8-live cap.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE billboard_ads ADD COLUMN IF NOT EXISTS placement TEXT NOT NULL DEFAULT 'flipper';

ALTER TABLE billboard_ads ADD COLUMN IF NOT EXISTS rail_slot TEXT;

-- Vocabulary guards, mirroring BillboardPlacement and RAIL_SLOTS in
-- lib/billboard.ts. NULL passes the rail_slot CHECK (unknown is not
-- a violation), covering flipper ads and rail ads awaiting activation.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billboard_ads_placement_valid'
          AND conrelid = 'billboard_ads'::regclass
    ) THEN
        ALTER TABLE billboard_ads
            ADD CONSTRAINT billboard_ads_placement_valid
            CHECK (placement IN ('flipper', 'rail'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billboard_ads_rail_slot_valid'
          AND conrelid = 'billboard_ads'::regclass
    ) THEN
        ALTER TABLE billboard_ads
            ADD CONSTRAINT billboard_ads_rail_slot_valid
            CHECK (rail_slot IN ('L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'));
    END IF;
END $$;

-- Per-product live lookups: the public flipper/rails/slots feeds and
-- the activate route's cap + slot-occupancy checks all filter on
-- placement + status and the window end.
CREATE INDEX IF NOT EXISTS idx_billboard_ads_placement_status_ends
    ON billboard_ads(placement, status, ends_at);
