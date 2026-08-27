import { NextRequest, NextResponse } from 'next/server'
import {
  BILLBOARD_MAX_LIVE,
  isLiveAd,
  RAIL_SLOTS,
  type BillboardPlacement,
  type BillboardStatus,
  type RailSlot
} from '@/lib/billboard'
import {
  LEADERBOARD_SPONSOR_GRACE_MS,
  LEADERBOARD_SPONSOR_WINDOW_MS,
  classifySponsorRun,
  leaderboardMinTargetCents,
  type LeaderboardSponsorEntry
} from '@/lib/leaderboardSponsor'
import {
  loadSponsorBoard,
  sweepFinishedLeaderboardSponsorAds
} from '@/lib/leaderboardSponsorServer'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Billboard admin overview — any staff (billboard.review, the same
// moderator-floor gate as the review decisions, so moderators can work
// the acceptance queue; only activation stays owner-only). The finished-
// run sweep runs lazily at the top of every GET, so the page can never
// show a stale finished run. One call returns every bucket the queue
// page renders:
//   queue       — PENDING + CHANGES_REQUESTED, oldest first (FIFO review)
//   awaiting    — APPROVED but not yet live: manual payment/activation
//                 pending (flipper/rail), or bidding open with no paid
//                 contribution yet (leaderboard — self-serve Polar,
//                 nothing for the operator to work)
//   live        — flipper/rail: APPROVED + paid + inside the 7-day
//                 window, ending soonest first; leaderboard: APPROVED
//                 with the last paid bid's 24h window still running, in
//                 rank order after the windowed ads
//   runComplete — leaderboard only: every contribution expired but the
//                 24h grace is still open; each row carries
//                 autoArchivesAt (when the sweep will archive it unless
//                 a new bid lands)
//   recent      — REJECTED / ARCHIVED / expired APPROVED, newest first
// Windowed live/expired are derived with isLiveAd rather than stored,
// matching migration 030. Leaderboard lifecycle comes from
// classifySponsorRun over a DIRECT aggregate of PAID bids (latest
// paid_at per ad), so bucketing never depends on the board derivation
// succeeding: when loadSponsorBoard fails, boardDegraded=true and live
// leaderboard rows just lose their standing decoration (rank/total)
// instead of misfiling into awaiting. If the bids aggregate itself
// fails the route returns 500 — it would rather be down than lie.
// The server-computed counts object is the single number source both
// admin pages render, so their KPIs can never disagree. Owner identity
// is FK-embedded; owner_user_id NULL means an admin-inserted external-
// sponsor ad and ships owner: null.

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
   *  Null while the creative is off the board, null on every
   *  leaderboard row when the board read failed (boardDegraded) — and
   *  always null on flipper/rail ads, whose liveness is the 7-day
   *  window instead. */
  leaderboard: Pick<
    LeaderboardSponsorEntry,
    'rank' | 'activeCents' | 'nextDropAt' | 'expiresAt'
  > | null
}

/** A leaderboard creative inside the run-complete grace window: still
 *  APPROVED and biddable, archived automatically at autoArchivesAt
 *  unless a new paid bid lands first. */
interface AdminBillboardRunCompleteAd extends AdminBillboardAd {
  autoArchivesAt: string
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

    // Lazy sweep before the reads: finished runs archive (and notify)
    // right now, so the buckets below never show one. Never throws.
    await sweepFinishedLeaderboardSponsorAds(supabase, now)

    const [active, decided, sponsorBoard, paidBids] = await Promise.all([
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
      // Best-effort DECORATION only (rank, totals, expiry): the board
      // here is not what buckets ads anymore — the bids aggregate below
      // is — so a bids-table hiccup degrades to standing-less rows plus
      // boardDegraded: true instead of misfiling live ads.
      loadSponsorBoard(supabase, now).catch((err): null => {
        console.error('[AdminBillboard] Sponsor board read failed:', err)
        return null
      }),
      // The bucketing source of truth for leaderboard lifecycle: every
      // PAID bid's ad_id + paid_at, aggregated to latest-per-ad below.
      // Kept independent of loadSponsorBoard on purpose.
      supabase.from('leaderboard_sponsor_bids').select('ad_id, paid_at').eq('status', 'PAID')
    ])

    if (active.error || decided.error) {
      console.error(
        '[AdminBillboard] Queue query failed:',
        active.error ?? decided.error
      )
      return NextResponse.json({ error: 'Failed to load sponsor ads' }, { status: 500 })
    }
    if (paidBids.error) {
      // Without the bids aggregate the leaderboard buckets would be
      // guesses — refuse to serve wrong ones.
      console.error('[AdminBillboard] Paid bids query failed:', paidBids.error)
      return NextResponse.json({ error: 'Failed to load sponsor bids' }, { status: 500 })
    }

    const boardDegraded = sponsorBoard === null
    const boardByAdId = new Map(
      (sponsorBoard ?? []).map((entry) => [entry.adId, entry])
    )

