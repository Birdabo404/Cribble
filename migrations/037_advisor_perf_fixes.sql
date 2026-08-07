-- ============================================================
-- Migration 037: Advisor performance fixes
-- ============================================================
-- Clears three classes of Supabase performance-advisor findings:
--
-- 1. auth_rls_initplan: RLS policies called auth.role() /
--    auth.email() / auth.uid() / current_setting() once per ROW.
--    Wrapping each call as (SELECT ...) lets the planner cache it
--    as an InitPlan evaluated once per statement. Policy names,
--    command types, roles, PERMISSIVE semantics, and row logic
--    are otherwise unchanged from the live definitions. Two
--    user_sessions policies that were exact duplicates are
--    dropped outright and not recreated.
-- 2. duplicate_index: identical indexes taxed every write on the
--    hottest tables; exactly one survivor is kept per column set.
-- 3. unindexed_foreign_keys: covering indexes for FK columns
--    that had none.
-- Safe to run multiple times.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. RLS init-plan fixes
-- ----------------------------------------------------------------

-- events_raw

DROP POLICY IF EXISTS "service role full access" ON public.events_raw;
CREATE POLICY "service role full access" ON public.events_raw
    FOR ALL
    USING ((SELECT auth.role()) = 'service_role'::text);

-- extension_user_mappings

DROP POLICY IF EXISTS "Service role can manage extension mappings" ON public.extension_user_mappings;
CREATE POLICY "Service role can manage extension mappings" ON public.extension_user_mappings
    FOR ALL
    USING ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS "Users can view their own extension mappings" ON public.extension_user_mappings;
CREATE POLICY "Users can view their own extension mappings" ON public.extension_user_mappings
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM user_sessions
            WHERE user_sessions.user_id = extension_user_mappings.twitter_user_id
              AND (user_sessions.session_token)::text =
                  (SELECT current_setting('app.current_session_token'::text, true))
              AND user_sessions.expires_at > now()
        )
    );

-- founding_members

DROP POLICY IF EXISTS "Service role can manage founding members" ON public.founding_members;
CREATE POLICY "Service role can manage founding members" ON public.founding_members
    FOR ALL
    USING ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS "Users can view their own founding member record" ON public.founding_members;
CREATE POLICY "Users can view their own founding member record" ON public.founding_members
    FOR SELECT
    USING ((SELECT auth.email()) = (email)::text);

-- user_sessions

DROP POLICY IF EXISTS "Service role can manage sessions" ON public.user_sessions;
CREATE POLICY "Service role can manage sessions" ON public.user_sessions
    FOR ALL
    USING ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS "Users can view their own sessions" ON public.user_sessions;
CREATE POLICY "Users can view their own sessions" ON public.user_sessions
    FOR SELECT
    USING (
        (session_token)::text =
            (SELECT current_setting('app.current_session_token'::text, true))
    );

-- These two were exact duplicates of the two policies above (same
-- command, roles, and USING clause), so every query evaluated the
-- same predicate twice. Drop them for good; the survivors cover them.
DROP POLICY IF EXISTS "service_role_can_manage_sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "users_can_view_own_sessions" ON public.user_sessions;

-- user_subscriptions

DROP POLICY IF EXISTS "service role full access" ON public.user_subscriptions;
CREATE POLICY "service role full access" ON public.user_subscriptions
    FOR ALL
    USING ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS "users read own subscription" ON public.user_subscriptions;
CREATE POLICY "users read own subscription" ON public.user_subscriptions
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

-- users

DROP POLICY IF EXISTS "Service role can manage users" ON public.users;
CREATE POLICY "Service role can manage users" ON public.users
    FOR ALL
    USING ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
CREATE POLICY "Users can view their own profile" ON public.users
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM user_sessions
            WHERE user_sessions.user_id = users.id
              AND (user_sessions.session_token)::text =
                  (SELECT current_setting('app.current_session_token'::text, true))
              AND user_sessions.expires_at > now()
        )
    );

-- ----------------------------------------------------------------
-- 2. Drop duplicate indexes (one survivor per identical column set)
-- ----------------------------------------------------------------

-- events_raw (device_uuid, timestamp DESC): keep idx_events_raw_device_timestamp.
DROP INDEX IF EXISTS public.idx_events_device_time;
DROP INDEX IF EXISTS public.idx_events_raw_device_timestamp_desc;

-- events_raw (user_id): keep idx_events_raw_user_id.
DROP INDEX IF EXISTS public.events_raw_user_id_idx;

-- events_raw (user_id, timestamp DESC): keep idx_events_raw_user_timestamp.
DROP INDEX IF EXISTS public.idx_events_raw_user_timestamp_desc;
DROP INDEX IF EXISTS public.idx_events_user_time;

-- events_raw (user_id, domain, timestamp): both plain indexes duplicated
-- the UNIQUE index unique_event_per_user_domain_timestamp on the exact
-- same columns, which already serves dedup lookups and any scan on
-- (user_id, domain, timestamp). Keep only the unique index.
DROP INDEX IF EXISTS public.idx_events_raw_dedup;
DROP INDEX IF EXISTS public.idx_events_raw_user_domain_timestamp;

-- user_devices (user_id): keep idx_user_devices_user_id.
DROP INDEX IF EXISTS public.idx_user_devices_user;

-- user_scores (total_score DESC): keep idx_user_scores_total_score.
DROP INDEX IF EXISTS public.idx_user_scores_total;

-- user_sessions (expires_at): keep idx_user_sessions_expires.
DROP INDEX IF EXISTS public.idx_sessions_expires;

-- user_sessions (session_token): the UNIQUE constraint index
-- user_sessions_session_token_key already serves exact token lookups,
-- and idx_user_sessions_expiry (session_token, expires_at) covers the
-- token + expiry validation path, so both single-column copies are
-- dead weight on a table written during every auth flow.
DROP INDEX IF EXISTS public.idx_sessions_token;
DROP INDEX IF EXISTS public.idx_user_sessions_token;

-- user_sessions (user_id): keep idx_user_sessions_user_id.
DROP INDEX IF EXISTS public.idx_sessions_user_id;

-- ----------------------------------------------------------------
-- 3. Missing foreign-key covering indexes
-- ----------------------------------------------------------------

-- billboard_ads.reviewed_by -> users(id): reviewer lookups and the
-- ON DELETE SET NULL cascade otherwise sequential-scan billboard_ads.
CREATE INDEX IF NOT EXISTS idx_billboard_ads_reviewed_by
    ON public.billboard_ads(reviewed_by);

-- season_results.user_id -> users(id): the PK is (season_id, user_id),
-- so user_id is not a leading column anywhere; per-user standings reads
-- and the ON DELETE CASCADE need their own index.
CREATE INDEX IF NOT EXISTS idx_season_results_user_id
    ON public.season_results(user_id);
