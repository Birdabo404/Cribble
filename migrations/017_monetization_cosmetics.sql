-- ============================================================
-- Migration 017: Monetization — cosmetics ownership + payment
-- event ledger (Polar.sh)
-- ============================================================
-- user_cosmetics: one row per owned cosmetic (launch scope:
-- item_type 'plate'). Granted by the Polar webhook on order.paid,
-- revoked on order.refunded via source_order_id.
--
-- payment_events: webhook idempotency + audit ledger. event_id is
-- Polar's webhook-id header (unique); replayed deliveries hit the
-- constraint and are acked without side effects.
--
-- No change to users.subscription_tier is needed: the CHECK from
-- migration 003 already allows 'PRO' and 'FREE', the two values
-- the webhook writes.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_cosmetics (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    acquired_via TEXT NOT NULL,
    source_order_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user ON user_cosmetics(user_id);
-- Refund handling deletes by the originating Polar order id.
CREATE INDEX IF NOT EXISTS idx_user_cosmetics_source_order ON user_cosmetics(source_order_id);

CREATE TABLE IF NOT EXISTS payment_events (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    payload JSONB,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- RLS with no policies: only the service role (used by the app's
-- API routes) can read or write these tables.
ALTER TABLE user_cosmetics ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
