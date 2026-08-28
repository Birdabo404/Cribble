import { isIP } from 'node:net'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAppUrl } from '@/lib/appUrl'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_SLOT_PENDING_TTL_MS,
  billboardSlotGrossCents,
  isLiveAd,
  RAIL_SLOT_PRICE_CENTS,
  RAIL_SLOTS,
  type RailSlot
} from '@/lib/billboard'
import {
  BILLBOARD_SLOT_METADATA_KIND,
  slotWindowStartAt,
  type BillboardSlotPlacement
} from '@/lib/billboardSlotServer'
import { getPolarClient, isPolarConfigured, resolveBillboardSlotProductId } from '@/lib/polar'
import {
  checkDistributedRateLimit,
  checkRateLimit,
  createRateLimitResponse,
  rateLimitConfigs
} from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// POST /api/billboard/checkout — self-serve payment for a flipper or
// rail slot (migration 061). The signed-in owner of an APPROVED
// creative pays for its 7-day window through Polar; this route prices
// the checkout SERVER-SIDE (the advertised sticker grossed up for
// Polar's fee — the browser can never choose the charged amount),
// records a PENDING ledger row keyed to the Polar checkout id, and
// answers with the hosted checkout URL plus the estimated window so
// the UI can disclose a queued go-live date before the buyer pays.
// Checkout reserves nothing: the window is stamped only when the
// verified paid order lands, at whatever start occupancy then allows.
//
// Body: { adId: number, slot?: RailSlot }
//   slot is REQUIRED for rail ads (defaulting server-side to the ad's
//   requested_rail_slot when omitted) and becomes binding — the price
//   is per slot. Flipper ads must not send one.
//   200 -> { success, url, checkoutId, placement, slot, listCents,
//           grossCents, estimatedStartsAt, estimatedEndsAt, queued }
//   400 -> wrong placement / already live / slot-placement mismatch
//   404 -> missing or not the caller's ad (collapsed, the buyer-route
//          convention)
//   409 -> not APPROVED yet / a future window is already scheduled /
//          a fresh PENDING checkout for this ad is still in flight
//
// Leaderboard creatives settle through the bid checkout instead, and
// ownerless (admin-created external-sponsor) ads keep the manual
// admin-activate flow — no session can own them, so the 404 covers it.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const bodySchema = z.object({
  adId: z.number().int().positive(),
  slot: z.enum(RAIL_SLOTS).optional()
})

/** Polar creates the hosted checkout from this server-side request, so
 *  without the visitor IP it geolocates the server instead of the buyer.
 *  Only forward a syntactically valid address; malformed/spoofed header
 *  values are safer omitted than handed to the payments API. */
function customerIpAddressOf(request: NextRequest): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const candidate = forwarded || request.headers.get('x-real-ip')?.trim()
  return candidate && isIP(candidate) !== 0 ? candidate : undefined
}

