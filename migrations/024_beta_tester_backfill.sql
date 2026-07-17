-- ============================================================
-- Migration 024: Beta tester plate backfill
-- ============================================================
-- Invite-code signups are gifted the never-sold 'beta-tester'
-- plate when they finish the welcome page (grantBetaTesterPlate,
-- called from POST /api/user/onboarding). Users who onboarded
-- before that hook existed will never POST onboarding again, so
-- this backfills the plate and its announcement notification for
-- every distinct invite redeemer who has already onboarded.
-- Invite users who have not onboarded yet are intentionally
-- excluded — they receive the gift live when they finish welcome.
-- Inserted values mirror the runtime grant exactly.
-- Safe to run multiple times.
-- ============================================================

-- 1. Grant the plate to every onboarded invite redeemer.
INSERT INTO user_cosmetics (user_id, item_type, item_id, acquired_via)
SELECT DISTINCT ir.user_id, 'plate', 'beta-tester', 'beta_grant'
FROM invite_redemptions ir
JOIN users u ON u.id = ir.user_id
WHERE u.onboarded_at IS NOT NULL
ON CONFLICT (user_id, item_type, item_id) DO NOTHING;

-- 2. Announce it in the notification bell, deduped like the runtime
--    path. idx_notifications_user_dedupe (migration 010) is a PARTIAL
--    unique index, so the conflict target must carry the same
--    WHERE predicate to match it.
INSERT INTO notifications (user_id, type, title, body, data, dedupe_key)
SELECT DISTINCT
    ir.user_id,
    'system',
    'TEST PILOT',
    'Beta tester gift minted — thanks for flying the early build. Equip it from your profile editor.',
    '{"plateId": "beta-tester"}'::jsonb,
    'plate_beta-tester'
FROM invite_redemptions ir
JOIN users u ON u.id = ir.user_id
WHERE u.onboarded_at IS NOT NULL
ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
