import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import type { Order } from '@polar-sh/sdk/models/components/order'
import type { Subscription } from '@polar-sh/sdk/models/components/subscription'
import {
  activateBillboardSlotFromOrder,
  revokeBillboardSlotFromOrder
} from '@/lib/billboardSlotServer'
import {
  grantPlatePurchase,
  grantProEntitlement,
  grantTeamEntitlement
} from '@/lib/entitlementGrant'
import {
  activateSponsorBidFromOrder,
  revokeSponsorBidFromOrder
} from '@/lib/leaderboardSponsorServer'
import { getPolarWebhookSecret, isTeamSubscription } from '@/lib/polar'
import { createServiceClient } from '@/lib/supabaseServer'

// Polar webhook receiver. Signature-verified (Standard Webhooks HMAC via
// the SDK), idempotent via the payment_events table (unique event_id):
// an event id that inserts cleanly is processed, a duplicate delivery is
// acked and skipped. Effects:
//   subscription.active   -> team product (configured id or team_key
//                            product metadata): grantTeamEntitlement
//                            (tier 'TEAM', review gate, team_since);
//                            anything else: grantProEntitlement (tier
//                            'PRO', premium_since, welcome notification
//                            — shared with the sync endpoint)
//   subscription.revoked  -> tier back to 'FREE', guarded to the tier
//                            this integration granted ('TEAM' for team
//                            products, 'PRO' otherwise); manually set
//                            tiers are left alone
//   subscription.canceled -> no-op (the tier stays until the period ends)
//   order.paid            -> grant plate in user_cosmetics (if plate
//                            order), activate a leaderboard sponsor
//                            bid (if kind='leaderboard_bid' metadata /
//                            the sponsor product), or activate a
//                            billboard slot window (if
//                            kind='billboard_slot' metadata / the slot
//                            product) — each after verifying the order
//                            against its PENDING ledger row
//   order.refunded        -> delete user_cosmetics rows by
//                            source_order_id + revoke any sponsor bid
//                            or billboard slot order (PENDING or PAID)
//                            by the order's checkout id, falling back
//                            to polar_order_id — a refund beating
//                            order.paid to delivery must still strike
//                            the ledger row
// The three one-time fulfillments can't collide: plates key off plate
// metadata the checkout-priced products never set, bids and slots each
// key off their own kind metadata / product id, and every handler
// no-ops on the others' orders. Everything else is recorded for audit
// and acked.

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

/** The recipient of a grant/revoke, resolved from an order or
 *  subscription payload. Checkout metadata `userId` wins: /api/checkout
 *  stamps it server-side from the authenticated session, so it is the
 *  buyer's identity. `customer.external_id` is only a fallback for
 *  dashboard-created objects — Polar reconciles same-email buyers (and
 *  live checkout sessions) onto an EXISTING customer record, so the
 *  order's customer can carry a different user's external id than the
 *  account that actually clicked buy. Granting by external id alone
 *  delivered a purchase to the wrong account (order 01b96e56: metadata
 *  userId 13, customer external_id 19). */
function resolveRecipientUserId(data: {
  metadata?: Record<string, string | number | boolean> | null
  customer?: { externalId?: string | null } | null
}): number | null {
  const raw = data.metadata?.['userId']
  const fromMetadata =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN
  const fromExternalId = resolveUserId(data.customer?.externalId)

  if (Number.isSafeInteger(fromMetadata) && fromMetadata > 0) {
    if (fromExternalId !== null && fromExternalId !== fromMetadata) {
      console.warn(
        `[PolarWebhook] Recipient mismatch: checkout metadata userId=${fromMetadata}, customer external_id=${fromExternalId} — trusting checkout metadata`
      )
    }
    return fromMetadata
  }
  return fromExternalId
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

/** subscription.active -> full fulfillment via the shared helpers. Team
 *  products (matched by configured Polar product id OR the product's
 *  `team_key` metadata — see isTeamSubscription) set tier 'TEAM' and
 *  open the manual review gate; every other subscription is a Pro
 *  product — that grant is identical for every Pro interval. */
async function activateSubscription(subscription: Subscription) {
  const userId = resolveRecipientUserId(subscription)
  if (!userId) {
    console.warn('[PolarWebhook] Subscription event without usable recipient — skipping')
    return
  }

  const grant = isTeamSubscription(subscription)
    ? grantTeamEntitlement
    : grantProEntitlement

  await grant(supabase, userId, {
    productId: subscription.productId,
    sourceId: subscription.id
  })
}

/** subscription.revoked -> tier back to FREE, guarded to the tier this
 *  integration granted for the product ('TEAM' for team products —
 *  classified exactly like the grant, id or team_key metadata — 'PRO'
 *  otherwise). A manually granted PREMIUM/PREMIUM+ survives a lapsed
 *  Polar sub (mirroring the upgrade-only sync); the admin panel's
 *  revoke_pro stays the explicit path for clearing manual tiers.
 *  team_review_status is deliberately left untouched: approval is a
 *  fact about identity, not payment — badges are gated on tier AND
 *  approval, so the lapse hides them and a renewal re-lights them
 *  without a second review. Owned plate rows are never touched
 *  (one-time purchases outlive the sub); pro-exclusive equips self-heal
 *  at read time via resolveEquippedPlate. */
async function revokeSubscription(subscription: Subscription) {
  const userId = resolveRecipientUserId(subscription)
  if (!userId) {
    console.warn('[PolarWebhook] Subscription event without usable recipient — skipping')
    return
  }

  const grantedTier = isTeamSubscription(subscription) ? 'TEAM' : 'PRO'

  const { error } = await supabase
    .from('users')
    .update({ subscription_tier: 'FREE' })
    .eq('id', userId)
    .eq('subscription_tier', grantedTier)

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

  const userId = resolveRecipientUserId(order)
  if (!userId) {
    console.warn('[PolarWebhook] order.paid without usable recipient — skipping')
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
// event type keeps its audit row and is acked with no DB effect. Both
// order handlers run every one-time fulfillment — each keys off markers
// the other products never set, so exactly one (or none) has any effect.
async function processEvent(event: PolarEvent) {
  if (event.type === 'subscription.active') {
    await activateSubscription(event.data)
  } else if (event.type === 'subscription.revoked') {
    await revokeSubscription(event.data)
  } else if (event.type === 'order.paid') {
    await grantPlateFromOrder(event.data)
    // Verification refusals resolve (logged inside) rather than throw:
    // a mismatched amount or missing ledger row is permanent, and a 500
    // here would make Polar redeliver an event no retry can fix.
    await activateSponsorBidFromOrder(supabase, event.data)
    await activateBillboardSlotFromOrder(supabase, event.data)
  } else if (event.type === 'order.refunded') {
    await revokePlateFromOrder(event.data)
    await revokeSponsorBidFromOrder(supabase, event.data)
    await revokeBillboardSlotFromOrder(supabase, event.data)
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
