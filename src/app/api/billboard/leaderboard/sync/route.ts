import { NextRequest, NextResponse } from 'next/server'
import {
  syncSponsorBidCheckoutFromPolar,
  syncSponsorBidsFromPolar
} from '@/lib/leaderboardSponsorServer'
import { isPolarConfigured } from '@/lib/polar'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// POST /api/billboard/leaderboard/sync — reconcile the signed-in
// buyer's PENDING sponsor bids straight from Polar, the bid twin of
// /api/user/subscription/sync. The buyer page calls it after bouncing
// back from checkout with lb_checkout=success, since local dev never
// receives webhooks; in production it lets the returning buyer see
// their rank promptly even when webhook delivery lags. Each paid
// order runs through the same verification gate as the webhook
// (product, amount, buyer against the ledger row), so this path can
// never activate anything the webhook would refuse. Activation-only —
// refunds stay the webhook's job.
//
// Body (optional): { checkoutId: string }. The success return leg always
// sends it; no-body callers keep the broad pending-row reconciliation.
// Contract (targeted): { success: true, activated: 0|1, status }
// Contract (broad):    { success: true, activated: number }

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

async function readCheckoutId(request: NextRequest): Promise<string | null> {
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const checkoutId = (body as Record<string, unknown>).checkoutId
    return typeof checkoutId === 'string' && checkoutId ? checkoutId : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    if (!isPolarConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Sponsor bidding is not configured yet' },
        { status: 503 }
      )
    }

    const checkoutId = await readCheckoutId(request)
    if (checkoutId) {
      const status = await syncSponsorBidCheckoutFromPolar(
        supabase,
        session.userId,
        checkoutId
      )
      return NextResponse.json({
        success: true,
        activated: status === 'activated' ? 1 : 0,
        status
      })
    }

    const activated = await syncSponsorBidsFromPolar(supabase, session.userId)
    return NextResponse.json({ success: true, activated })
  } catch (error) {
    console.error('[LeaderboardBidSync] POST error:', error)
    return NextResponse.json({ success: false, error: 'Sync failed' }, { status: 500 })
  }
}
