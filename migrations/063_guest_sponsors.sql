-- ============================================================
-- Migration 063: Guest sponsors
-- ============================================================
-- Sponsorship without an account. A guest is a billboard_guests
-- row holding a random bearer secret; the secret lives in an
-- httpOnly cookie (cribble_sponsor_claim) and in an emailed magic
-- link (/api/billboard/claim?token=...), so the guest can return
-- on any device. Everything money-adjacent — Polar metadata,
-- ledger rows — carries the non-secret numeric guest id; the
-- token itself never leaves cookie + email.
--
-- billboard_ads, billboard_slot_orders and leaderboard_sponsor_bids
-- each gain a nullable guest_id so every sponsorship flow can be
-- owned by EITHER a signed-in user or a guest:
--
--   billboard_ads            — at most one of owner_user_id /
--                              guest_id (both NULL stays legal:
--                              admin-inserted external-sponsor
--                              ads, 030's convention).
--   billboard_slot_orders    — exactly one buyer. user_id loses
--                              its NOT NULL (061) to make room.
--   leaderboard_sponsor_bids — same treatment (055).
--
-- ADD CONSTRAINT has no IF NOT EXISTS, so the CHECKs are guarded
-- by name via DO blocks, same pattern as 055's placement rework.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS billboard_guests (
    id BIGSERIAL PRIMARY KEY,
    -- The bearer secret: 32 random bytes rendered as hex. Whoever
    -- presents it owns the guest's ads, so it rides only the
    -- httpOnly claim cookie and the tracking email — never Polar
    -- metadata, ledger rows, or API responses.
    token TEXT NOT NULL UNIQUE,
    -- Where the tracking magic link was delivered — the billing
    -- email given at submission time.
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS with no policies + revoked grants: service-role only, the
-- same lockdown as billboard_ads (030) and billboard_slot_orders
-- (061). A bearer-secret table must never ride an anon-visible
-- surface.
ALTER TABLE billboard_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE billboard_guests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE billboard_guests TO service_role;

-- ------------------------------------------------------------
-- billboard_ads: guest-owned creatives
-- ------------------------------------------------------------

ALTER TABLE billboard_ads
    ADD COLUMN IF NOT EXISTS guest_id BIGINT REFERENCES billboard_guests(id) ON DELETE CASCADE;

-- An ad never has two owners. Both NULL stays legal for the admin
-- external-sponsor flow.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billboard_ads_one_owner'
          AND conrelid = 'billboard_ads'::regclass
    ) THEN
        ALTER TABLE billboard_ads
            ADD CONSTRAINT billboard_ads_one_owner
            CHECK (num_nonnulls(owner_user_id, guest_id) <= 1);
    END IF;
END $$;

-- Guest-side "my submissions" — the guest twin of
-- idx_billboard_ads_owner (030).
CREATE INDEX IF NOT EXISTS idx_billboard_ads_guest
    ON billboard_ads(guest_id);

-- ------------------------------------------------------------
-- billboard_slot_orders: guest buyers on the slot money ledger
-- ------------------------------------------------------------

-- DROP NOT NULL is a no-op on an already-nullable column, so the
-- rerun stays clean.
ALTER TABLE billboard_slot_orders
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE billboard_slot_orders
    ADD COLUMN IF NOT EXISTS guest_id BIGINT REFERENCES billboard_guests(id) ON DELETE CASCADE;

-- A ledger row always names exactly one buyer — payment
-- verification has nothing to check against otherwise. Existing
-- rows all carry user_id, so adding the CHECK validates clean.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billboard_slot_orders_one_buyer'
          AND conrelid = 'billboard_slot_orders'::regclass
    ) THEN
        ALTER TABLE billboard_slot_orders
            ADD CONSTRAINT billboard_slot_orders_one_buyer
            CHECK (num_nonnulls(user_id, guest_id) = 1);
    END IF;
END $$;

-- Guest-side reads: the tracker's in-flight/pending scan, the
-- guest twin of idx_billboard_slot_orders_user (061).
CREATE INDEX IF NOT EXISTS idx_billboard_slot_orders_guest
    ON billboard_slot_orders(guest_id, status);

-- ------------------------------------------------------------
-- leaderboard_sponsor_bids: guest buyers on the bid money ledger
-- ------------------------------------------------------------

ALTER TABLE leaderboard_sponsor_bids
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE leaderboard_sponsor_bids
    ADD COLUMN IF NOT EXISTS guest_id BIGINT REFERENCES billboard_guests(id) ON DELETE CASCADE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'leaderboard_sponsor_bids_one_buyer'
          AND conrelid = 'leaderboard_sponsor_bids'::regclass
    ) THEN
        ALTER TABLE leaderboard_sponsor_bids
            ADD CONSTRAINT leaderboard_sponsor_bids_one_buyer
            CHECK (num_nonnulls(user_id, guest_id) = 1);
    END IF;
END $$;

-- Guest twin of idx_leaderboard_sponsor_bids_user (055): the owner
-- API's active-total lookup and the post-checkout sync scan.
CREATE INDEX IF NOT EXISTS idx_leaderboard_sponsor_bids_guest
    ON leaderboard_sponsor_bids(guest_id, status);
