-- ============================================================
-- Migration 022: Close transitional public waitlist access
-- ============================================================
-- Migration 015 temporarily left anon SELECT/INSERT privileges plus a
-- one-minute SELECT policy so the then-deployed anon-key route could keep
-- using INSERT ... RETURNING. The current /api/waitlist route uses the
-- service-role client for reads and writes, so that compatibility window
-- now exposes fresh email/IP/user-agent PII without serving the app.
-- ============================================================

DROP POLICY IF EXISTS "waitlist_read_just_created" ON public.waitlist;

REVOKE ALL ON TABLE public.waitlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.waitlist TO service_role;
