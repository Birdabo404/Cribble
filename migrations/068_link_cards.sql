-- ============================================================
-- Migration 068: HANGAR link cards
-- ============================================================
-- The HANGAR tab on /u/[username] shows up to six pinned builds. The
-- pins themselves are user data and live where every other profile
-- field lives — users.metadata.pins, an ordered JSONB array of URLs
-- (no users change needed). What a pin RESOLVES to (GitHub stars,
-- language, last push; a site's og:title and favicon) is not user
-- data: two pilots pinning the same repo share one card. That cache
-- is this table.
--
--   url_key    — canonical identity of the link (lib/hangar/normalize
--                urlKey): lowercase scheme+host, no www., no hash, no
--                tracking params, no trailing slash; github.com repos
--                collapse to /owner/repo. The join key from pins.
--   url        — the URL that was resolved (as pinned, post-cleanup).
--   kind       — which resolver produced the card.
--   card       — the HangarCardData JSON the profile serves verbatim.
--   status     — ok = card is real; failed = resolve failed and card
--                holds the `pending` shape. Failed rows are retried
--                after 1h; ok rows after 24h (github) / 7d (site).
--   fetched_at — drives that staleness; refreshes are pull-based
--                (stale-while-revalidate from the profile route and
--                the pins PATCH), no cron.
--
-- Server code (lib/hangar/cards.ts) tolerates this table not existing
-- yet: pins render as pending and nothing is written until it lands.
-- Safe to run multiple times. Service-role only; no RLS policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.link_cards (
  url_key TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  kind TEXT NOT NULL
    CONSTRAINT link_cards_kind_supported
      CHECK (kind IN ('github', 'site')),
  card JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ok'
    CONSTRAINT link_cards_status_supported
      CHECK (status IN ('ok', 'failed')),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Housekeeping only (sweeping rows nobody pins any more); every read
-- path goes through the primary key.
CREATE INDEX IF NOT EXISTS link_cards_fetched_at_idx
  ON public.link_cards (fetched_at);

COMMENT ON TABLE public.link_cards IS
  'Shared, non-user cache of resolved HANGAR pin cards keyed by canonical URL. Written by the server resolvers; pins themselves live in users.metadata.pins.';
COMMENT ON COLUMN public.link_cards.url_key IS
  'Canonical link identity from lib/hangar/normalize urlKey; the join key from users.metadata.pins.';
COMMENT ON COLUMN public.link_cards.kind IS
  'Resolver that produced the card: github (REST API) or site (Open Graph / favicon).';
COMMENT ON COLUMN public.link_cards.card IS
  'HangarCardData JSON served verbatim on the profile; the pending shape when status is failed.';
COMMENT ON COLUMN public.link_cards.status IS
  'ok = real card; failed = last resolve failed (retried after 1h).';
COMMENT ON COLUMN public.link_cards.fetched_at IS
  'When the card was last resolved; stale after 24h (github) / 7d (site) for ok rows, 1h for failed rows.';

ALTER TABLE public.link_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.link_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.link_cards TO service_role;
