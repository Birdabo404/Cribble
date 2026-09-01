import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { resolveShareOrigin } from '@/lib/appUrl'
import { readAccountIsPrivate } from '@/lib/publicProfile'
import { JsonLd } from '@/lib/seo'
import { createServiceClient } from '@/lib/supabaseServer'
import LeaderboardClient from './LeaderboardClient'

// The arena is fully client-rendered (15s polling) — the shell itself can
// be served static. ISR keeps the JSON-LD standings below at most ~5
// minutes stale without putting the page render on the request path.
export const revalidate = 300

// <= 160 chars so search snippets and unfurls show the whole pitch.
const DESCRIPTION =
  'The live AI usage leaderboard: developers ranked by real usage of ' +
  'Cursor, ChatGPT, Claude and more. Track ranks, scores, streaks and 24h gains.'

// Bare title — the root layout supplies the '%s · Cribble' template.
export const metadata: Metadata = {
  title: 'AI Usage Leaderboard',
  description: DESCRIPTION,
  alternates: { canonical: '/leaderboard' },
  // Unfurl image: the generated root card (src/app/opengraph-image.tsx),
  // referenced explicitly — defining openGraph here replaces the parent's
  // whole openGraph object, so the root file-based image does NOT cascade
  // into this page (Next merges metadata shallowly, by design).
  openGraph: {
    title: 'AI Usage Leaderboard',
    description: DESCRIPTION,
    url: '/leaderboard',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Cribble — a worldwide leaderboard for AI users.'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Usage Leaderboard',
    description: DESCRIPTION,
    images: ['/opengraph-image']
  }
}

/** One ItemList entry: display name + the /u/ profile slug. */
interface JsonLdStanding {
  username: string
  name: string
}

/** Minimal projection of the canonical ranker's row — see
 *  CanonicalStandingRow in src/app/api/leaderboard/route.ts. */
interface StandingRow {
  rank: number | string
  twitter_username: string | null
  twitter_name: string | null
  metadata: Record<string, unknown> | null
}

const JSONLD_TOP_N = 10

/** Top of the season standings for the ItemList JSON-LD. Reads the same
 *  `leaderboard_standings` RPC (migration 059) as /api/leaderboard — the
 *  full board assembly there is module-private to the route handler, so
 *  this stays a deliberately tiny read: rank + identity only, no cosmetics,
 *  movement, or privacy-gated tool data. Errors are thrown (never cached)
 *  and handled by the page, which renders without JSON-LD. */
const loadTopStandings = unstable_cache(
  async (): Promise<JsonLdStanding[]> => {
    const supabase = createServiceClient()
    // Over-fetch so private accounts — excluded from structured data, their
    // profile pages are noindex — can drop out and still leave a full list.
    const { data, error } = await supabase.rpc('leaderboard_standings', {
      p_board: 'season',
      p_limit: JSONLD_TOP_N * 2
    })
    if (error) throw new Error(error.message)

    const rows = ((data || []) as unknown as StandingRow[]).slice()
    rows.sort((a, b) => Number(a.rank) - Number(b.rank))

    const standings: JsonLdStanding[] = []
    for (const row of rows) {
      if (standings.length >= JSONLD_TOP_N) break
      const username = row.twitter_username
      // No username means no /u/ page to link; skip rather than fabricate.
      if (!username || readAccountIsPrivate(row.metadata)) continue
      standings.push({ username, name: row.twitter_name || `@${username}` })
    }
    return standings
  },
  ['leaderboard-jsonld-top'],
  { revalidate: 300 }
)

export default async function LeaderboardPage() {
  // JSON-LD is decoration: any failure (DB unreachable, missing envs at
  // build, RPC not migrated) renders the page without it, never a crash.
  let standings: JsonLdStanding[] = []
  try {
    standings = await loadTopStandings()
  } catch {
    standings = []
  }

  const origin = resolveShareOrigin()

  return (
    <>
      {standings.length > 0 && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: 'AI Usage Leaderboard',
            description: DESCRIPTION,
            url: `${origin}/leaderboard`,
            itemListOrder: 'https://schema.org/ItemListOrderAscending',
            numberOfItems: standings.length,
            itemListElement: standings.map((row, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              name: row.name,
              url: `${origin}/u/${row.username}`
            }))
          }}
        />
      )}
      {/* LeaderboardClient wraps its useSearchParams consumer in its own
          Suspense boundary (see the shell comment at its default export),
          so no additional boundary is needed here. */}
      <LeaderboardClient />
    </>
  )
}
