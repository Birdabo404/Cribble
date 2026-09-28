import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isDodoConfigured } from '@/lib/dodo'
import { getSessionUserId } from '@/lib/sessionAuth'
import {
  acknowledgeCheckoutReturn,
  syncPlateOrdersFromDodo,
  syncSubscriptionFromDodo,
  type CheckoutReturnRef
} from '@/lib/subscriptionSync'
import { createServiceClient } from '@/lib/supabaseServer'

// POST /api/user/subscription/sync — reconcile the signed-in user's tier
// AND paid plate purchases straight from Dodo. The shop calls it after
// checkout=success and from RE-CHECK, since local dev never receives
// webhooks; in production it backstops missed webhook deliveries.
// Upgrade-only (see subscriptionSync).
//
// Body (optional): { paymentId?: string, subscriptionId?: string } — the
// ids Dodo appended to the return URL the shop just bounced back from;
// verified against Dodo, used to link the Dodo customer to this account,
// and acknowledged with a deduped "order confirmed" notification.
// No-body POSTs keep working (RE-CHECK).
//
// Contract: { success: true, tier, isPro, changed, grantedPlates }

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const bodySchema = z.object({
  paymentId: z.string().min(1).optional(),
  subscriptionId: z.string().min(1).optional()
})

/** The optional checkout-return body. Invalid JSON / no body / wrong shape
 *  all resolve to null — the historical no-body POST must keep working. */
async function readCheckoutReturnRef(request: NextRequest): Promise<CheckoutReturnRef | null> {
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return null
    const { paymentId, subscriptionId } = parsed.data
    if (!paymentId && !subscriptionId) return null
    return { paymentId, subscriptionId }
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

    if (!isDodoConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Shop is not configured yet' },
        { status: 503 }
      )
    }

    // Ack first: it links the Dodo customer (which the syncs below need
    // on a first purchase) and the feed reads "order confirmed" ->
    // "delivered". Best-effort: a bad id, Dodo error or ownership
    // mismatch is logged inside the helper and never fails the sync.
    const ref = await readCheckoutReturnRef(request)
    if (ref) {
      await acknowledgeCheckoutReturn(supabase, session.userId, ref)
    }

    const { tier, isPro, changed } = await syncSubscriptionFromDodo(supabase, session.userId)
    const grantedPlates = await syncPlateOrdersFromDodo(supabase, session.userId)
    return NextResponse.json({ success: true, tier, isPro, changed, grantedPlates })
  } catch (error) {
    console.error('[SubscriptionSync] POST error:', error)
    return NextResponse.json({ success: false, error: 'Sync failed' }, { status: 500 })
  }
}
