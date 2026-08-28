import { NextRequest, NextResponse } from 'next/server'
import { syncBillboardSlotCheckoutFromPolar } from '@/lib/billboardSlotServer'
import { isPolarConfigured } from '@/lib/polar'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// POST /api/billboard/checkout/sync — reconcile the exact slot
// checkout Polar just returned, the slot twin of
// /api/billboard/leaderboard/sync's targeted leg. The buyer page calls
// it after bouncing back from checkout with bb_checkout=success, since
// local dev never receives webhooks; in production it lets the
// returning buyer see their window promptly even when webhook delivery
// lags. The paid order runs through the same verification gate as the
// webhook (product, gross amount, buyer against the ledger row), so
// this path can never activate anything the webhook would refuse.
// Activation-only — refunds stay the webhook's job.
//
// Body: { checkoutId: string } — always present on the success return
// leg, required here (there is no broad reconciliation: a slot buyer
// holds at most one in-flight checkout per ad, and the exact id is
// always in hand).
// Contract: { success: true, activated: 0|1, status } with status one
// of activated | already_active | pending | refunded | refused |
// not_found.

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
        { success: false, error: 'Slot checkout is not configured yet' },
        { status: 503 }
      )
    }

    const checkoutId = await readCheckoutId(request)
    if (!checkoutId) {
      return NextResponse.json({ error: 'checkoutId is required' }, { status: 400 })
    }

    const status = await syncBillboardSlotCheckoutFromPolar(
      supabase,
      session.userId,
      checkoutId
    )
    return NextResponse.json({
      success: true,
      activated: status === 'activated' ? 1 : 0,
      status
    })
  } catch (error) {
    console.error('[BillboardSlotSync] POST error:', error)
    return NextResponse.json({ success: false, error: 'Sync failed' }, { status: 500 })
  }
}
