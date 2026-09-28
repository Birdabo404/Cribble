import { NextRequest, NextResponse } from 'next/server'
import { isDodoActive } from '@/lib/dodo'
import { syncFromDodo } from '@/lib/dodoSync'
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

    if (!isDodoActive() && !isPolarConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Shop is not configured yet' },
        { status: 503 }
      )
    }

    // Ack first so the feed reads "order confirmed" -> "delivered".
    // Best-effort: a bad id, provider error or ownership mismatch is logged
    // inside the helper and never fails the sync. Dodo session ids are
    // acknowledged inside syncFromDodo; Polar ids stay on the Polar helper.
    const checkoutId = await readCheckoutId(request)
    if (checkoutId && isPolarConfigured() && !checkoutId.startsWith('cks_')) {
      await insertCheckoutAckNotification(supabase, session.userId, checkoutId)
    }

    const dodo = isDodoActive()
      ? await syncFromDodo(supabase, session.userId, checkoutId)
      : null
    const polar = isPolarConfigured()
      ? await syncSubscriptionFromPolar(supabase, session.userId)
      : null
    const polarPlates = isPolarConfigured()
      ? await syncPlateOrdersFromPolar(supabase, session.userId)
      : 0

    const tier = polar?.tier ?? dodo?.tier ?? 'FREE'
    const isPro = polar?.isPro ?? dodo?.isPro ?? false
    const changed = Boolean(dodo?.changed) || Boolean(polar?.changed)
    const grantedPlates = (dodo?.grantedPlates ?? 0) + polarPlates
    return NextResponse.json({ success: true, tier, isPro, changed, grantedPlates })
  } catch (error) {
    console.error('[SubscriptionSync] POST error:', error)
    return NextResponse.json({ success: false, error: 'Sync failed' }, { status: 500 })
  }
}
