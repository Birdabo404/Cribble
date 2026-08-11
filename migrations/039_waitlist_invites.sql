-- ============================================================
-- Migration 039: Waitlist beta invite tracking
-- ============================================================
-- The live waitlist table (email + ip_address + user_agent,
-- service-role-only since 015/022) predates the repo migrations.
-- This adds the plumbing for manually inviting those signups into
-- the beta, one at a time, without leaking waitlist PII anywhere:
--
--   - invite_codes.kind gains 'waitlist'. Codes minted here behave
--     exactly like beta invites in the redemption flow (which is
--     kind-agnostic), but stay out of /admin/invites, which lists
--     kind='staff' only — hundreds of waitlist codes would drown it.
--   - waitlist_invites tracks the send lifecycle. One row per
--     waitlist entry (UNIQUE), one code per row (UNIQUE). Cascades
--     from waitlist because the GDPR account-delete route erases
--     waitlist rows by email — tracking must vanish with them.
--   - waitlist_invite_queue is the ONLY read surface the admin API
--     touches. The PII boundary lives here: it deliberately excludes
--     ip_address and user_agent. security_invoker keeps it out of
--     the Supabase security-definer-view advisor lint.
--   - prepare_waitlist_invite() atomically claims a send: it locks
--     the waitlist row, mints code + tracking + audit in one
--     transaction on first send, reuses the existing code on retry,
--     and refuses duplicates (sent/redeemed/in-flight). A
--     double-click or concurrent request serializes on the row lock
--     and the loser gets 'in_progress'.
--
-- Recipient PII stays in the waitlist table only: invite_codes.note
-- and admin_activity_log reference the waitlist_id, never the email,
-- because both survive waitlist erasure.
-- Safe to run multiple times.
-- ============================================================

-- 1. Extend the kind vocabulary. The CHECK was created inline with
--    the column (026), so its name is whatever Postgres generated —
--    find every check constraint on kind and replace with the
--    canonical name.
DO $$
DECLARE
    v_conname TEXT;
BEGIN
    FOR v_conname IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid
         AND att.attnum = ANY (con.conkey)
        WHERE con.conrelid = 'public.invite_codes'::regclass
          AND con.contype = 'c'
          AND att.attname = 'kind'
    LOOP
        EXECUTE format('ALTER TABLE public.invite_codes DROP CONSTRAINT %I', v_conname);
    END LOOP;

    ALTER TABLE public.invite_codes
        ADD CONSTRAINT invite_codes_kind_check
        CHECK (kind IN ('staff', 'referral', 'waitlist'));
END $$;