export async function POST(request: NextRequest) {
  try {
    // Process-local prefilter on the general allowance — cheap first
    // line against anonymous floods before the session read.
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

    // The real budget: cross-instance, per-buyer. Every allowed request
    // creates a Polar checkout and a PENDING ledger row, so the
    // in-memory IP prefilter alone is not enough to stop
    // checkout-creation spam.
    const distributedLimit = await checkDistributedRateLimit(
      request,
      rateLimitConfigs.checkoutCreation,
      `bb-slot-checkout:${session.userId}`
    )
    if (!distributedLimit.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(distributedLimit) }
      )
    }

    const productId = resolveBillboardSlotProductId()
    if (!isPolarConfigured() || !productId) {
      return NextResponse.json(
        { error: 'Slot checkout is not configured yet' },
        { status: 503 }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'adId (and for rails an optional slot) is required' },
        { status: 400 }
      )
    }
    const { adId, slot: requestedSlot } = parsed.data

    // The ad must be the buyer's own, on a purchasable placement, and
    // past review. Missing and not-owned collapse into the same 404
    // (the buyer-route convention); unapproved is a 409 the tracker
    // copy explains.
    const { data: ad, error: adError } = await supabase
      .from('billboard_ads')
      .select(
        'id, owner_user_id, placement, status, requested_rail_slot, paid_at, starts_at, ends_at'
      )
      .eq('id', adId)
      .maybeSingle()

    if (adError) {
      console.error('[BillboardSlotCheckout] Ad lookup failed:', adError)
      return NextResponse.json({ error: 'Failed to load ad' }, { status: 500 })
    }
    if (!ad || Number(ad.owner_user_id) !== session.userId) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }
    if (ad.placement !== 'flipper' && ad.placement !== 'rail') {
      return NextResponse.json(
        { error: 'This ad is not a flipper or rail creative' },
        { status: 400 }
      )
    }
    const placement: BillboardSlotPlacement = ad.placement
    if (ad.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'This ad has not been approved yet — payment opens after review' },
        { status: 409 }
      )
    }

    const now = new Date()
    if (isLiveAd(ad, now)) {
      return NextResponse.json(
        { error: 'Ad is already live — its current window has to end first' },
        { status: 400 }
      )
    }
    // A queued future window (paid, waiting for its start) is just as
    // sold: the ad row holds ONE window, so selling again here would
    // overwrite the schedule the last payment bought.
    if (
      ad.paid_at &&
      ad.starts_at &&
      new Date(ad.starts_at as string).getTime() > now.getTime()
    ) {
      return NextResponse.json(
        { error: 'This ad already has a scheduled window waiting to go live' },
        { status: 409 }
      )
    }

    // The rail slot choice is binding at checkout — the ladder prices
    // per slot, so it can't wait for activation like the admin flow.
    // The body wins, the submission-time wish is the default, and a
    // rail ad with neither has nothing to price.
    let railSlot: RailSlot | null = null
    switch (placement) {
      case 'flipper': {
        if (requestedSlot) {
          return NextResponse.json(
            { error: 'Flipper ads have no slot to pick' },
            { status: 400 }
          )
        }
        break
      }
      case 'rail': {
        railSlot = requestedSlot ?? (ad.requested_rail_slot as RailSlot | null)
        if (!railSlot) {
          return NextResponse.json(
            { error: `Rail checkout needs a slot — one of ${RAIL_SLOTS.join(', ')}` },
            { status: 400 }
          )
        }
        break
      }
      default: {
        const exhaustive: never = placement
        return exhaustive
      }
    }

    // One in-flight checkout per ad: a fresh PENDING row means the
    // buyer (or a double-click) already holds a live Polar checkout —
    // rows older than the TTL belong to expired checkouts and don't
    // block a retry.
    const pendingCutoffIso = new Date(now.getTime() - BILLBOARD_SLOT_PENDING_TTL_MS).toISOString()
    const { count: pendingCount, error: pendingError } = await supabase
      .from('billboard_slot_orders')
      .select('id', { count: 'exact', head: true })
      .eq('ad_id', adId)
      .eq('status', 'PENDING')
      .gt('created_at', pendingCutoffIso)

    if (pendingError || pendingCount === null) {
      console.error('[BillboardSlotCheckout] Pending-order check failed:', pendingError)
      return NextResponse.json(
        { error: 'Failed to check for in-flight checkouts' },
        { status: 500 }
      )
    }
    if (pendingCount > 0) {
      return NextResponse.json(
        { error: 'A checkout for this ad is already in flight — finish it or retry shortly' },
        { status: 409 }
      )
    }

    // Server-side pricing: the advertised sticker (never charged) and
    // the fee-grossed total Polar will charge so Cribble nets the
    // sticker. Activation verifies the paid order against the GROSS.
    const listCents =
      placement === 'rail' ? RAIL_SLOT_PRICE_CENTS[railSlot!] : BILLBOARD_PRICE_CENTS
    const grossCents = billboardSlotGrossCents(listCents)

    // The same queue-behind derivation activation will run — disclosed
    // here so a buyer paying into a full board knows the go-live date
    // BEFORE Polar charges them. An estimate, not a hold: payment
    // completion re-derives it against then-current occupancy.
    const estimatedStartsAt = await slotWindowStartAt(supabase, placement, railSlot, now, adId)
    const estimatedStartsAtIso = estimatedStartsAt.toISOString()
    const estimatedEndsAtIso = new Date(
      estimatedStartsAt.getTime() + BILLBOARD_DURATION_DAYS * 86_400_000
    ).toISOString()

    // Ad-hoc fixed pricing: the product's catalog price is overridden
    // per checkout with the server-computed gross, so the amount is
    // decided here and verified again (against the ledger row) before
    // the paid order stamps a window. Metadata carries the
    // classification key the webhook dispatches on plus audit copies
    // of the pricing decision — never the amounts activation trusts.
    const polar = getPolarClient()!
    const appUrl = resolveAppUrl(request)
    const customerIpAddress = customerIpAddressOf(request)
    const checkout = await polar.checkouts.create({
      products: [productId],
      prices: {
        [productId]: [
          { amountType: 'fixed', priceAmount: grossCents, priceCurrency: 'usd' }
        ]
      },
      externalCustomerId: String(session.userId),
      ...(customerIpAddress ? { customerIpAddress } : {}),
      // The gross-up is calibrated so the sticker is what Cribble nets;
      // an org-wide coupon reducing the order would make Polar report a
      // paid checkout the integrity gate must refuse (netAmount no
      // longer matches the ledger). Pin coupons off, like bids.
      allowDiscountCodes: false,
      metadata: {
        userId: session.userId,
        kind: BILLBOARD_SLOT_METADATA_KIND,
        bbAdId: adId,
        bbPlacement: placement,
        ...(railSlot ? { bbSlot: railSlot } : {}),
        bbListCents: listCents
      },
      // {CHECKOUT_ID} is Polar's template token, interpolated at
      // redirect time — built by string concat so the braces are never
      // URL-encoded. The buyer page passes it to the slot sync route.
      successUrl: `${appUrl}/sponsorship?bb_checkout=success&checkout_id={CHECKOUT_ID}`,
      // Polar shows a back button when this is present — straight back
      // to the buyer's sponsorship tracker.
      returnUrl: `${appUrl}/sponsorship`
    })

    // The PENDING ledger row is what order.paid verification activates
    // against — without it a paid order is refused, so an insert
    // failure here must fail the request before the buyer can pay.
    const { error: insertError } = await supabase.from('billboard_slot_orders').insert({
      ad_id: adId,
      user_id: session.userId,
      placement,
      rail_slot: railSlot,
      status: 'PENDING',
      amount_cents: grossCents,
      list_price_cents: listCents,
      polar_checkout_id: checkout.id
    })

    if (insertError) {
      console.error(
        `[BillboardSlotCheckout] Ledger insert failed for checkout ${checkout.id} — the checkout is orphaned and will refuse activation:`,
        insertError
      )
      return NextResponse.json({ error: 'Failed to record the order' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      url: checkout.url,
      checkoutId: checkout.id,
      placement,
      slot: railSlot,
      listCents,
      grossCents,
      estimatedStartsAt: estimatedStartsAtIso,
      estimatedEndsAt: estimatedEndsAtIso,
      queued: estimatedStartsAt.getTime() > now.getTime()
    })
  } catch (error) {
    console.error('[BillboardSlotCheckout] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
