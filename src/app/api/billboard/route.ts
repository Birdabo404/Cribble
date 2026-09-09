import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import type { BillboardHypeTier, BillboardItem } from '@/lib/billboard'
import {
  HYPE_KIND_PRIORITY,
  type BurnHypeEventKind,
  type HypeEventKind
} from '@/lib/hypeEvents'
import { createServiceClient } from '@/lib/supabaseServer'
import { exactDecimal } from '@/lib/tokenLeaderboard'

/** The rank tier inside each burn kind — the inverse of the kind
 *  mapping the derivation applies, so the item's tier/copy machinery
 *  stays board-blind. */
const BURN_HYPE_TIER: Record<BurnHypeEventKind, BillboardHypeTier> = {
  burn_throne: 'throne',
  burn_top3: 'top3',
  burn_top10: 'top10'
}

// THE BILLBOARD TRAIN is the same payload for every viewer (no session,
// no cookies), so it caches like /api/leaderboard/ai: the handler stays
// force-dynamic (never prerendered at build, where no DB should be hit)
// while the assembled train lives in the Data Cache for a minute, with
// an s-maxage CDN layer on top for the same lifetime. Plenty fresh for
// a ticker that shows at most once per 10 minutes per visitor.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

// Hype = one-shot events from billboard_hype_events (migrations 052 +
// 065): throne takes, TOP 3 / TOP 10 breakthroughs and 100K+ score
// clubs, plus the Burn Board's burn_* twins and $-milestone burn
// clubs, written at the moment they happened by the two snapshot diff
// passes, the score-notification flow and the usage route's burn-club
// pass. The read takes the recent window — mirroring
// MOVEMENT_WINDOW_MS in leaderboardEngine, the same freshness the
// board's climb arrows use — newest first, overshooting the airing cap
// so the in-code pick (tightest kind first, one event per user,
// inactive celebrants dropped) still fills the train.
const HYPE_WINDOW_MS = 48 * 3_600_000
const HYPE_MAX = 3
const HYPE_FETCH_MAX = 12

// The admin announcements API keeps at most one row live at a time —
// this cap is defensive, against hand-edited rows or a broken invariant.
const ANNOUNCE_MAX = 3

