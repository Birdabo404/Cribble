import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import type { Order } from '@polar-sh/sdk/models/components/order'
import type { Subscription } from '@polar-sh/sdk/models/components/subscription'
import { grantPlatePurchase, grantProEntitlement } from '@/lib/entitlementGrant'
import { getPolarWebhookSecret } from '@/lib/polar'
import { createServiceClient } from '@/lib/supabaseServer'

// Polar webhook receiver. Signature-verified (Standard Webhooks HMAC via
// the SDK), idempotent via the payment_events table (unique event_id):
// an event id that inserts cleanly is processed, a duplicate delivery is
// acked and skipped. Effects:
//   subscription.active   -> grantProEntitlement: tier 'PRO', premium_since,
//                            welcome notification — shared with the sync
//                            endpoint
//   subscription.revoked  -> subscription_tier 'PRO' -> 'FREE' (manually
//                            set tiers are left alone)
//   subscription.canceled -> no-op (Pro stays until the period ends)
//   order.paid            -> grant plate in user_cosmetics (if plate order)
//   order.refunded        -> delete user_cosmetics rows by source_order_id
// Everything else is recorded for audit and acked.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

type PolarEvent = ReturnType<typeof validateEvent>

/** The event types this endpoint subscribes to (scripts/setup-polar.ts).
 *  If the SDK fails to parse one of THESE, acking would silently drop a
 *  grant or revoke — so the route asks Polar to retry instead. Anything
 *  outside this set keeps the audit-and-ack behavior. */
const SUBSCRIBED_EVENT_TYPES = new Set([
  'subscription.active',
  'subscription.canceled',
  'subscription.uncanceled',
  'subscription.revoked',
  'order.paid',
  'order.refunded'
])

