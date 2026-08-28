-- ============================================================
-- Migration 061: Billboard slot orders
-- ============================================================
-- Self-serve Polar checkout for the flipper and rail Billboard
-- products, replacing the email-first manual payment flow of
-- migration 040. billboard_slot_orders is the money ledger, one
-- row per Polar checkout — the slot twin of
-- leaderboard_sponsor_bids (055/056):
--
--   PENDING  — checkout created; amount_cents was computed
--              server-side (the advertised list price grossed up
--              for Polar's 4% + 40c fee, rounded up to whole
--              dollars) and is what Polar will charge via an
--              ad-hoc fixed price. Grants nothing yet.
--   PAID     — order.paid verified (checkout id + product id +
--              usd + charged amount + buyer against this row) by
--              the webhook or the pull-based sync; the ad's
--              7-day LIVE window is stamped at the same moment —
--              immediately, or queued at the earliest instant
--              occupancy allows when the flipper is full / the
--              rail slot is taken. A momentarily-full board
--              never refuses paid money.
--   REFUNDED — order.refunded; a window that hasn't started is
--              nulled off the ad, a running one is cut to now
--              (any refund revokes the whole order — partial
--              refunds are not a supported flow).
--   VOID     — a completed checkout that permanently failed the
--              payment verification gate (kept for audit only,
--              like 056's sponsor VOID).
--
-- The LIVE window itself stays on billboard_ads exactly as
-- migration 030 defined it — this table is the payment trail,
-- never a second source of liveness. The admin activate route
-- remains the manual override for ownerless external-sponsor ads.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS billboard_slot_orders (
    id BIGSERIAL PRIMARY KEY,
    -- The ad this order buys a window for. The ledger row dies with
    -- the ad; refunded history has no meaning without it.
    ad_id BIGINT NOT NULL REFERENCES billboard_ads(id) ON DELETE CASCADE,
    -- The buyer — always the ad's owner at checkout time (the checkout
    -- route enforces ownership). Denormalized so payment verification
    -- never depends on a later ad edit.
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Which product was bought. Snapshotted from the ad at checkout —
    -- 'leaderboard' creatives settle through leaderboard_sponsor_bids
    -- and are refused by the checkout route, so it never appears here.
    placement TEXT NOT NULL CHECK (placement IN ('flipper', 'rail')),
    -- The slot a rail purchase is binding to (the price is per slot,
    -- so the choice is made at checkout, not at activation). Exactly
    -- when placement = 'rail'; always NULL for flipper.
    rail_slot TEXT CHECK (rail_slot IN ('L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4')),
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PAID', 'REFUNDED', 'VOID')),
    -- What Polar was told to charge (integer cents, ad-hoc fixed
    -- price): the GROSS fee-grossed-up total, billboardSlotGrossCents
    -- of list_price_cents. order.paid's netAmount must match it
    -- before the row activates.
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    -- The advertised sticker price the buyer was quoted — audit trail
    -- for the pricing decision, never compared against Polar.
    list_price_cents INTEGER NOT NULL CHECK (list_price_cents > 0),
    -- One ledger row per Polar checkout; the webhook and sync find
    -- the row through the order's checkout_id.
    polar_checkout_id TEXT NOT NULL UNIQUE,
    -- Stamped at activation. UNIQUE so a duplicate order delivery
    -- can never double-activate through a second row.
    polar_order_id TEXT UNIQUE,
    -- Payment completion time (the Polar order's creation moment,
    -- not webhook arrival). NULL while PENDING.
    paid_at TIMESTAMPTZ,
    -- The exact LIVE window this order granted, stamped at activation
    -- alongside the ad row. Refund handling keys on it: a refund must
    -- cut only ITS OWN window, never a later renewal's — the ad row
    -- alone can't tell which order granted the window it carries.
    window_starts_at TIMESTAMPTZ,
    window_ends_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    -- Why a VOID row was voided ('payment_verification_failed').
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A rail order always binds a slot, a flipper order never does.
    CONSTRAINT billboard_slot_orders_slot_matches_placement
        CHECK ((placement = 'rail') = (rail_slot IS NOT NULL))
);

-- The checkout route's duplicate-purchase gate (fresh PENDING rows for
-- this ad) and the ad-page order history.
CREATE INDEX IF NOT EXISTS idx_billboard_slot_orders_ad
    ON billboard_slot_orders(ad_id, status, created_at);

-- Buyer-side reads: the tracker's in-flight/pending scan.
CREATE INDEX IF NOT EXISTS idx_billboard_slot_orders_user
    ON billboard_slot_orders(user_id, status);

-- RLS with no policies + revoked grants: service-role only, the
-- same lockdown as billboard_ads (030) and leaderboard_sponsor_bids
-- (055). Money never rides an anon-visible table.
ALTER TABLE billboard_slot_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE billboard_slot_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE billboard_slot_orders TO service_role;
