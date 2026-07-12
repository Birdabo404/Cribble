-- ============================================================
-- Migration 015: close anon-key read access to waitlist PII and
-- strip default grants from the public API roles
-- ============================================================
-- Verified live (2026-07-12): the waitlist table (655 rows of
-- email + ip_address + user_agent) was fully readable with the
-- public anon key via the policy "Allow reads for waitlist"
-- (SELECT USING true). daily_metrics had the same open read.
-- All app access goes through the service-role client except the
-- waitlist route, which is being switched to the service client
-- in the same change set.
--
-- TRANSITIONAL POLICY: the currently-deployed waitlist route still
-- inserts with the anon key using INSERT ... RETURNING, and RETURNING
-- must pass a SELECT policy. Scoping reads to just-created rows keeps
-- deployed signups working until the service-client code ships, while
-- making the historical rows unreadable. Side effect until that deploy:
-- the public GET /api/waitlist count reads ~0.
--
-- FOLLOW-UP after the service-client route is deployed:
--   DROP POLICY IF EXISTS "waitlist_read_just_created" ON public.waitlist;
--   REVOKE ALL ON public.waitlist FROM anon;
-- ============================================================

-- 1. Waitlist / daily_metrics open read policies
DROP POLICY IF EXISTS "Allow reads for waitlist" ON public.waitlist;
CREATE POLICY "waitlist_read_just_created" ON public.waitlist
  FOR SELECT USING (created_at >= now() - interval '1 minute');

DROP POLICY IF EXISTS "public read" ON public.daily_metrics;

-- 2. Table privileges: the anon/authenticated roles need nothing except
--    the transitional waitlist access. RLS already denies rows on the
--    other tables, but revoking the grants also removes them from the
--    anon-visible GraphQL schema (Supabase linter 0026/0027).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT, INSERT ON public.waitlist TO anon;

-- 3. Functions: nothing in public should be callable with the public
--    keys. Explicit service_role grants on the SECURITY DEFINER RPCs
--    (register_user_device, recalculate_user_score, redeem_invite_code —
--    see migrations 008/014) are unaffected. Trigger functions keep
--    firing: EXECUTE is only checked at trigger creation time.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- 4. Future objects created by postgres default to no public-role access.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