-- 2. Send-lifecycle tracking, one row per invited waitlist entry.
--    'sending' is a short-lived claim taken before calling Resend;
--    it resolves to 'sent'/'failed', or goes stale if the process
--    dies mid-send (the RPC treats stale claims as retryable).
CREATE TABLE IF NOT EXISTS waitlist_invites (
    id BIGSERIAL PRIMARY KEY,
    waitlist_id UUID NOT NULL UNIQUE REFERENCES waitlist(id) ON DELETE CASCADE,
    invite_code_id BIGINT NOT NULL UNIQUE REFERENCES invite_codes(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    provider_message_id TEXT,
    last_error TEXT,
    first_attempt_at TIMESTAMP WITH TIME ZONE,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_invites_status ON waitlist_invites(status);

-- RLS with no policies + revoked grants: service-role only, same as
-- the waitlist and invite tables it links.
ALTER TABLE waitlist_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE waitlist_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE waitlist_invites TO service_role;

-- 3. Queue view: one row per waitlist entry with its send/redeem
--    state. queue_status folds the lifecycle into what the admin UI
--    filters on: redeemed > pending (never attempted) > tracking
--    status. LATERAL ... LIMIT 1 guards against row multiplication
--    if a code ever recorded multiple redemptions.
CREATE OR REPLACE VIEW waitlist_invite_queue
WITH (security_invoker = on) AS
SELECT
    w.id AS waitlist_id,
    w.email,
    w.created_at,
    wi.attempt_count,
    wi.last_attempt_at,
    wi.sent_at,
    wi.last_error,
    ic.code,
    wi.invite_code_id,
    r.redeemed_at,
    r.redeemed_by_username,
    CASE
        WHEN r.redeemed_at IS NOT NULL THEN 'redeemed'
        WHEN wi.id IS NULL THEN 'pending'
        ELSE wi.status
    END AS queue_status
FROM waitlist w
LEFT JOIN waitlist_invites wi ON wi.waitlist_id = w.id
LEFT JOIN invite_codes ic ON ic.id = wi.invite_code_id
LEFT JOIN LATERAL (
    SELECT
        ir.redeemed_at,
        u.twitter_username AS redeemed_by_username
    FROM invite_redemptions ir
    LEFT JOIN users u ON u.id = ir.user_id
    WHERE ir.invite_code_id = wi.invite_code_id
    ORDER BY ir.redeemed_at
    LIMIT 1
) r ON TRUE;

REVOKE ALL ON waitlist_invite_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON waitlist_invite_queue TO service_role;

-- 4. Atomic send preparation. Everything a send needs to be safe
--    happens in this one transaction: actor check, row lock,
--    duplicate refusal, code mint (first send) or reuse (retry),
--    attempt bump, and the audit row — matching create_staff_invite's
--    audit-first invariant. Outcomes:
--      not_found    — no such waitlist row
--      redeemed     — the linked code was already used to sign up
--      already_sent — delivery already succeeded
--      in_progress  — another send claimed this row < 5 minutes ago
--      ready        — claim taken; caller must deliver and then mark
--                     the row 'sent' or 'failed'
--    A 23505 on the code unique index (first send only) aborts the
--    transaction and propagates; the route retries with a fresh code.
CREATE OR REPLACE FUNCTION public.prepare_waitlist_invite(
    p_admin_user_id INTEGER,
    p_waitlist_id UUID,
    p_code TEXT
)
RETURNS TABLE (
    outcome TEXT,
    invite_code VARCHAR(32),
    invite_code_id BIGINT,
    attempt INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_tracking public.waitlist_invites%ROWTYPE;
    v_invite public.invite_codes%ROWTYPE;
    v_code VARCHAR(32);
    v_invite_code_id BIGINT;
    v_attempt INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.users
        WHERE users.id = p_admin_user_id
          AND COALESCE(users.status, 'active') = 'active'
    ) THEN
        -- Owner authorization is enforced by getStaffUser before this
        -- service-role-only RPC; the DB independently requires a real,
        -- active actor row (see migration 021's rationale).
        RAISE EXCEPTION 'Active staff actor required' USING ERRCODE = '42501';
    END IF;
    IF p_code IS NULL OR p_code !~ '^CRIB-[A-Z0-9]{4}-[A-Z0-9]{4}$' THEN
        RAISE EXCEPTION 'Invalid invite code' USING ERRCODE = '22023';
    END IF;

    -- Serialize concurrent sends for the same signup: the loser waits
    -- here, then sees the winner's tracking row below.
    PERFORM 1
    FROM public.waitlist
    WHERE waitlist.id = p_waitlist_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 'not_found'::TEXT, NULL::VARCHAR(32), NULL::BIGINT, NULL::INTEGER;
        RETURN;
    END IF;

    SELECT * INTO v_tracking
    FROM public.waitlist_invites
    WHERE waitlist_invites.waitlist_id = p_waitlist_id;

    IF FOUND THEN
        IF EXISTS (
            SELECT 1
            FROM public.invite_redemptions
            WHERE invite_redemptions.invite_code_id = v_tracking.invite_code_id
        ) THEN
            RETURN QUERY
            SELECT 'redeemed'::TEXT, NULL::VARCHAR(32), NULL::BIGINT, NULL::INTEGER;
            RETURN;
        END IF;

        IF v_tracking.status = 'sent' THEN
            RETURN QUERY
            SELECT 'already_sent'::TEXT, NULL::VARCHAR(32), NULL::BIGINT, NULL::INTEGER;
            RETURN;
        END IF;

        IF v_tracking.status = 'sending'
           AND v_tracking.last_attempt_at > NOW() - INTERVAL '5 minutes' THEN
            RETURN QUERY
            SELECT 'in_progress'::TEXT, NULL::VARCHAR(32), NULL::BIGINT, NULL::INTEGER;
            RETURN;
        END IF;

        -- Failed send, or a 'sending' claim old enough to be a crashed
        -- process: retry with the code already minted for this entry.
        -- p_code is deliberately ignored — one waitlist entry, one code.
        UPDATE public.waitlist_invites
        SET attempt_count = waitlist_invites.attempt_count + 1,
            last_attempt_at = NOW(),
            status = 'sending',
            updated_at = NOW()
        WHERE waitlist_invites.id = v_tracking.id
        RETURNING waitlist_invites.attempt_count INTO v_attempt;

        SELECT invite_codes.code INTO v_code
        FROM public.invite_codes
        WHERE invite_codes.id = v_tracking.invite_code_id;

        v_invite_code_id := v_tracking.invite_code_id;
    ELSE
        -- First send: mint the single-use code and the tracking row
        -- together. The note carries the waitlist_id, NOT the email —
        -- invite_codes survives waitlist erasure, so recipient PII
        -- must not leak into it.
        INSERT INTO public.invite_codes (
            code,
            kind,
            created_by,
            note,
            max_uses,
            expires_at
        )
        VALUES (
            p_code,
            'waitlist',
            p_admin_user_id,
            'Waitlist invite ' || p_waitlist_id,
            1,
            NOW() + INTERVAL '30 days'
        )
        RETURNING * INTO v_invite;

        INSERT INTO public.waitlist_invites (
            waitlist_id,
            invite_code_id,
            status,
            attempt_count,
            first_attempt_at,
            last_attempt_at
        )
        VALUES (p_waitlist_id, v_invite.id, 'sending', 1, NOW(), NOW());

        v_code := v_invite.code;
        v_invite_code_id := v_invite.id;
        v_attempt := 1;
    END IF;

    -- Every attempt that may reach the email provider gets its audit
    -- row in the same transaction — first sends AND retries. No email
    -- address in the payload; the log outlives waitlist erasure.
    INSERT INTO public.admin_activity_log (
        admin_user_id,
        target_user_id,
        action,
        old_values,
        new_values,
        reason
    )
    VALUES (
        p_admin_user_id,
        NULL,
        'waitlist.invite_send',
        NULL,
        jsonb_build_object(
            'waitlist_id', p_waitlist_id,
            'invite_id', v_invite_code_id,
            'attempt', v_attempt
        ),
        'Waitlist invite ' || p_waitlist_id
    );

    RETURN QUERY
    SELECT 'ready'::TEXT, v_code, v_invite_code_id, v_attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_waitlist_invite(INTEGER, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_waitlist_invite(INTEGER, UUID, TEXT)
    TO service_role;
