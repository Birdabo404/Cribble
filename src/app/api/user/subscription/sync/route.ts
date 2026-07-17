import { NextRequest, NextResponse } from 'next/server'
import { isPolarConfigured } from '@/lib/polar'
import { getSessionUserId } from '@/lib/sessionAuth'
import { syncSubscriptionFromPolar } from '@/lib/subscriptionSync'
import { createServiceClient } from '@/lib/supabaseServer'

// POST /api/user/subscription/sync — reconcile the signed-in user's tier
// straight from Polar. The shop calls it after checkout=success and from
// RE-CHECK, since local dev never receives webhooks. Upgrade-only (see
// syncSubscriptionFromPolar). Requires the Polar org token to carry the
// customers:read scope.
//
// Contract: { success: true, tier: string, isPro: boolean, changed: boolean }

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    if (!isPolarConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Shop is not configured yet' },
        { status: 503 }
      )
    }

    const { tier, isPro, changed } = await syncSubscriptionFromPolar(supabase, session.userId)
    return NextResponse.json({ success: true, tier, isPro, changed })
  } catch (error) {
    console.error('[SubscriptionSync] POST error:', error)
    return NextResponse.json({ success: false, error: 'Sync failed' }, { status: 500 })
  }
}
