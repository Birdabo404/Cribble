-- ============================================================
-- Migration 021: Preserve env-based breakglass invite access
-- ============================================================
-- Migration 020 originally repeated an owner-role check inside the
-- invite RPCs. Postgres cannot see ADMIN_USERNAMES, so an operator
-- newly added to the env allowlist could pass getStaffUser but fail
-- the transaction until their next OAuth login refreshed is_admin.
--
-- The RPCs remain service-role-only. Application authorization is the
-- owner gate; the DB independently requires a real, active actor row.
-- Fresh databases receive these same definitions from migration 020.
-- ============================================================

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
