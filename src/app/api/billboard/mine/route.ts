import { NextRequest, NextResponse } from 'next/server'
import {
  isLiveAd,
  type BillboardPlacement,
  type BillboardStatus,
  type RailSlot
} from '@/lib/billboard'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSponsorIdentity } from '@/lib/sponsorAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// The buyer's own Billboard submissions, newest first — the status
// tracker on /billboard reads this. The buyer is the signed-in user or
// the claim-cookie guest (migration 063), transparently; a visitor with
// neither still gets the 401. Every lifecycle stage rides along:
// review_note carries the admin's redo/reject feedback, starts_at/ends_at
// + clicks describe a purchased window, and isLive is computed here with
// the shared isLiveAd helper so the client never re-derives the
// APPROVED + paid + in-window rule.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

interface MineRow {
  id: number
  status: BillboardStatus
  text: string
  company_name: string | null
  link_url: string
  logo_url: string | null
  accent_color: string | null
  placement: BillboardPlacement
  rail_slot: RailSlot | null
  requested_rail_slot: RailSlot | null
  billing_email: string | null
  review_note: string | null
  paid_at: string | null
  starts_at: string | null
  ends_at: string | null
  clicks: number
  created_at: string
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

    // paid_at is selected for the isLive computation but not returned —
    // payment bookkeeping stays between the admin and the database.
    const mineQuery = supabase
      .from('billboard_ads')
      .select(
        'id, status, text, company_name, link_url, logo_url, accent_color, placement, rail_slot, requested_rail_slot, billing_email, review_note, paid_at, starts_at, ends_at, clicks, created_at'
      )
    const { data, error } = await (identity.kind === 'user'
      ? mineQuery.eq('owner_user_id', identity.userId)
      : mineQuery.eq('guest_id', identity.guestId)
    ).order('created_at', { ascending: false })

    if (error) {
      console.error('[BillboardMine] Lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load your ads' }, { status: 500 })
    }

    const now = new Date()
    const ads = ((data ?? []) as MineRow[]).map((row) => ({
      id: row.id,
      status: row.status,
      text: row.text,
      company_name: row.company_name,
      link_url: row.link_url,
      logo_url: row.logo_url,
      accent_color: row.accent_color,
      placement: row.placement,
      rail_slot: row.rail_slot,
      requested_rail_slot: row.requested_rail_slot,
      // The owner's own billing contact — shown on the tracker so the
      // buyer knows where the payment instructions landed, and prefilled
      // into the edit form.
      billing_email: row.billing_email,
      review_note: row.review_note,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      clicks: Number(row.clicks) || 0,
      created_at: row.created_at,
      isLive: isLiveAd(row, now)
    }))

    return NextResponse.json({ success: true, ads })
  } catch (error) {
    console.error('[BillboardMine] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
