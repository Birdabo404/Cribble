import { NextRequest, NextResponse } from 'next/server'
import {
  BILLBOARD_MAX_LIVE,
  isLiveAd,
  type BillboardPlacement,
  type BillboardStatus,
  type RailSlot
} from '@/lib/billboard'
import type { LeaderboardSponsorEntry } from '@/lib/leaderboardSponsor'
import { loadSponsorBoard } from '@/lib/leaderboardSponsorServer'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Billboard admin overview — any staff (billboard.review, the same
// moderator-floor gate as the review decisions, so moderators can work
// the acceptance queue; only activation stays owner-only). One call
// returns every bucket the queue page renders:
//   queue    — PENDING + CHANGES_REQUESTED, oldest first (FIFO review)
//   awaiting — APPROVED but not yet live: manual payment/activation
//              pending (flipper/rail), or bidding open with no active
//              contribution yet (leaderboard — self-serve Polar, nothing
//              for the operator to work)
//   live     — flipper/rail: APPROVED + paid + inside the 7-day window,
//              ending soonest first; leaderboard: APPROVED + standing on
//              the sponsor board (migration 055), in rank order after
//              the windowed ads
//   recent   — REJECTED / ARCHIVED / expired APPROVED, newest first
// Windowed live/expired are derived with isLiveAd rather than stored,
// matching migration 030. Leaderboard liveness is the sponsor-board
// derivation instead — each leaderboard ad is decorated with its board
// standing (rank, active total, expiry pair) so the queue can show the
// money facts without a second call. Owner identity is FK-embedded;
// owner_user_id NULL means an admin-inserted external-sponsor ad and
// ships owner: null.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

// The billboard is a manually-worked list capped at 8 live slots — these
// limits exist to bound the payload, not for pagination.
const ACTIVE_LIMIT = 200
const RECENT_LIMIT = 25

// billboard_ads has two FKs into users (owner_user_id, reviewed_by), so
// the embed names the owner constraint explicitly, like the feedback route.
const AD_COLUMNS = `id, owner_user_id, text, company_name, link_url, logo_url, accent_color, placement, rail_slot, requested_rail_slot, billing_email, status, review_note,
   reviewed_at, paid_at, starts_at, ends_at, clicks, created_at, updated_at,
   owner:users!billboard_ads_owner_user_id_fkey(id, twitter_username, twitter_name, twitter_profile_image)`

interface AdminBillboardAd {
  id: number
  owner_user_id: number | null
  text: string
  company_name: string | null
  link_url: string
  logo_url: string | null
  accent_color: string | null
  placement: BillboardPlacement
  rail_slot: RailSlot | null
  requested_rail_slot: RailSlot | null
  /** Where the approval payment email goes; NULL (external sponsors,
   *  pre-040 rows) means the send is skipped and ops chases on X. */
  billing_email: string | null
  status: BillboardStatus
  review_note: string | null
  reviewed_at: string | null
  paid_at: string | null
  starts_at: string | null
  ends_at: string | null
  clicks: number
  created_at: string
  updated_at: string
  owner: {
    userId: number
    username: string | null
    display_name: string
    avatar: string | null
  } | null
  /** Sponsor-board standing for 'leaderboard' creatives (migration
   *  055), decorated from the same derivation the public board serves.
   *  Null while the creative is off the board — and always null on
   *  flipper/rail ads, whose liveness is the 7-day window instead. */
  leaderboard: Pick<
    LeaderboardSponsorEntry,
    'rank' | 'activeCents' | 'nextDropAt' | 'expiresAt'
  > | null
}

// PostgREST returns the FK-embedded owner as a single object (many-to-
// one), but without generated DB types the client infers an array —
// hence the unknown hop (same as the feedback and audit routes).
function shapeAd(
  row: Record<string, unknown>,
  boardByAdId: Map<number, LeaderboardSponsorEntry>
): AdminBillboardAd {
  const owner = row.owner as unknown as {
    id: number
    twitter_username: string | null
    twitter_name: string | null
    twitter_profile_image: string | null
  } | null
  const boardEntry =
    row.placement === 'leaderboard' ? boardByAdId.get(Number(row.id)) : undefined

  return {
    id: Number(row.id),
    owner_user_id: row.owner_user_id === null ? null : Number(row.owner_user_id),
    text: String(row.text ?? ''),
    company_name: (row.company_name as string | null) ?? null,
    link_url: String(row.link_url ?? ''),
    logo_url: (row.logo_url as string | null) ?? null,
    accent_color: (row.accent_color as string | null) ?? null,
    placement: row.placement as BillboardPlacement,
    rail_slot: (row.rail_slot as RailSlot | null) ?? null,
    requested_rail_slot: (row.requested_rail_slot as RailSlot | null) ?? null,
    billing_email: (row.billing_email as string | null) ?? null,
    status: row.status as BillboardStatus,
    review_note: (row.review_note as string | null) ?? null,
    reviewed_at: (row.reviewed_at as string | null) ?? null,
    paid_at: (row.paid_at as string | null) ?? null,
    starts_at: (row.starts_at as string | null) ?? null,
    ends_at: (row.ends_at as string | null) ?? null,
    clicks: Number(row.clicks) || 0,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    owner: owner
      ? {
          userId: Number(owner.id),
          username: owner.twitter_username ?? null,
          display_name:
            owner.twitter_name || owner.twitter_username || `User${owner.id}`,
          avatar: owner.twitter_profile_image ?? null
        }
      : null,
    leaderboard: boardEntry
      ? {
          rank: boardEntry.rank,
          activeCents: boardEntry.activeCents,
          nextDropAt: boardEntry.nextDropAt,
          expiresAt: boardEntry.expiresAt
        }
      : null
  }
}

const byCreatedAsc = (a: AdminBillboardAd, b: AdminBillboardAd) =>
  a.created_at.localeCompare(b.created_at)

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'billboard.review')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  try {
    const now = new Date()
    const [active, decided, sponsorBoard] = await Promise.all([
      supabase
        .from('billboard_ads')
        .select(AD_COLUMNS)
        .in('status', ['PENDING', 'CHANGES_REQUESTED', 'APPROVED'])
        .order('created_at', { ascending: false })
        .limit(ACTIVE_LIMIT),
      supabase
        .from('billboard_ads')
        .select(AD_COLUMNS)
        .in('status', ['REJECTED', 'ARCHIVED'])
        .order('updated_at', { ascending: false })
        .limit(RECENT_LIMIT),
      // Best-effort: the board here is admin decoration, not the paid
      // product (the public routes keep the throwing stance) — a bids-
      // table hiccup must not take the review queue down. Degrading to
      // an empty board shows live leaderboard creatives as awaiting,
      // minus their standing facts.
      loadSponsorBoard(supabase, now).catch((err): LeaderboardSponsorEntry[] => {
        console.error('[AdminBillboard] Sponsor board read failed:', err)
        return []
      })
    ])

    if (active.error || decided.error) {
      console.error(
        '[AdminBillboard] Queue query failed:',
        active.error ?? decided.error
      )
      return NextResponse.json({ error: 'Failed to load sponsor ads' }, { status: 500 })
    }

    const boardByAdId = new Map(sponsorBoard.map((entry) => [entry.adId, entry]))
    const queue: AdminBillboardAd[] = []
    const awaiting: AdminBillboardAd[] = []
    const live: AdminBillboardAd[] = []
    const expired: AdminBillboardAd[] = []

    for (const row of active.data ?? []) {
      const ad = shapeAd(row as Record<string, unknown>, boardByAdId)
      if (ad.status === 'PENDING' || ad.status === 'CHANGES_REQUESTED') {
        queue.push(ad)
      } else if (ad.placement === 'leaderboard') {
        // Leaderboard creatives have no 7-day window (migration 055):
        // APPROVED with a board standing is showing on the leaderboard
        // right now, so it buckets live; APPROVED without one is just
        // open for self-serve bidding and sits with awaiting. Neither
        // ever expires into recent — the total decays contribution by
        // contribution instead.
        if (ad.leaderboard) {
          live.push(ad)
        } else {
          awaiting.push(ad)
        }
      } else if (isLiveAd(ad, now)) {
        live.push(ad)
      } else if (ad.ends_at && new Date(ad.ends_at).getTime() < now.getTime()) {
        // APPROVED with a window entirely in the past: the 7 days ran out.
        expired.push(ad)
      } else {
        // APPROVED with no window yet — waiting on manual payment + activation.
        awaiting.push(ad)
      }
    }

    queue.sort(byCreatedAsc)
    awaiting.sort(byCreatedAsc)
    // Windowed ads keep ending-soonest-first; leaderboard creatives (no
    // window) follow in board-rank order — one list, each product in
    // its natural order.
    live.sort((a, b) => {
      if ((a.leaderboard !== null) !== (b.leaderboard !== null)) {
        return a.leaderboard !== null ? 1 : -1
      }
      if (a.leaderboard && b.leaderboard) return a.leaderboard.rank - b.leaderboard.rank
      return (a.ends_at ?? '').localeCompare(b.ends_at ?? '')
    })

    const recent = [
      ...(decided.data ?? []).map((row) =>
        shapeAd(row as Record<string, unknown>, boardByAdId)
      ),
      ...expired
    ]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, RECENT_LIMIT)

    return NextResponse.json({
      success: true,
      queue,
      awaiting,
      live,
      recent,
      // The dashboard's occupancy KPI reads this against maxLive (the
      // flipper cap) — leaderboard creatives have no cap and are
      // excluded from the count; the live ARRAY above still carries
      // them for the queue page.
      liveCount: live.filter((ad) => ad.placement !== 'leaderboard').length,
      maxLive: BILLBOARD_MAX_LIVE
    })
  } catch (err) {
    console.error('[AdminBillboard] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
