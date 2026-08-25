-- ============================================================
-- Migration 055: Leaderboard sponsor bids
-- ============================================================
-- Third Billboard product: a rolling 24-hour paid sponsor ranking
-- on the leaderboard page. Approved creatives (billboard_ads rows
-- with the new 'leaderboard' placement) bid through Polar; every
-- paid contribution counts toward its creative's total for 24
-- hours from paid_at, then drops off individually. Rank is DERIVED
-- at read time — total of non-refunded, non-expired contributions,
-- ties broken by the earlier first active payment — never assigned
-- or reserved: checkout creation holds nothing, payment completion
-- is what moves the board.
--
-- leaderboard_sponsor_bids is the money ledger, one row per Polar
-- checkout:
--
--   PENDING  — checkout created; amount_cents was computed
--              server-side (difference to the buyer's target
--              total, $2.00 floor) and is what Polar will charge
--              via an ad-hoc fixed price. Worth nothing on the
--              board.
--   PAID     — order.paid verified (product id + charged amount +
--              buyer against this row) by the webhook or the
--              pull-based sync; paid_at starts the 24h clock.
--   REFUNDED — order.refunded; the contribution is revoked from
--              the ranking entirely (any refund revokes the whole
--              row — partial refunds are not a supported flow).
--
-- Time-expiry is never a status flip: readers filter
-- paid_at > now() - interval '24 hours' against the server clock.
--
-- The 'leaderboard' placement reuses the whole billboard_ads
-- lifecycle (submission, review, edits re-opening review, click
-- redirect) but NOT migration 030's LIVE window: a leaderboard
-- creative is on the board exactly while it is APPROVED and holds
-- at least one active PAID contribution — paid_at / starts_at /
-- ends_at on the ad row stay NULL and unused for this placement.
-- Safe to run multiple times.
-- ============================================================

-- Placement vocabulary gains 'leaderboard' (mirrors
-- BillboardPlacement in lib/billboard.ts). Drop + re-add: CHECK
-- constraints can't be altered in place.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billboard_ads_placement_valid'
          AND conrelid = 'billboard_ads'::regclass
    ) THEN
        ALTER TABLE billboard_ads DROP CONSTRAINT billboard_ads_placement_valid;
    END IF;
    ALTER TABLE billboard_ads
        ADD CONSTRAINT billboard_ads_placement_valid
        CHECK (placement IN ('flipper', 'rail', 'leaderboard'));
END $$;

CREATE TABLE IF NOT EXISTS leaderboard_sponsor_bids (
    id BIGSERIAL PRIMARY KEY,
    -- The creative this contribution ranks. The ledger row dies with
    -- the ad; refunded/expired history has no meaning without it.
    ad_id BIGINT NOT NULL REFERENCES billboard_ads(id) ON DELETE CASCADE,
    -- The buyer — always the ad's owner at checkout time (the checkout
    -- route enforces ownership). Denormalized so payment verification
    -- never depends on a later ad edit.
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PAID', 'REFUNDED')),
    -- What Polar was told to charge (integer cents, ad-hoc fixed
    -- price): the server-computed difference to target_total_cents
    -- with the $2.00 minimum applied. order.paid must match it
    -- before the row activates.
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    -- The active total the buyer was aiming for when the checkout
    -- was created — audit trail for the pricing decision, never used
    -- in ranking (the paid amounts are).
    target_total_cents INTEGER NOT NULL CHECK (target_total_cents > 0),
    -- One ledger row per Polar checkout; the webhook and sync find
    -- the row through the order's checkout_id.
    polar_checkout_id TEXT NOT NULL UNIQUE,
    -- Stamped at activation. UNIQUE so a duplicate order delivery
    -- can never double-activate through a second row.
    polar_order_id TEXT UNIQUE,
    -- Payment completion time (the Polar order's creation moment,
    -- not webhook arrival) — the 24h contribution clock runs from
    -- here. NULL while PENDING.
    paid_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The ranking read: PAID rows inside the rolling window, aggregated
-- per ad. Status leads so the PENDING/REFUNDED majority-by-time
-- never bloats the scan.
CREATE INDEX IF NOT EXISTS idx_leaderboard_sponsor_bids_status_paid
    ON leaderboard_sponsor_bids(status, paid_at);

-- Buyer-side reads: the owner API's active-total lookup and the
-- post-checkout sync's "my pending rows" scan.
CREATE INDEX IF NOT EXISTS idx_leaderboard_sponsor_bids_user
    ON leaderboard_sponsor_bids(user_id, status);

-- Per-creative aggregation and the ad-page contribution history.
CREATE INDEX IF NOT EXISTS idx_leaderboard_sponsor_bids_ad
    ON leaderboard_sponsor_bids(ad_id, status, paid_at);

-- RLS with no policies + revoked grants: service-role only, the
-- same lockdown as billboard_ads (030) and billboard_hype_events
-- (052). Money never rides an anon-visible table.
ALTER TABLE leaderboard_sponsor_bids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE leaderboard_sponsor_bids FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE leaderboard_sponsor_bids TO service_role;