/** Polar external customer id -> users.id (set at checkout as String(userId)). */
function resolveUserId(externalId: string | null | undefined): number | null {
  if (!externalId) return null
  const id = parseInt(externalId, 10)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Plate id for an order: Polar product metadata `plate_id` (dashboard
 *  convention), checkout metadata `plateId` (set by /api/checkout), or
 *  its snake_case variant (hand-created orders). Null for plain
 *  subscription orders — nothing to grant. */
function readPlateId(order: Order): string | null {
  const candidates = [
    order.product?.metadata?.['plate_id'],
    order.metadata?.['plateId'],
    order.metadata?.['plate_id']
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number') return String(value)
  }
  return null
}

/** subscription.active -> full Pro fulfillment via the shared helper
 *  (tier, premium_since, welcome notification). */
async function activateProSubscription(subscription: Subscription) {
  const userId = resolveUserId(subscription.customer?.externalId)
  if (!userId) {
    console.warn('[PolarWebhook] Subscription event without usable externalId — skipping')
    return
  }

  await grantProEntitlement(supabase, userId, {
    productId: subscription.productId,
    sourceId: subscription.id
  })
}

/** subscription.revoked -> tier back to FREE, guarded to 'PRO' — the only
 *  value this integration writes. A manually granted PREMIUM/PREMIUM+
 *  survives a lapsed Polar sub (mirroring the upgrade-only sync); the
 *  admin panel's revoke_pro stays the explicit path for clearing manual
 *  tiers. Owned plate rows are never touched (one-time purchases outlive
 *  the sub); pro-exclusive equips self-heal at read time via
 *  resolveEquippedPlate. */
async function revokeProSubscription(subscription: Subscription) {
  const userId = resolveUserId(subscription.customer?.externalId)
  if (!userId) {
    console.warn('[PolarWebhook] Subscription event without usable externalId — skipping')
    return
  }

  const { error } = await supabase
    .from('users')
    .update({ subscription_tier: 'FREE' })
    .eq('id', userId)
    .eq('subscription_tier', 'PRO')

  if (error) {
    throw new Error(`Failed to set subscription_tier=FREE for user ${userId}: ${error.message}`)
  }
}

/** order.paid -> plate fulfillment via the shared purchase helper
 *  (ownership upsert + "delivered" notification), shared with the
 *  pull-based order reconciliation in subscriptionSync. */
async function grantPlateFromOrder(order: Order) {
  const plateId = readPlateId(order)
  if (!plateId) return // subscription-cycle order, no cosmetic attached

  const userId = resolveUserId(order.customer?.externalId)
  if (!userId) {
    console.warn('[PolarWebhook] order.paid without usable externalId — skipping')
    return
  }

  await grantPlatePurchase(supabase, userId, { plateId, orderId: order.id })
}

async function revokePlateFromOrder(order: Order) {
  const { error } = await supabase
    .from('user_cosmetics')
    .delete()
    .eq('source_order_id', order.id)

  if (error) {
    throw new Error(`Failed to revoke cosmetics for order ${order.id}: ${error.message}`)
  }
}

// Deliberately partial dispatch (not an exhaustive switch): only these four
// events have side effects; subscription.canceled and every other verified
// event type keeps its audit row and is acked with no DB effect.
async function processEvent(event: PolarEvent) {
  if (event.type === 'subscription.active') {
    await activateProSubscription(event.data)
  } else if (event.type === 'subscription.revoked') {
    await revokeProSubscription(event.data)
  } else if (event.type === 'order.paid') {
    await grantPlateFromOrder(event.data)
  } else if (event.type === 'order.refunded') {
    await revokePlateFromOrder(event.data)
  }
}

export async function POST(request: NextRequest) {
  const secret = getPolarWebhookSecret()
  if (!secret) {
    return NextResponse.json(
      { success: false, error: 'Webhook not configured' },
      { status: 503 }
    )
  }

  const rawBody = await request.text()

  let rawPayload: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rawPayload = parsed as Record<string, unknown>
    }
  } catch {
    rawPayload = null
  }

  // Signature check first — nothing touches the database on a bad signature.
  // event stays null when the signature is valid but the installed SDK
  // doesn't recognize the event type (Polar ships new ones over time);
  // those are recorded for audit and acked so Polar stops retrying.
  let event: PolarEvent | null = null
  try {
    event = validateEvent(
      rawBody,
      {
        'webhook-id': request.headers.get('webhook-id') ?? '',
        'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
        'webhook-signature': request.headers.get('webhook-signature') ?? ''
      },
      secret
    )
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ received: false }, { status: 403 })
    }
    console.warn('[PolarWebhook] Verified event with unrecognized shape — audit only:', error)
  }

  // A subscribed event the SDK could not parse must NOT be acked (and must
  // not burn its idempotency row) — 500 here makes Polar redeliver, and a
  // later SDK fix processes the retry.
  if (!event) {
    const rawType = typeof rawPayload?.type === 'string' ? rawPayload.type : null
    if (rawType && SUBSCRIBED_EVENT_TYPES.has(rawType)) {
      console.error(`[PolarWebhook] Failed to parse subscribed event ${rawType} — asking Polar to retry`)
      return NextResponse.json(
        { success: false, error: 'Failed to parse event' },
        { status: 500 }
      )
    }
  }

  const eventId =
    request.headers.get('webhook-id') ||
    createHash('sha256').update(rawBody).digest('hex')
  const eventType =
    event?.type ??
    (typeof rawPayload?.type === 'string' ? rawPayload.type : 'unknown')

  // Idempotency gate: first writer wins on event_id; a duplicate delivery
  // hits the unique constraint and gets acked without side effects.
  const { error: insertError } = await supabase.from('payment_events').insert({
    event_id: eventId,
    event_type: eventType,
    payload: rawPayload
  })

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, skipped: true })
    }
    console.error('[PolarWebhook] Failed to record event:', insertError)
    return NextResponse.json(
      { success: false, error: 'Failed to record event' },
      { status: 500 }
    )
  }

  if (!event) {
    return NextResponse.json({ received: true })
  }

  try {
    await processEvent(event)
  } catch (error) {
    console.error(`[PolarWebhook] Failed to process ${eventType} (${eventId}):`, error)
    // Release the idempotency marker so Polar's retry can re-process.
    await supabase.from('payment_events').delete().eq('event_id', eventId)
    return NextResponse.json(
      { success: false, error: 'Failed to process event' },
      { status: 500 }
    )
  }

  return NextResponse.json({ received: true })
}
