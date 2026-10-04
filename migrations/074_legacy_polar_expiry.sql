-- ============================================================
-- Migration 074: expire Polar-era subscriptions on their paid-through date
-- ============================================================
-- Polar suspended the account and the cutover to Dodo (migration 072)
-- removed /api/webhooks/polar — the only path that ever downgraded a
-- Polar subscriber. The Dodo webhook only sees Dodo subscriptions and the
-- pull-based sync is upgrade-only, so a Polar-era tier would otherwise
-- never end. Each remaining prepaid Polar subscriber gets a row here with
-- the current_period_end Polar last reported; a daily pg_cron job drops
-- them to FREE once it passes.
--
-- The downgrade is guarded to the tier that was paid for, so a user who
-- has since been re-granted (Dodo resubscribe, admin grant) to another
-- tier is left alone. A row is stamped expired_at once processed, so a
-- later Dodo resubscribe at the same tier is never clobbered either.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS legacy_subscription_expiries (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tier        TEXT NOT NULL CHECK (tier IN ('PRO', 'TEAM')),
    expires_at  TIMESTAMPTZ NOT NULL,
    source_id   TEXT NOT NULL,
    expired_at  TIMESTAMPTZ
);

-- RLS with no policies: service role only.
ALTER TABLE legacy_subscription_expiries ENABLE ROW LEVEL SECURITY;

-- Polar yearly Pro subscriptions still inside their prepaid period
-- (current_period_end from the last subscription.* event in payment_events).
INSERT INTO legacy_subscription_expiries (user_id, tier, expires_at, source_id) VALUES
    (55,  'PRO', '2027-08-29T22:03:57.163360Z', 'polar:e375eefb-68c1-4e10-b13a-91f6497b86c3'),
    (338, 'PRO', '2027-08-30T19:41:39.722433Z', 'polar:817e62af-5fb7-46cf-b72a-5c80b2ccdfea')
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION expire_legacy_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    WITH due AS (
        UPDATE legacy_subscription_expiries
        SET expired_at = now()
        WHERE expired_at IS NULL AND expires_at <= now()
        RETURNING user_id, tier, source_id
    ),
    downgraded AS (
        UPDATE users u
        SET subscription_tier = 'FREE'
        FROM due
        WHERE u.id = due.user_id AND u.subscription_tier = due.tier
        RETURNING u.id, due.tier, due.source_id
    )
    INSERT INTO admin_activity_log (admin_user_id, target_user_id, action, old_values, new_values, reason)
    SELECT NULL, id, 'entitlement.revoke_pro',
           jsonb_build_object('subscription_tier', tier),
           jsonb_build_object('subscription_tier', 'FREE'),
           'Legacy Polar subscription period ended (' || source_id || ')'
    FROM downgraded;

    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION expire_legacy_subscriptions() FROM PUBLIC;
REVOKE ALL ON FUNCTION expire_legacy_subscriptions() FROM anon;
REVOKE ALL ON FUNCTION expire_legacy_subscriptions() FROM authenticated;
GRANT EXECUTE ON FUNCTION expire_legacy_subscriptions() TO service_role;

-- cron.schedule upserts by job name, so re-running is safe.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('expire-legacy-subscriptions', '15 1 * * *', 'SELECT public.expire_legacy_subscriptions()');
