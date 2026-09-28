import { NextRequest, NextResponse } from 'next/server'
import { isPolarConfigured } from '@/lib/polar'
import { getSessionUserId } from '@/lib/sessionAuth'
import {
  insertCheckoutAckNotification,
  syncPlateOrdersFromPolar,
  syncSubscriptionFromPolar
} from '@/lib/subscriptionSync'
import { createServiceClient } from '@/lib/supabaseServer'

// POST /api/user/subscription/sync — reconcile the signed-in user's tier
// AND paid plate orders straight from Polar. The shop calls it after
// checkout=success and from RE-CHECK, since local dev never receives
// webhooks; in production it backstops missed webhook deliveries.
// Upgrade-only (see subscriptionSync). Requires the Polar org token to
// carry the customers:read + orders:read scopes.
//
// Body (optional): { checkoutId: string } — the Polar checkout the shop
// just bounced back from; verified against Polar and acknowledged with a
// deduped "order confirmed" notification. No-body POSTs keep working.
//
// Contract: { success: true, tier, isPro, changed, grantedPlates }

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** The optional { checkoutId } body. Invalid JSON / no body / wrong shape
 *  all resolve to null — the historical no-body POST must keep working. */
async function readCheckoutId(request: NextRequest): Promise<string | null> {
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const raw = (body as Record<string, unknown>).checkoutId
    return typeof raw === 'string' && raw ? raw : null
  } catch {
    return null
  }
}

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

    // Ack first so the feed reads "order confirmed" -> "delivered".
    // Best-effort: a bad id, Polar error or ownership mismatch is logged
    // inside the helper and never fails the sync.
    const checkoutId = await readCheckoutId(request)
    if (checkoutId) {
      await insertCheckoutAckNotification(supabase, session.userId, checkoutId)
    }

    const { tier, isPro, changed } = await syncSubscriptionFromPolar(supabase, session.userId)
    const grantedPlates = await syncPlateOrdersFromPolar(supabase, session.userId)
    return NextResponse.json({ success: true, tier, isPro, changed, grantedPlates })
  } catch (error) {
    console.error('[SubscriptionSync] POST error:', error)
    return NextResponse.json({ success: false, error: 'Sync failed' }, { status: 500 })
  }
}
