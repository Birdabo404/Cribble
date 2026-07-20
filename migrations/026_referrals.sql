-- ============================================================
-- Migration 026: Referral invite system
-- ============================================================
-- Every user can mint one personal invite code (kind='referral')
-- and earn +500 bonus points when a recruit's extension first
-- syncs real activity, capped at 10 point-carrying rewards:
--   - invite_codes.kind: 'staff' (admin-minted, the old default
--     behavior) vs 'referral' (user-minted share links). A unique
--     partial index makes the per-user referral mint race-safe.
--   - user_scores.bonus_score: referral points live OUTSIDE event
--     math because the TS recalc rebuilds total_score from
--     events_raw on every sync and would wipe a raw increment.
--     total_score = event score + bonus_score; season/today/week
--     buckets stay pure event competition.
--   - referral_rewards: one row per referred user, ever. Rows past
--     the cap are recorded with points=0 so the cap check is
--     terminal and the recruit still shows in the referrer's stats.
--   - grant_referral_reward(): the whole grant in one atomic,
--     service-role-only step.
-- Safe to run multiple times.
-- ============================================================

-- 1. invite_codes.kind (existing rows are staff-minted codes)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'invite_codes' AND column_name = 'kind'
    ) THEN
        ALTER TABLE invite_codes
            ADD COLUMN kind TEXT NOT NULL DEFAULT 'staff'
            CHECK (kind IN ('staff', 'referral'));
    END IF;
END $$;

-- One personal referral code per user; concurrent mints collapse
-- onto this index and the loser re-selects the winner's code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_referral_owner
    ON invite_codes(created_by)
    WHERE kind = 'referral';

-- 2. Referral bonus bucket on user_scores
ALTER TABLE user_scores ADD COLUMN IF NOT EXISTS bonus_score INTEGER NOT NULL DEFAULT 0;

-- 3. Reward ledger: referred_user_id UNIQUE is the double-grant guard.
CREATE TABLE IF NOT EXISTS referral_rewards (
    id BIGSERIAL PRIMARY KEY,
    referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer
    ON referral_rewards(referrer_user_id);

-- RLS with no policies + revoked grants: service-role only, same as
-- the invite tables it extends.
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE referral_rewards FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE referral_rewards TO service_role;

-- 4. Atomic grant: record the reward and bump the referrer's scores
--    in one transaction.
--    Returns the awarded points (0 when the cap already absorbed all
--    point-carrying slots) or NULL when the referred user was already
--    rewarded (no-op).
CREATE OR REPLACE FUNCTION grant_referral_reward(
    p_referrer INTEGER,
    p_referred INTEGER,
    p_points INTEGER,
    p_cap INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rewarded_count INTEGER;
    v_points INTEGER;
    v_inserted_points INTEGER;
BEGIN
    IF p_referrer IS NULL OR p_referrer <= 0 OR p_referred IS NULL OR p_referred <= 0 THEN
        RAISE EXCEPTION 'Invalid user id' USING ERRCODE = '22023';
    END IF;
    IF p_referrer = p_referred THEN
        RAISE EXCEPTION 'Self-referral is not allowed' USING ERRCODE = '22023';
    END IF;
    IF p_points IS NULL OR p_points NOT BETWEEN 0 AND 1000000 THEN
        RAISE EXCEPTION 'Invalid reward points' USING ERRCODE = '22023';
    END IF;
    IF p_cap IS NULL OR p_cap NOT BETWEEN 0 AND 10000 THEN
        RAISE EXCEPTION 'Invalid reward cap' USING ERRCODE = '22023';
    END IF;

    -- Serialize grants per referrer so the cap count below cannot race
    -- two concurrent first-syncs into extra point-carrying rewards.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('cribble:referral-reward:' || p_referrer, 0)
    );

    -- Cap counts point-carrying rewards only; capped rows (points=0)
    -- keep the check terminal without hiding the recruit.
    SELECT COUNT(*)::INT
    INTO v_rewarded_count
    FROM referral_rewards
    WHERE referrer_user_id = p_referrer
      AND points > 0;

    v_points := CASE WHEN v_rewarded_count >= p_cap THEN 0 ELSE p_points END;

    -- The UNIQUE on referred_user_id makes replays a no-op even if a
    -- different referrer id sneaks in (different advisory lock).
    INSERT INTO referral_rewards (referrer_user_id, referred_user_id, points)
    VALUES (p_referrer, p_referred, v_points)
    ON CONFLICT (referred_user_id) DO NOTHING
    RETURNING points INTO v_inserted_points;

    IF v_inserted_points IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_points > 0 THEN
        INSERT INTO user_scores AS scores (user_id, total_score, bonus_score)
        VALUES (p_referrer, v_points, v_points)
        ON CONFLICT (user_id) DO UPDATE
        SET bonus_score = COALESCE(scores.bonus_score, 0) + v_points,
            total_score = COALESCE(scores.total_score, 0) + v_points,
            updated_at = NOW();
    END IF;

    RETURN v_points;
END;
$$;

-- Only the service role (the app's API routes) may grant rewards.
REVOKE ALL ON FUNCTION grant_referral_reward(INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION grant_referral_reward(INTEGER, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION grant_referral_reward(INTEGER, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION grant_referral_reward(INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;
