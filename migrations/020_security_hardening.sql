-- ============================================================
-- Migration 020: Security hardening
-- ============================================================
-- 1. Atomic, database-backed rate-limit counters for staff routes.
-- 2. Atomic founder-plate cap enforcement at fulfillment time.
-- 3. Atomic invite create/revoke + audit writes.
--
-- Every function is SECURITY INVOKER and executable only by the
-- service role. RLS plus explicit privilege revocation keeps the
-- backing table and RPCs out of the public Data API surface.
-- Safe to run multiple times.
-- ============================================================

-- ----------------------------------------------------------------
-- Distributed staff rate limiting
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_rate_limits (
    rate_key TEXT PRIMARY KEY CHECK (char_length(rate_key) BETWEEN 1 AND 200),
    request_count INTEGER NOT NULL CHECK (request_count >= 1),
    reset_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_rate_limits_reset_at
    ON public.staff_rate_limits(reset_at);

ALTER TABLE public.staff_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_staff_rate_limit(
    p_key TEXT,
    p_window_seconds INTEGER,
    p_limit INTEGER
)
RETURNS TABLE (
    success BOOLEAN,
    remaining INTEGER,
    reset_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMP WITH TIME ZONE := clock_timestamp();
    v_count INTEGER;
    v_reset TIMESTAMP WITH TIME ZONE;
BEGIN
    IF p_key IS NULL OR char_length(p_key) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'Invalid rate-limit key' USING ERRCODE = '22023';
    END IF;
    IF p_window_seconds NOT BETWEEN 1 AND 86400 THEN
        RAISE EXCEPTION 'Invalid rate-limit window' USING ERRCODE = '22023';
    END IF;
    IF p_limit NOT BETWEEN 1 AND 10000 THEN
        RAISE EXCEPTION 'Invalid rate-limit ceiling' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.staff_rate_limits AS current_limit (
        rate_key,
        request_count,
        reset_at,
        updated_at
    )
    VALUES (
        p_key,
        1,
        v_now + make_interval(secs => p_window_seconds),
        v_now
    )
    ON CONFLICT (rate_key) DO UPDATE
    SET
        request_count = CASE
            WHEN current_limit.reset_at <= v_now THEN 1
            ELSE current_limit.request_count + 1
        END,
        reset_at = CASE
            WHEN current_limit.reset_at <= v_now
                THEN v_now + make_interval(secs => p_window_seconds)
            ELSE current_limit.reset_at
        END,
        updated_at = v_now
    RETURNING current_limit.request_count, current_limit.reset_at
    INTO v_count, v_reset;

    -- The staff key space is tiny, but keep abandoned path/user keys
    -- bounded without requiring a new cron dependency.
    DELETE FROM public.staff_rate_limits
    WHERE staff_rate_limits.reset_at < v_now - INTERVAL '1 day'
      AND staff_rate_limits.rate_key <> p_key;

    RETURN QUERY
    SELECT v_count <= p_limit, GREATEST(p_limit - v_count, 0), v_reset;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_staff_rate_limit(TEXT, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_staff_rate_limit(TEXT, INTEGER, INTEGER)
    TO service_role;

-- ----------------------------------------------------------------
-- Founder cap: serialize every founder grant around one transaction
-- advisory lock, then count + insert inside that same transaction.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_founder_plate_capped(
    p_user_id INTEGER,
    p_source_id TEXT,
    p_seat_limit INTEGER DEFAULT 100
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    IF p_user_id IS NULL OR p_user_id <= 0 THEN
        RAISE EXCEPTION 'Invalid user id' USING ERRCODE = '22023';
    END IF;
    IF p_seat_limit NOT BETWEEN 1 AND 10000 THEN
        RAISE EXCEPTION 'Invalid founder seat limit' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('cribble:founder-seat-grant', 0)
    );

    -- Idempotent replay: an existing owner keeps the original grant and
    -- never consumes a second seat.
    IF EXISTS (
        SELECT 1
        FROM public.user_cosmetics
        WHERE user_id = p_user_id
          AND item_type = 'plate'
          AND item_id = 'founder'
    ) THEN
        UPDATE public.user_cosmetics
        SET source_order_id = COALESCE(source_order_id, p_source_id)
        WHERE user_id = p_user_id
          AND item_type = 'plate'
          AND item_id = 'founder';
        RETURN TRUE;
    END IF;

    SELECT count(*)
    INTO v_count
    FROM public.user_cosmetics
    WHERE item_type = 'plate'
      AND item_id = 'founder';

    IF v_count >= p_seat_limit THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.user_cosmetics (
        user_id,
        item_type,
        item_id,
        acquired_via,
        source_order_id
    )
    VALUES (
        p_user_id,
        'plate',
        'founder',
        'founder_grant',
        p_source_id
    )
    ON CONFLICT (user_id, item_type, item_id) DO NOTHING;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_founder_plate_capped(INTEGER, TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_founder_plate_capped(INTEGER, TEXT, INTEGER)
    TO service_role;

-- ----------------------------------------------------------------
-- Invite lifecycle: mutation and audit happen in one DB transaction.
-- No invite code is copied into the moderator-visible audit payload.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_staff_invite(
    p_admin_user_id INTEGER,
    p_code TEXT,
    p_note TEXT,
    p_max_uses INTEGER,
    p_expires_at TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    id BIGINT,
    code VARCHAR(32),
    note TEXT,
    max_uses INTEGER,
    use_count INTEGER,
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_invite public.invite_codes%ROWTYPE;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.users
        WHERE users.id = p_admin_user_id
          AND COALESCE(users.status, 'active') = 'active'
    ) THEN
        -- Owner authorization is enforced by getStaffUser before this
        -- service-role-only RPC. The DB cannot see ADMIN_USERNAMES, so
        -- checking staff_role here would lock out an env breakglass owner.
        RAISE EXCEPTION 'Active staff actor required' USING ERRCODE = '42501';
    END IF;
    IF p_code IS NULL OR p_code !~ '^CRIB-[A-Z0-9]{4}-[A-Z0-9]{4}$' THEN
        RAISE EXCEPTION 'Invalid invite code' USING ERRCODE = '22023';
    END IF;
    IF p_note IS NULL OR char_length(trim(p_note)) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION 'Invite reason must be 10-500 characters'
            USING ERRCODE = '22023';
    END IF;
    IF p_max_uses NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Invalid max uses' USING ERRCODE = '22023';
    END IF;
    IF p_expires_at IS NOT NULL AND p_expires_at <= NOW() THEN
        RAISE EXCEPTION 'Invite expiry must be in the future'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.invite_codes (
        code,
        created_by,
        note,
        max_uses,
        expires_at
    )
    VALUES (
        p_code,
        p_admin_user_id,
        trim(p_note),
        p_max_uses,
        p_expires_at
    )
    RETURNING * INTO v_invite;

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
        'invite.create',
        NULL,
        jsonb_build_object(
            'invite_id', v_invite.id,
            'max_uses', v_invite.max_uses,
            'expires_at', v_invite.expires_at
        ),
        trim(p_note)
    );

    RETURN QUERY
    SELECT
        v_invite.id,
        v_invite.code,
        v_invite.note,
        v_invite.max_uses,
        v_invite.use_count,
        v_invite.expires_at,
        v_invite.revoked_at,
        v_invite.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_staff_invite(
    p_admin_user_id INTEGER,
    p_invite_id BIGINT,
    p_reason TEXT
)
RETURNS TABLE (
    id BIGINT,
    code VARCHAR(32),
    revoked_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_invite public.invite_codes%ROWTYPE;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.users
        WHERE users.id = p_admin_user_id
          AND COALESCE(users.status, 'active') = 'active'
    ) THEN
        RAISE EXCEPTION 'Active staff actor required' USING ERRCODE = '42501';
    END IF;
    IF p_invite_id IS NULL OR p_invite_id <= 0 THEN
        RAISE EXCEPTION 'Invalid invite id' USING ERRCODE = '22023';
    END IF;
    IF p_reason IS NULL OR char_length(trim(p_reason)) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION 'Revocation reason must be 10-500 characters'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_invite
    FROM public.invite_codes
    WHERE invite_codes.id = p_invite_id
      AND invite_codes.revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.invite_codes
    SET revoked_at = NOW()
    WHERE invite_codes.id = p_invite_id
    RETURNING * INTO v_invite;

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
        'invite.revoke',
        jsonb_build_object(
            'invite_id', v_invite.id,
            'max_uses', v_invite.max_uses,
            'use_count', v_invite.use_count,
            'expires_at', v_invite.expires_at
        ),
        jsonb_build_object('revoked_at', v_invite.revoked_at),
        trim(p_reason)
    );

    RETURN QUERY
    SELECT v_invite.id, v_invite.code, v_invite.revoked_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_staff_invite(
    INTEGER, TEXT, TEXT, INTEGER, TIMESTAMP WITH TIME ZONE
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_staff_invite(
    INTEGER, TEXT, TEXT, INTEGER, TIMESTAMP WITH TIME ZONE
) TO service_role;

REVOKE ALL ON FUNCTION public.revoke_staff_invite(INTEGER, BIGINT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_staff_invite(INTEGER, BIGINT, TEXT)
    TO service_role;
