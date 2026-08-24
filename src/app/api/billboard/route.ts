import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { BILLBOARD_MAX_LIVE, type BillboardItem } from '@/lib/billboard'
import { createServiceClient } from '@/lib/supabaseServer'

// THE BILLBOARD TRAIN is the same payload for every viewer (no session,
// no cookies), so it caches like /api/leaderboard/ai: the handler stays
// force-dynamic (never prerendered at build, where no DB should be hit)
// while the assembled train lives in the Data Cache for a minute, with
// an s-maxage CDN layer on top for the same lifetime. Plenty fresh for
// a ticker that shows at most once per 10 minutes per visitor.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

// Hype = players who just broke into the top 3: current rank <= 3,
// previous rank outside it (prev_rank in leaderboard_ranks is the rank
// held immediately before the most recent movement — NULL on entries
// that never moved, which SQL comparison excludes for free), and the
// movement inside the last 48h. The window mirrors MOVEMENT_WINDOW_MS
// in leaderboardEngine — the same freshness the board's climb arrows
// use.
const HYPE_TOP_RANK = 3
const HYPE_WINDOW_MS = 48 * 3_600_000
const HYPE_MAX = 3

// The admin announcements API keeps at most one row live at a time —
// this cap is defensive, against hand-edited rows or a broken invariant.
const ANNOUNCE_MAX = 3

interface LiveAdRow {
  id: number
  text: string
  company_name: string | null
  link_url: string
  logo_url: string | null
  accent_color: string | null
  owner_user_id: number | null
}

// Title-line fallback for ads without a company_name (pre-034 rows):
// the link's bare hostname, lowercased, leading 'www.' stripped.
// link_url was validated at submission, but parse defensively — a bad
// stored URL degrades that ad's host to '' instead of killing the train.
function linkHostOf(linkUrl: string): string {
  try {
    return new URL(linkUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

interface HypeRankRow {
  user_id: number
  rank: number
  prev_rank: number | null
  rank_moved_at: string | null
}

interface AnnounceRow {
  id: number
  headline: string
  body: string
  link_url: string | null
}

interface TickerUserRow {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
}

const loadBillboardItems = unstable_cache(
  async (): Promise<BillboardItem[]> => {
    const supabase = createServiceClient()
    const now = new Date()
    const nowIso = now.toISOString()
    const hypeCutoffIso = new Date(now.getTime() - HYPE_WINDOW_MS).toISOString()

    // Live flipper ads (migration 030's definition: APPROVED + paid +
    // now inside the window; rail ads ride their own feed since
    // migration 035), fresh top-3 breakthroughs and live operator
    // announcements (migration 050's definition: LIVE + started + not
    // yet ended), side by side. The ads read is the paid product — it
    // throws; the hype and announcement reads degrade to empty lists,
    // the same stance /api/leaderboard takes on movement tracking when
    // migration 012 is missing — the announcements table in particular
    // may not exist yet in environments behind on migration 050.
    const [adsRes, ranksRes, announceRes] = await Promise.all([
      supabase
        .from('billboard_ads')
        .select('id, text, company_name, link_url, logo_url, accent_color, owner_user_id')
        .eq('placement', 'flipper')
        .eq('status', 'APPROVED')
        .not('paid_at', 'is', null)
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso)
        .order('starts_at', { ascending: true })
        .limit(BILLBOARD_MAX_LIVE),
      supabase
        .from('leaderboard_ranks')
        .select('user_id, rank, prev_rank, rank_moved_at')
        .lte('rank', HYPE_TOP_RANK)
        .gt('prev_rank', HYPE_TOP_RANK)
        .gte('rank_moved_at', hypeCutoffIso)
        .order('rank', { ascending: true })
        .limit(HYPE_MAX),
      supabase
        .from('billboard_announcements')
        .select('id, headline, body, link_url')
        .eq('status', 'LIVE')
        .lte('starts_at', nowIso)
        .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
        .order('starts_at', { ascending: true })
        .limit(ANNOUNCE_MAX)
    ])

    if (adsRes.error) {
      throw new Error(`billboard_ads read failed: ${adsRes.error.message}`)
    }
    const ads = (adsRes.data || []) as unknown as LiveAdRow[]

    if (ranksRes.error) {
      console.warn('[Billboard] Hype read failed:', ranksRes.error.message)
    }
    const hypeRanks = ranksRes.error
      ? []
      : ((ranksRes.data || []) as unknown as HypeRankRow[])

    if (announceRes.error) {
      console.warn('[Billboard] Announcements read failed:', announceRes.error.message)
    }
    const announcements = announceRes.error
      ? []
      : ((announceRes.data || []) as unknown as AnnounceRow[])

    // One users read serves both sides: hype needs name/avatar, and an
    // ad without a logo falls back to its owner's avatar (migration
    // 030). The active-status filter mirrors the leaderboard query so a
    // banned or suspended player never gets hyped.
    const fallbackOwnerIds = ads
      .filter((ad) => !ad.logo_url && ad.owner_user_id !== null)
      .map((ad) => Number(ad.owner_user_id))
    const userIds = [
      ...new Set([...hypeRanks.map((row) => Number(row.user_id)), ...fallbackOwnerIds])
    ]

    const usersById = new Map<number, TickerUserRow>()
    if (userIds.length > 0) {
      const usersRes = await supabase
        .from('users')
        .select('id, twitter_username, twitter_name, twitter_profile_image')
        .in('id', userIds)
        .or('status.is.null,status.eq.active')
      if (usersRes.error) {
        console.warn('[Billboard] Users read failed:', usersRes.error.message)
      } else {
        for (const row of (usersRes.data || []) as unknown as TickerUserRow[]) {
          usersById.set(Number(row.id), row)
        }
      }
    }

    // Contract order (lib/billboard.ts): operator announcements first,
    // then hype, then live ads by starts_at ascending.
    const items: BillboardItem[] = []
    for (const row of announcements) {
      items.push({
        kind: 'announce',
        id: Number(row.id),
        headline: row.headline,
        body: row.body,
        linkUrl: row.link_url || null
      })
    }
    for (const row of hypeRanks) {
      const user = usersById.get(Number(row.user_id))
      if (!user || !row.rank_moved_at) continue
      items.push({
        kind: 'hype',
        userId: Number(row.user_id),
        username: user.twitter_username || `User${user.id}`,
        displayName: user.twitter_name || null,
        avatarUrl: user.twitter_profile_image || null,
        movedAt: row.rank_moved_at
      })
    }
    for (const ad of ads) {
      const ownerAvatar =
        ad.owner_user_id !== null
          ? usersById.get(Number(ad.owner_user_id))?.twitter_profile_image || null
          : null
      items.push({
        kind: 'ad',
        id: Number(ad.id),
        text: ad.text,
        companyName: ad.company_name || null,
        linkHost: linkHostOf(ad.link_url),
        logoUrl: ad.logo_url || ownerAvatar,
        accentColor: ad.accent_color || null
      })
    }
    return items
  },
  // Each payload-shape change burns a new key so a persisted older
  // train can't outlive the deploy. v2: ad items gained
  // companyName/linkHost (migration 034). v4: the announce kind joined
  // the train (migration 050).
  ['billboard-items-v4'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  try {
    const items = await loadBillboardItems()

    return NextResponse.json(
      { items },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`
        }
      }
    )
  } catch (err) {
    console.error('[Billboard] Unexpected error:', err)
    return NextResponse.json({ error: 'Failed to load the billboard' }, { status: 500 })
  }
}