interface HypeEventRow {
  id: number
  /** Trusted from the table's CHECK constraint. */
  kind: HypeEventKind
  user_id: number
  /** The rank pair is NOT NULL on rank kinds, NULL on clubs. */
  rank: number | null
  prev_rank: number | null
  victim_user_id: number | null
  /** NULL on rank kinds, NOT NULL on clubs. */
  threshold: number | null
  /** The celebrant's season burn at climb time — burn rank kinds only,
   *  NULL elsewhere (migration 065). NUMERIC may arrive as a string. */
  burn_usd: number | string | null
  created_at: string
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

// The train item an event row airs as, or null when a rank kind is
// missing its rank pair / a club its threshold — impossible through
// the producers, armor against hand-edited rows. The victim lookup
// rides the same active-filtered users read as the celebrant: a
// banned or deleted victim degrades the card to victimless — the
// celebration survives, the callout doesn't.
function hypeEventItemOf(
  row: HypeEventRow,
  celebrant: TickerUserRow,
  usersById: Map<number, TickerUserRow>
): BillboardItem | null {
  const base = {
    id: Number(row.id),
    userId: Number(row.user_id),
    username: celebrant.twitter_username || `User${celebrant.id}`,
    displayName: celebrant.twitter_name || null,
    avatarUrl: celebrant.twitter_profile_image || null
  }
  const victimOf = () => {
    const victim =
      row.victim_user_id !== null
        ? usersById.get(Number(row.victim_user_id))
        : undefined
    return victim
      ? {
          username: victim.twitter_username || `User${victim.id}`,
          displayName: victim.twitter_name || null,
          avatarUrl: victim.twitter_profile_image || null
        }
      : null
  }
  switch (row.kind) {
    case 'throne':
    case 'top3':
    case 'top10': {
      if (row.rank === null || row.prev_rank === null) return null
      return {
        kind: 'hype',
        ...base,
        board: 'score',
        tier: row.kind,
        rank: Number(row.rank),
        prevRank: Number(row.prev_rank),
        movedAt: row.created_at,
        burnUsd: null,
        victim: victimOf()
      }
    }
    case 'burn_throne':
    case 'burn_top3':
    case 'burn_top10': {
      if (row.rank === null || row.prev_rank === null) return null
      return {
        kind: 'hype',
        ...base,
        board: 'burn',
        tier: BURN_HYPE_TIER[row.kind],
        rank: Number(row.rank),
        prevRank: Number(row.prev_rank),
        movedAt: row.created_at,
        // The season burn captured at climb time. NULL only through a
        // hand-edited row — the card then simply drops its dollar chip.
        burnUsd: row.burn_usd == null ? null : exactDecimal(row.burn_usd),
        victim: victimOf()
      }
    }
    case 'club':
    case 'burn_club': {
      if (row.threshold === null) return null
      return {
        kind: 'club',
        ...base,
        board: row.kind === 'burn_club' ? 'burn' : 'score',
        threshold: Number(row.threshold),
        reachedAt: row.created_at
      }
    }
    default: {
      const exhaustive: never = row.kind
      return exhaustive
    }
  }
}

const loadBillboardItems = unstable_cache(
  async (): Promise<BillboardItem[]> => {
    const supabase = createServiceClient()
    const now = new Date()
    const nowIso = now.toISOString()
    const hypeCutoffIso = new Date(now.getTime() - HYPE_WINDOW_MS).toISOString()

    // Recent one-shot hype events and live operator announcements
    // (migration 051's definition: LIVE + started + not yet ended),
    // side by side. Both reads degrade to empty lists, the same stance
    // /api/leaderboard takes on movement tracking when migration 012 is
    // missing — either table may not exist yet in environments behind
    // on migrations 051/052.
    const [hypeRes, announceRes] = await Promise.all([
      supabase
        .from('billboard_hype_events')
        .select(
          'id, kind, user_id, rank, prev_rank, victim_user_id, threshold, burn_usd, created_at'
        )
        .gte('created_at', hypeCutoffIso)
        .order('created_at', { ascending: false })
        .limit(HYPE_FETCH_MAX),
      supabase
        .from('billboard_announcements')
        .select('id, headline, body, link_url')
        .eq('status', 'LIVE')
        .lte('starts_at', nowIso)
        .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
        .order('starts_at', { ascending: true })
        .limit(ANNOUNCE_MAX)
    ])

    if (hypeRes.error) {
      console.warn('[Billboard] Hype read failed:', hypeRes.error.message)
    }
    const hypeRows = hypeRes.error
      ? []
      : ((hypeRes.data || []) as unknown as HypeEventRow[])

    if (announceRes.error) {
      console.warn('[Billboard] Announcements read failed:', announceRes.error.message)
    }
    const announcements = announceRes.error
      ? []
      : ((announceRes.data || []) as unknown as AnnounceRow[])

    // Pick what airs: tightest kind first (throne > top3 > top10 >
    // club), newest first within a kind, one event per user — a same-
    // window throne and club for the same player collapse to the
    // throne card. The HYPE_MAX cap lands during assembly, after the
    // active-user gate, so a dropped celebrant's slot backfills from
    // the overshoot instead of shorting the train.
    const seenHypeUsers = new Set<number>()
    const hypeCandidates = [...hypeRows]
      .sort(
        (a, b) =>
          HYPE_KIND_PRIORITY[a.kind] - HYPE_KIND_PRIORITY[b.kind] ||
          Date.parse(b.created_at) - Date.parse(a.created_at)
      )
      .filter((row) => {
        const userId = Number(row.user_id)
        if (seenHypeUsers.has(userId)) return false
        seenHypeUsers.add(userId)
        return true
      })

    // One users read for the hype side: the celebrant's and victim's
    // name/avatar. The active-status filter mirrors the leaderboard
    // query so a banned or suspended player never gets hyped — dropping
    // out of this map is exactly how an inactive celebrant kills their
    // event and an inactive victim mutes the callout.
    const hypeParticipantIds = hypeCandidates.flatMap((row) =>
      row.victim_user_id !== null
        ? [Number(row.user_id), Number(row.victim_user_id)]
        : [Number(row.user_id)]
    )
    const userIds = [...new Set(hypeParticipantIds)]

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
    // then hype/club events.
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
    let hypeAired = 0
    for (const row of hypeCandidates) {
      if (hypeAired >= HYPE_MAX) break
      const celebrant = usersById.get(Number(row.user_id))
      if (!celebrant) continue
      const item = hypeEventItemOf(row, celebrant, usersById)
      if (item === null) continue
      items.push(item)
      hypeAired++
    }
    return items
  },
  // Each payload-shape change burns a new key so a persisted older
  // train can't outlive the deploy. v2: ad items gained
  // companyName/linkHost (migration 034). v3: hype items gained
  // rank/prevRank for the announcement takeover. v4: the announce kind
  // joined the train (migration 051). v5: hype went event-driven off
  // billboard_hype_events (migration 052) — hype items gained
  // id/tier/victim and the club kind joined the train. v6: the Burn
  // Board joined (migration 065) — hype/club items gained the board
  // discriminator and hype items burnUsd.
  // v7: paid ad items left the train.
  ['billboard-items-v7'],
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
