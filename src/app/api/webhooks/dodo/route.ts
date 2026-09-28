import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { applyDodoEvent } from '@/lib/dodoSync'
import { getDodoClient, getDodoWebhookKey, isDodoActive } from '@/lib/dodo'
import { createServiceClient } from '@/lib/supabaseServer'

// Dodo webhook receiver. Signature-verified (Standard Webhooks via the
// SDK), idempotent via payment_events.event_id. Effects mirror Polar:
//   subscription.active / plan_changed -> Pro or Team grant
//   subscription.expired / failed      -> tier back to FREE, guarded
//   subscription.cancelled             -> revoke only on immediate cancel
//   payment.succeeded                  -> grant a plate when the payment
//                                         carries a catalog plate id
//   refund.succeeded                   -> delete user_cosmetics by payment id
// Anything else is recorded and acked.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const HANDLED = new Set([
  'subscription.active',
  'subscription.plan_changed',
  'subscription.cancelled',
  'subscription.expired',
  'subscription.failed',
  'payment.succeeded',
  'refund.succeeded'
])

export async function POST(request: NextRequest) {
  if (!isDodoActive()) {
    return NextResponse.json({ success: false, error: 'Webhook not configured' }, { status: 503 })
  }
  const secret = getDodoWebhookKey()
  if (!secret) {
    return NextResponse.json({ success: false, error: 'Webhook not configured' }, { status: 503 })
  }
  const client = getDodoClient()
  if (!client) {
    return NextResponse.json({ success: false, error: 'Webhook not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  const headers = {
    'webhook-id': request.headers.get('webhook-id') ?? '',
    'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
    'webhook-signature': request.headers.get('webhook-signature') ?? ''
  }

  let event: { type: string; data: unknown } | null = null
  try {
    const unwrapped = client.webhooks.unwrap(rawBody, { headers, key: secret })
    if (unwrapped && typeof unwrapped === 'object' && 'type' in unwrapped && typeof unwrapped.type === 'string') {
      event = { type: unwrapped.type, data: 'data' in unwrapped ? unwrapped.data : null }
    }
  } catch (error) {
    console.warn('[DodoWebhook] Signature verification failed:', error)
    return NextResponse.json({ received: false }, { status: 403 })
  }

  if (!event) {
    return NextResponse.json({ success: false, error: 'Failed to parse event' }, { status: 400 })
  }

  const eventId = headers['webhook-id'] || createHash('sha256').update(rawBody).digest('hex')
  let rawPayload: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rawPayload = parsed as Record<string, unknown>
    }
  } catch {
    rawPayload = null
  }

  const { error: insertError } = await supabase.from('payment_events').insert({
    event_id: eventId,
    event_type: event.type,
    payload: rawPayload
  })

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, skipped: true })
    }
    console.error('[DodoWebhook] Failed to record event:', insertError)
    return NextResponse.json({ success: false, error: 'Failed to record event' }, { status: 500 })
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true })
  }

  try {
    await applyDodoEvent(supabase, event)
  } catch (error) {
    console.error(`[DodoWebhook] Failed to process ${event.type} (${eventId}):`, error)
    await supabase.from('payment_events').delete().eq('event_id', eventId)
    return NextResponse.json({ success: false, error: 'Failed to process event' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