    // Latest paid_at per creative — classifySponsorRun's single input.
    const lastPaidAtMsByAdId = new Map<number, number>()
    for (const row of (paidBids.data ?? []) as Array<{ ad_id: number; paid_at: string }>) {
      const adId = Number(row.ad_id)
      const paidAtMs = Date.parse(row.paid_at)
      if (!Number.isFinite(paidAtMs)) continue
      const current = lastPaidAtMsByAdId.get(adId)
      if (current === undefined || paidAtMs > current) {
        lastPaidAtMsByAdId.set(adId, paidAtMs)
      }
    }

    const queue: AdminBillboardAd[] = []
    const awaiting: AdminBillboardAd[] = []
    const live: AdminBillboardAd[] = []
    const runComplete: AdminBillboardRunCompleteAd[] = []
    const expired: AdminBillboardAd[] = []

    for (const row of active.data ?? []) {
      const ad = shapeAd(row as Record<string, unknown>, boardByAdId)
      if (ad.status === 'PENDING' || ad.status === 'CHANGES_REQUESTED') {
        queue.push(ad)
      } else if (ad.placement === 'leaderboard') {
        // Leaderboard creatives have no 7-day window (migration 055):
        // their lifecycle is the run classifier over the latest paid
        // bid. bidding_open sits with awaiting (self-serve, nothing to
        // work), live is showing on the board right now, run_complete
        // rides its own bucket with the auto-archive deadline. A
        // 'finished' straggler (the sweep just failed) surfaces as
        // run-complete with its already-past deadline rather than
        // misfiling as awaiting.
        const lastPaidAtMs = lastPaidAtMsByAdId.get(ad.id) ?? null
        if (lastPaidAtMs === null) {
          awaiting.push(ad)
        } else {
          const runState = classifySponsorRun(lastPaidAtMs, now.getTime())
          switch (runState) {
            case 'bidding_open':
              awaiting.push(ad)
              break
            case 'live':
              live.push(ad)
              break
            case 'run_complete':
            case 'finished': {
              runComplete.push({
                ...ad,
                autoArchivesAt: new Date(
                  lastPaidAtMs +
                    LEADERBOARD_SPONSOR_WINDOW_MS +
                    LEADERBOARD_SPONSOR_GRACE_MS
                ).toISOString()
              })
              break
            }
            default: {
              const exhaustive: never = runState
              return exhaustive
            }
          }
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
    // its natural order. (With a degraded board every leaderboard rank
    // is unknown; they just group with the windowed sort.)
    live.sort((a, b) => {
      if ((a.leaderboard !== null) !== (b.leaderboard !== null)) {
        return a.leaderboard !== null ? 1 : -1
      }
      if (a.leaderboard && b.leaderboard) return a.leaderboard.rank - b.leaderboard.rank
      return (a.ends_at ?? '').localeCompare(b.ends_at ?? '')
    })
    runComplete.sort((a, b) => a.autoArchivesAt.localeCompare(b.autoArchivesAt))

    const recent = [
      ...(decided.data ?? []).map((row) =>
        shapeAd(row as Record<string, unknown>, boardByAdId)
      ),
      ...expired
    ]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, RECENT_LIMIT)

    const flipperLive = live.filter((ad) => ad.placement === 'flipper').length
    const railLive = live.filter((ad) => ad.placement === 'rail').length

    return NextResponse.json({
      success: true,
      queue,
      awaiting,
      live,
      runComplete,
      recent,
      // True when the sponsor-board decoration failed to load: live
      // leaderboard rows are still bucketed correctly (the bids
      // aggregate is what classifies them) but carry leaderboard: null,
      // and leaderboardMinTargetCents below falls back to the opening
      // price. The page renders a degraded banner off this.
      boardDegraded,
      // One live pricing value for every admin preview. Awaiting
      // leaderboard creatives use it as the total their first payment
      // must reach; live creatives use it as the board-wide OUTBID CTA.
      leaderboardMinTargetCents: leaderboardMinTargetCents(
        sponsorBoard?.[0]?.activeCents ?? 0
      ),
      // The single server-computed number source BOTH admin pages render
      // verbatim — the overview/list count mismatch is impossible by
      // construction.
      counts: {
        queue: queue.length,
        awaiting: awaiting.length,
        live: live.length,
        runComplete: runComplete.length,
        flipperLive,
        railLive,
        maxFlipper: BILLBOARD_MAX_LIVE,
        maxRail: RAIL_SLOTS.length
      },
      // Legacy pair kept until the pages migrate to counts: the flipper/
      // rail occupancy KPI against maxLive (leaderboard creatives have
      // no cap and are excluded; the live ARRAY above still carries
      // them for the queue page).
      liveCount: flipperLive + railLive,
      maxLive: BILLBOARD_MAX_LIVE
    })
  } catch (err) {
    console.error('[AdminBillboard] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
