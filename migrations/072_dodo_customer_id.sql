-- ============================================================
-- Migration 072: Dodo Payments customer link
-- ============================================================
-- Billing moved from Polar.sh to Dodo Payments. Polar keyed customers by
-- an external id the app chose (String(users.id)); Dodo has no such
-- field — the customer id is Dodo-generated and only learned from the
-- payment / subscription objects that also carry Cribble's checkout
-- metadata (userId). This column stores that link so the pull-based
-- entitlement sync can list the customer's subscriptions and payments,
-- and the billing portal can open for the right customer.
--
-- Deliberately NOT unique: Dodo attaches same-email checkouts to an
-- existing customer, so two Cribble accounts sharing an email can end
-- up on one Dodo customer. Fulfillment never trusts this column alone —
-- the webhook resolves recipients from checkout metadata first and the
-- sync filters listed objects by that same metadata.
--
-- payment_events keeps working unchanged: event_id is the Standard
-- Webhooks `webhook-id` header, which Dodo sends too.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS dodo_customer_id TEXT;

CREATE INDEX IF NOT EXISTS users_dodo_customer_id_idx
    ON users (dodo_customer_id)
    WHERE dodo_customer_id IS NOT NULL;
