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
-- UNIQUE: one Dodo customer belongs to exactly one Cribble account. The
-- portal route opens whatever customer is linked to the signed-in user,
-- so a customer shared by two accounts would expose one account's
-- invoices and cancel button to the other. The checkout route asks Dodo
-- for a fresh customer on every first purchase (always_create_new_customer)
-- so sharing never happens by construction; this constraint is the
-- backstop, and linkDodoCustomer refuses (logs) a customer already owned
-- by another account. Fulfillment never trusts this column alone — the
-- webhook resolves recipients from checkout metadata first and the sync
-- filters listed objects by that same metadata.
--
-- payment_events keeps working unchanged: event_id is the Standard
-- Webhooks `webhook-id` header, which Dodo sends too.
-- Safe to run multiple times. The DROP replaces the non-unique index an
-- earlier revision of this migration created under the same name.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS dodo_customer_id TEXT;

DROP INDEX IF EXISTS users_dodo_customer_id_idx;

CREATE UNIQUE INDEX IF NOT EXISTS users_dodo_customer_id_key
    ON users (dodo_customer_id)
    WHERE dodo_customer_id IS NOT NULL;
