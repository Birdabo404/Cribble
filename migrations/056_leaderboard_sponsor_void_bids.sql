-- ============================================================
-- Migration 056: Terminal state for refused sponsor checkouts
-- ============================================================
-- A Polar checkout can complete without qualifying as paid stake (for
-- example, a legacy checkout that accepted a 100% coupon). The payment
-- integrity gate correctly refuses it, but leaving its ledger row in
-- PENDING makes the owner UI claim money is still in flight until TTL.
-- VOID keeps the audit record while removing it from pending and ranked
-- reads. New sponsor checkouts disable coupons, so this is principally a
-- failure/reconciliation state rather than a normal lifecycle step.
-- Safe to run multiple times.
-- ============================================================

-- Avoid waiting behind an unexpectedly long writer during a hotfix.
SET lock_timeout = '5s';

ALTER TABLE public.leaderboard_sponsor_bids
    ADD COLUMN IF NOT EXISTS failure_reason TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'leaderboard_sponsor_bids_status_check'
          AND conrelid = 'public.leaderboard_sponsor_bids'::regclass
    ) THEN
        ALTER TABLE public.leaderboard_sponsor_bids
            DROP CONSTRAINT leaderboard_sponsor_bids_status_check;
    END IF;

    ALTER TABLE public.leaderboard_sponsor_bids
        ADD CONSTRAINT leaderboard_sponsor_bids_status_check
        CHECK (status IN ('PENDING', 'PAID', 'REFUNDED', 'VOID'));
END $$;
