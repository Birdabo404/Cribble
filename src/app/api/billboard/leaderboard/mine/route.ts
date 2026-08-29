import { NextRequest, NextResponse } from 'next/server'
import type { BillboardStatus } from '@/lib/billboard'
import {
  LEADERBOARD_SPONSOR_OPENING_CENTS,
  LEADERBOARD_SPONSOR_PENDING_TTL_MS,
  leaderboardMinTargetCents,
  type LeaderboardSponsorMine,
  type LeaderboardSponsorMineCreative
} from '@/lib/leaderboardSponsor'
import { loadSponsorBoard, sponsorLinkHostOf } from '@/lib/leaderboardSponsorServer'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSponsorIdentity } from '@/lib/sponsorAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// GET /api/billboard/leaderboard/mine — the owner's (signed-in user or
// claim-cookie guest, migration 063; a visitor with neither still 401s)
// leaderboard sponsor creatives (migration 055), every review
// lifecycle stage included: approval status and the admin's redo/
// reject note, the creative fields, clicks, the active contribution
// total with its board rank and expiry pair (null while off the
// board), and the cents sitting in still-PENDING checkouts so the UI
// can warn about an in-flight payment instead of double-charging.
// Rides the same fresh board derivation as the public route, so the
// rank shown here can never disagree with the board a poll just
// painted.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

interface MineAdRow {
  id: number
  status: BillboardStatus
  review_note: string | null
  text: string
  company_name: string | null
  link_url: string
  logo_url: string | null
  accent_color: string | null
  clicks: number
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const identityResult = await getSponsorIdentity(request)
    if (!identityResult.ok) {
      return NextResponse.json(
        { error: identityResult.error },
        { status: identityResult.status }
      )
    }
    const identity = identityResult.identity
    if (identity.kind === 'none') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const adsQuery = supabase
      .from('billboard_ads')
      .select(
        'id, status, review_note, text, company_name, link_url, logo_url, accent_color, clicks'
      )
    const pendingQuery = supabase.from('leaderboard_sponsor_bids').select('ad_id, amount_cents')
    const [adsRes, board, pendingRes] = await Promise.all([
      (identity.kind === 'user'
        ? adsQuery.eq('owner_user_id', identity.userId)
        : adsQuery.eq('guest_id', identity.guestId)
      )
        .eq('placement', 'leaderboard')
        .order('created_at', { ascending: false }),
      loadSponsorBoard(supabase, now),
      // Only LIVE pending checkouts count toward the double-charge
      // warning — a row still PENDING past the TTL is an abandoned
      // checkout Polar has already expired, and it must not scare the
      // buyer forever.
      (identity.kind === 'user'
        ? pendingQuery.eq('user_id', identity.userId)
        : pendingQuery.eq('guest_id', identity.guestId)
      )
        .eq('status', 'PENDING')
        .gt('created_at', new Date(now.getTime() - LEADERBOARD_SPONSOR_PENDING_TTL_MS).toISOString())
    ])

    if (adsRes.error) {
      console.error('[LeaderboardSponsorMine] Ads lookup failed:', adsRes.error)
      return NextResponse.json({ error: 'Failed to load your creatives' }, { status: 500 })
    }
    if (pendingRes.error) {
      console.error('[LeaderboardSponsorMine] Pending bids lookup failed:', pendingRes.error)
      return NextResponse.json({ error: 'Failed to load your bids' }, { status: 500 })
    }

    const pendingCentsByAd = new Map<number, number>()
    for (const row of (pendingRes.data || []) as Array<{ ad_id: number; amount_cents: number }>) {
      const adId = Number(row.ad_id)
      pendingCentsByAd.set(adId, (pendingCentsByAd.get(adId) ?? 0) + Number(row.amount_cents))
    }

    const entryByAd = new Map(board.map((entry) => [entry.adId, entry]))
    const creatives: LeaderboardSponsorMineCreative[] = (
      (adsRes.data || []) as unknown as MineAdRow[]
    ).map((ad) => {
      const entry = entryByAd.get(Number(ad.id))
      return {
        adId: Number(ad.id),
        status: ad.status,
        reviewNote: ad.review_note,
        companyName: ad.company_name,
        linkHost: sponsorLinkHostOf(ad.link_url),
        text: ad.text,
        logoUrl: ad.logo_url,
        accentColor: ad.accent_color,
        clicks: Number(ad.clicks) || 0,
        activeCents: entry?.activeCents ?? 0,
        rank: entry?.rank ?? null,
        nextDropAt: entry?.nextDropAt ?? null,
        expiresAt: entry?.expiresAt ?? null,
        pendingCents: pendingCentsByAd.get(Number(ad.id)) ?? 0
      }
    })

    const top = board[0] ?? null
    const payload: LeaderboardSponsorMine = {
      creatives,
      minTargetCents: leaderboardMinTargetCents(top?.activeCents ?? 0),
      openingCents: LEADERBOARD_SPONSOR_OPENING_CENTS,
      serverTime: now.toISOString()
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[LeaderboardSponsorMine] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
