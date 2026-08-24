-- ============================================================
-- Migration 054: First-party site visitor pulse
-- ============================================================
-- Replaces the DataFast realtime/overview feed behind the
-- leaderboard visitor ticker. Each browser heartbeats a SHA-256
-- hash of (salt + IP + user-agent); the IP itself is never stored.
-- Rows older than 12 hours are deleted on every write and every
-- pulse read, so the table is a rolling unique-visitor window, not
-- a log.
--
-- live    = distinct hashes seen in the last 5 minutes
-- last12h = remaining rows after the 12-hour prune
--
-- Service-role only. Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_visits (
    visitor_hash TEXT PRIMARY KEY
        CHECK (visitor_hash ~ '^[0-9a-f]{64}$'),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_visits_last_seen
    ON public.site_visits (last_seen_at);

COMMENT ON TABLE public.site_visits IS
    'Rolling 12-hour unique-visitor hashes for the leaderboard ticker. No IPs, no accounts, no page paths.';

ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_visits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_visits TO service_role;

CREATE OR REPLACE FUNCTION public.touch_site_visit(p_visitor_hash TEXT)
RETURNS TABLE (
    live INTEGER,
    last12h INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_visitor_hash IS NULL OR p_visitor_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid visitor hash' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.site_visits (visitor_hash, last_seen_at)
    VALUES (p_visitor_hash, v_now)
    ON CONFLICT (visitor_hash) DO UPDATE
    SET last_seen_at = v_now;

    DELETE FROM public.site_visits
    WHERE site_visits.last_seen_at < v_now - INTERVAL '12 hours';

    RETURN QUERY
    SELECT
        count(*) FILTER (
            WHERE site_visits.last_seen_at >= v_now - INTERVAL '5 minutes'
        )::integer,
        count(*)::integer
    FROM public.site_visits;
END;
$$;

CREATE OR REPLACE FUNCTION public.site_visitor_pulse()
RETURNS TABLE (
    live INTEGER,
    last12h INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    DELETE FROM public.site_visits
    WHERE site_visits.last_seen_at < v_now - INTERVAL '12 hours';

    RETURN QUERY
    SELECT
        count(*) FILTER (
            WHERE site_visits.last_seen_at >= v_now - INTERVAL '5 minutes'
        )::integer,
        count(*)::integer
    FROM public.site_visits;
END;
$$;

COMMENT ON FUNCTION public.touch_site_visit(TEXT) IS
    'Upsert a visitor hash, prune rows older than 12 hours, return live + last-12h counts.';
COMMENT ON FUNCTION public.site_visitor_pulse() IS
    'Prune rows older than 12 hours and return live + last-12h unique visitor counts.';

REVOKE ALL ON FUNCTION public.touch_site_visit(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_site_visit(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.site_visitor_pulse()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_visitor_pulse() TO service_role;
