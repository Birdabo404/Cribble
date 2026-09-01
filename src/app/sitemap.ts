// sitemap.xml — static public routes plus every public /u/[username]
// profile. Profiles are the programmatic-SEO surface, so they're ordered
// most-recently-active first (last_extension_sync) and capped so the
// response stays a sane size. Regenerated hourly via ISR so the DB isn't
// hit per crawl.

import type { MetadataRoute } from 'next'
import { unstable_cache } from 'next/cache'
import { resolveShareOrigin } from '@/lib/appUrl'
import { createServiceClient } from '@/lib/supabaseServer'

export const revalidate = 3600

/** Hard cap on profile URLs — well under the 50k-per-sitemap protocol
 *  limit, and enough that the cap only trims long-inactive accounts. */
const PROFILE_URL_CAP = 20_000

/** PostgREST caps rows per request (typically 1k), so the profile list
 *  is paged; each page asks for this many rows. */
const PROFILE_PAGE_SIZE = 1_000

interface SitemapUserRow {
  twitter_username: string | null
  last_extension_sync: string | null
  /** metadata->is_private JSON value: true when the owner opted into
   *  private mode (same literal-true read as publicProfile.ts's
   *  readAccountIsPrivate — anything else is public). */
  is_private: unknown
}

/**
 * All indexable profile URLs: named accounts that aren't banned and
 * aren't in private mode. Throws on query failure; the caller degrades
 * to static routes only.
 */
async function loadProfileEntries(origin: string): Promise<MetadataRoute.Sitemap> {
  const supabase = createServiceClient()
  const entries: MetadataRoute.Sitemap = []

  for (let offset = 0; offset < PROFILE_URL_CAP; offset += PROFILE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('users')
      .select('twitter_username, last_extension_sync, is_private:metadata->is_private')
      .not('twitter_username', 'is', null)
      // status NULL predates migration 003 and reads as active — a bare
      // .neq would drop those rows along with the banned ones.
      .or('status.is.null,status.neq.banned')
      .order('last_extension_sync', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + PROFILE_PAGE_SIZE - 1)

    if (error) throw error

    const rows = (data ?? []) as SitemapUserRow[]
    for (const row of rows) {
      if (!row.twitter_username || row.is_private === true) continue
      entries.push({
        url: `${origin}/u/${encodeURIComponent(row.twitter_username)}`,
        lastModified: row.last_extension_sync
          ? new Date(row.last_extension_sync)
          : undefined,
        changeFrequency: 'daily',
        priority: 0.6
      })
    }

    if (rows.length < PROFILE_PAGE_SIZE) break
  }

  return entries
}

// createServiceClient pins every read to cache: 'no-store', which would
// opt this whole route out of static rendering (revalidate = 3600
// silently ignored, the DB paged on every crawl). unstable_cache lifts
// the reads into the Data Cache so the route stays ISR — same pattern
// as the leaderboard page's standings read. Errors still propagate
// uncached, so a failed load retries on the next request. Note the
// Date in lastModified JSON-round-trips to its ISO string, which the
// sitemap serializer accepts as-is.
const loadProfileEntriesCached = unstable_cache(loadProfileEntries, ['sitemap-profiles'], {
  revalidate: 3600
})

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = resolveShareOrigin()

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${origin}/`,
      changeFrequency: 'weekly',
      priority: 1
    },
    {
      url: `${origin}/leaderboard`,
      changeFrequency: 'hourly',
      priority: 1
    },
    {
      url: `${origin}/teams`,
      changeFrequency: 'daily',
      priority: 0.8
    },
    {
      url: `${origin}/welcome`,
      changeFrequency: 'monthly',
      priority: 0.5
    },
    {
      url: `${origin}/sponsorship`,
      changeFrequency: 'monthly',
      priority: 0.4
    },
    {
      url: `${origin}/status`,
      changeFrequency: 'monthly',
      priority: 0.3
    },
    {
      url: `${origin}/privacy`,
      changeFrequency: 'yearly',
      priority: 0.2
    }
  ]

  // A DB hiccup must degrade to a valid static-routes sitemap, never a
  // 500 — crawlers back off hard on erroring sitemaps.
  let profileEntries: MetadataRoute.Sitemap = []
  try {
    profileEntries = await loadProfileEntriesCached(origin)
  } catch (error) {
    console.error('[Sitemap] Profile query failed; serving static routes only:', error)
  }

  return [...staticEntries, ...profileEntries]
}
