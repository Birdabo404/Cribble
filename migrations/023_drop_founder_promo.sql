-- ============================================================
-- Migration 023: Drop the founder promo seat-cap RPC
-- ============================================================
-- The founder promo subscription ($2.99/mo, first 100 seats) is
-- removed. The Founder plate is now sold as a normal one-time plate
-- product through the standard order.paid grant path (plate_id
-- metadata → user_cosmetics), with no seat cap, so the capped-seat
-- RPC from migration 020 is dead code. Safe to run multiple times.
-- ============================================================

DROP FUNCTION IF EXISTS public.grant_founder_plate_capped(INTEGER, TEXT, INTEGER);
