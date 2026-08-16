import { NextRequest, NextResponse } from 'next/server'
import {
  BILLBOARD_MAX_LIVE,
  isLiveAd,
  type BillboardPlacement,
  type BillboardStatus,
  type RailSlot
} from '@/lib/billboard'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Billboard admin overview — owner only, the same gate as the decision
// routes so a moderator can't even enumerate submissions. One call
// returns every bucket the queue page renders:
//   queue    — PENDING + CHANGES_REQUESTED, oldest first (FIFO review)
//   awaiting — APPROVED but not yet live: payment/activation pending
//   live     — APPROVED + paid + inside the window, ending soonest first
//   recent   — REJECTED / ARCHIVED / expired APPROVED, newest first
// Live/expired are derived with isLiveAd rather than stored, matching
// migration 030. Owner identity is FK-embedded; owner_user_id NULL means
// an admin-inserted external-sponsor ad and ships owner: null.

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
}

// PostgREST returns the FK-embedded owner as a single object (many-to-
// one), but without generated DB types the client infers an array —
// hence the unknown hop (same as the feedback and audit routes).
function shapeAd(row: Record<string, unknown>): AdminBillboardAd {
  const owner = row.owner as unknown as {
    id: number
    twitter_username: string | null
    twitter_name: string | null
    twitter_profile_image: string | null
  } | null

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
    const [active, decided] = await Promise.all([
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
        .limit(RECENT_LIMIT)
    ])

    if (active.error || decided.error) {
      console.error(
        '[AdminBillboard] Queue query failed:',
        active.error ?? decided.error
      )
      return NextResponse.json({ error: 'Failed to load billboard ads' }, { status: 500 })
    }

    const now = new Date()
    const queue: AdminBillboardAd[] = []
    const awaiting: AdminBillboardAd[] = []
    const live: AdminBillboardAd[] = []
    const expired: AdminBillboardAd[] = []

    for (const row of active.data ?? []) {
      const ad = shapeAd(row as Record<string, unknown>)
      if (ad.status === 'PENDING' || ad.status === 'CHANGES_REQUESTED') {
        queue.push(ad)
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
    live.sort((a, b) => (a.ends_at ?? '').localeCompare(b.ends_at ?? ''))

    const recent = [
      ...(decided.data ?? []).map((row) => shapeAd(row as Record<string, unknown>)),
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
      liveCount: live.length,
      maxLive: BILLBOARD_MAX_LIVE
    })
  } catch (err) {
    console.error('[AdminBillboard] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
