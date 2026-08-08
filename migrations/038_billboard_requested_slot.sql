-- ============================================================
-- Migration 038: Billboard buyer-requested rail slot
-- ============================================================
-- Buyers can now pitch a specific rail slot when submitting (or
-- editing) a rail ad. requested_rail_slot records that preference
-- at submission/edit time — unlike rail_slot, it is buyer-settable.
--
-- It is a preference, never a reservation: slots go to the first
-- confirmed payment, and contested pitches are resolved over DM.
-- rail_slot remains the admin-assigned live slot stamped by the
-- activation route at go-live, exactly as in migration 035.
--
-- NULL means flipper ads, pre-038 rows, or "any slot".
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE billboard_ads ADD COLUMN IF NOT EXISTS requested_rail_slot TEXT;

-- Vocabulary guard, mirroring RAIL_SLOTS in lib/billboard.ts.
-- NULL passes the CHECK (unknown is not a violation).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billboard_ads_requested_rail_slot_valid'
          AND conrelid = 'billboard_ads'::regclass
    ) THEN
        ALTER TABLE billboard_ads
            ADD CONSTRAINT billboard_ads_requested_rail_slot_valid
            CHECK (requested_rail_slot IN ('L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'));
    END IF;
END $$;
