import { NextRequest, NextResponse } from 'next/server'
import { syncSponsorBidsFromPolar } from '@/lib/leaderboardSponsorServer'
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
// Contract: { success: true, activated: number }

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

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

    const activated = await syncSponsorBidsFromPolar(supabase, session.userId)
    return NextResponse.json({ success: true, activated })
  } catch (error) {
    console.error('[LeaderboardBidSync] POST error:', error)
    return NextResponse.json({ success: false, error: 'Sync failed' }, { status: 500 })
  }
}
