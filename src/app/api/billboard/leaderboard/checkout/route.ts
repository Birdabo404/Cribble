import { isIP } from 'node:net'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAppUrl } from '@/lib/appUrl'
import {
  leaderboardChargeCents,
  leaderboardMaxTargetCents,
  leaderboardMinTargetCents
} from '@/lib/leaderboardSponsor'
import {
  LEADERBOARD_BID_METADATA_KIND,
  loadSponsorBoard
} from '@/lib/leaderboardSponsorServer'
import { getPolarClient, isPolarConfigured, resolveLeaderboardBidProductId } from '@/lib/polar'
import {
  checkDistributedRateLimit,
  checkRateLimit,
  createRateLimitResponse,
  rateLimitConfigs
} from '@/lib/rateLimit'
import { getSponsorIdentity } from '@/lib/sponsorAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// POST /api/billboard/leaderboard/checkout — a leaderboard sponsor bid
// (migration 055). The owner of an APPROVED 'leaderboard' creative —
// the signed-in user or the claim-cookie guest (migration 063),
// whichever the ad row names — states the active total they want to
// reach; this route recomputes the board, prices the difference
// SERVER-SIDE (the browser can never choose the charged amount),
// records a PENDING ledger row keyed to the Polar checkout id, and
// answers with the hosted checkout URL. Checkout reserves nothing:
// rank is derived from completed payments, so a slower checkout still
// gets exactly the rank its paid amount earns when it lands.
//
// Body: { adId: number, targetTotalCents: number }
//   200 -> { success, url, checkoutId, chargeCents, targetTotalCents,
//           activeCents }
//   409 -> { error, minTargetCents, topTotalCents, activeCents } when
//          the stated target no longer takes #1 (the board moved under
//          the buyer) — the UI refreshes its OUTBID price from
//          minTargetCents and re-asks the buyer.
//
// The target must take #1 unless the buyer already holds it: the
// product sells the throne fight, and lower ranks are what decaying
// or outbid contributions become — never a purchase in themselves.
// The current #1 holder instead tops up to any target above their own
// active total (defending is charged the same $2.00 floor).

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

// The target ceiling is board-aware (leaderboardMaxTargetCents lifts
// the $10,000 fat-finger cap to the fresh minimum once the board grows
// past it), so it is enforced after the board read — the schema only
// guards types and integer sanity.
const bodySchema = z.object({
  adId: z.number().int().positive(),
  targetTotalCents: z.number().int().positive()
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

    const identityResult = await getSponsorIdentity(request)
    if (!identityResult.ok) {
      return NextResponse.json(
        { error: identityResult.error },
        { status: identityResult.status }
      )
    }
    const identity = identityResult.identity
    // Bidding requires a creative to bid on, which requires an
    // identity — user or guest. Bare visitors have nothing here.
    if (identity.kind === 'none') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // The real budget: cross-instance, per-buyer (the staffAuth
    // pattern). Every allowed request creates a Polar checkout and a
    // PENDING ledger row, so the in-memory IP prefilter alone — per
    // instance, first-XFF-hop keyed — is not enough to stop
    // checkout-creation spam.
    const distributedLimit = await checkDistributedRateLimit(
      request,
      rateLimitConfigs.checkoutCreation,
      identity.kind === 'user'
        ? `lb-bid-checkout:${identity.userId}`
        : `lb-bid-checkout:g${identity.guestId}`
    )
    if (!distributedLimit.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(distributedLimit) }
      )
    }

    const productId = resolveLeaderboardBidProductId()
    if (!isPolarConfigured() || !productId) {
      return NextResponse.json(
        { error: 'Sponsor bidding is not configured yet' },
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
        { error: 'adId and targetTotalCents (integer cents) are required' },
        { status: 400 }
      )
    }
    const { adId, targetTotalCents } = parsed.data

    // The creative must be the buyer's own — the session user against
    // owner_user_id, the cookie guest against guest_id — on this
    // product, and past review. Missing and not-owned collapse into
    // the same 404 (the buyer-route convention); unapproved is a 409
    // the tracker copy explains. billing_email rides along to prefill
    // a guest's hosted checkout.
    const { data: ad, error: adError } = await supabase
      .from('billboard_ads')
      .select('id, owner_user_id, guest_id, placement, status, billing_email')
      .eq('id', adId)
      .maybeSingle()

    if (adError) {
      console.error('[LeaderboardCheckout] Ad lookup failed:', adError)
      return NextResponse.json({ error: 'Failed to load ad' }, { status: 500 })
    }
    const ownsAd =
      ad !== null &&
      (identity.kind === 'user'
        ? ad.owner_user_id !== null && Number(ad.owner_user_id) === identity.userId
        : ad.guest_id !== null && Number(ad.guest_id) === identity.guestId)
    if (!ad || !ownsAd) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }
    if (ad.placement !== 'leaderboard') {
      return NextResponse.json(
        { error: 'This ad is not a leaderboard sponsor creative' },
        { status: 400 }
      )
    }
    if (ad.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'This creative has not been approved yet — bids open after review' },
        { status: 409 }
      )
    }

    // Recompute the board at this moment — the stale-bid gate. The
    // client's price preview may be up to a poll behind.
    const board = await loadSponsorBoard(supabase)
    const top = board[0] ?? null
    const activeCents = board.find((entry) => entry.adId === adId)?.activeCents ?? 0

    if (targetTotalCents <= activeCents) {
      return NextResponse.json(
        { error: 'Your active total already meets that target', activeCents },
        { status: 400 }
      )
    }

    // The challenge gate: unless the buyer already holds #1, the target
    // must take it — top total plus the max($1, 10% rounded up to whole
    // dollars) increment, or the $6.66 opening on an empty board. A
    // stale target gets the FRESH minimum back instead of a checkout.
    const holdsTop = top !== null && top.adId === adId
    const minTargetCents = leaderboardMinTargetCents(top?.activeCents ?? 0)
    if (!holdsTop && targetTotalCents < minTargetCents) {
      return NextResponse.json(
        {
          error: 'The board moved — beating #1 now takes a higher bid',
          minTargetCents,
          topTotalCents: top?.activeCents ?? 0,
          activeCents
        },
        { status: 409 }
      )
    }

    // The fat-finger ceiling, lifted to the fresh minimum whenever the
    // board has grown past $10,000 — maxTargetCents >= minTargetCents
    // always, so a buyer retrying at the 409's minimum can never land
    // here and the board can never lock. Deliberately NO minTargetCents
    // in this body: the buyer UI keys its board-moved retry on that
    // field, and an over-ceiling typo is not that case.
    const maxTargetCents = leaderboardMaxTargetCents(minTargetCents)
    if (targetTotalCents > maxTargetCents) {
      return NextResponse.json(
        {
          error: 'That target is above the sponsor ceiling',
          maxTargetCents,
          activeCents
        },
        { status: 400 }
      )
    }

    const chargeCents = leaderboardChargeCents(targetTotalCents, activeCents)

    // Ad-hoc fixed pricing: the product's catalog price is overridden
    // per checkout with the server-computed charge, so the amount is
    // decided here and verified again (against the ledger row) before
    // the paid order activates. Metadata carries the classification
    // key the webhook dispatches on plus audit copies of the pricing
    // decision — never the amounts activation trusts.
    const polar = getPolarClient()!
    const appUrl = resolveAppUrl(request)
    const customerIpAddress = customerIpAddressOf(request)
    // Guests have no Polar external-customer mapping — their orders
    // verify through metadata.guestId against the ledger row instead,
    // and the billing email from submission prefills the hosted
    // checkout form.
    const guestBillingEmail =
      identity.kind === 'guest' && typeof ad.billing_email === 'string' && ad.billing_email
        ? ad.billing_email
        : null
    const checkout = await polar.checkouts.create({
      products: [productId],
      prices: {
        [productId]: [
          { amountType: 'fixed', priceAmount: chargeCents, priceCurrency: 'usd' }
        ]
      },
      ...(identity.kind === 'user'
        ? { externalCustomerId: String(identity.userId) }
        : {}),
      ...(guestBillingEmail ? { customerEmail: guestBillingEmail } : {}),
      ...(customerIpAddress ? { customerIpAddress } : {}),
      // A bid is money committed to rank. Letting an organization-wide
      // coupon reduce the order (including to $0) makes Polar report a
      // successful checkout that the integrity gate must refuse because
      // netAmount no longer matches the server ledger. Pin coupons off for
      // this product; its ad-hoc amount is already the complete price.
      allowDiscountCodes: false,
      metadata: {
        ...(identity.kind === 'user'
          ? { userId: identity.userId }
          : { guestId: identity.guestId }),
        kind: LEADERBOARD_BID_METADATA_KIND,
        lbAdId: adId,
        lbTargetCents: targetTotalCents,
        lbChargeCents: chargeCents
      },
      // {CHECKOUT_ID} is Polar's template token, interpolated at
      // redirect time — built by string concat so the braces are never
      // URL-encoded. The buyer page passes it to the bid sync route.
      successUrl: `${appUrl}/sponsorship?lb_checkout=success&checkout_id={CHECKOUT_ID}`,
      // Polar shows a back button when this is present. The intent sends
      // an existing bidder to their bid console and a new sponsor to the
      // leaderboard creative form instead of dropping them on Flipper.
      returnUrl: `${appUrl}/sponsorship?intent=leaderboard-bid`
    })

    // The PENDING ledger row is what order.paid verification activates
    // against — without it a paid order is refused, so an insert
    // failure here must fail the request before the buyer can pay.
    const { error: insertError } = await supabase.from('leaderboard_sponsor_bids').insert({
      ad_id: adId,
      ...(identity.kind === 'user'
        ? { user_id: identity.userId }
        : { guest_id: identity.guestId }),
      status: 'PENDING',
      amount_cents: chargeCents,
      target_total_cents: targetTotalCents,
      polar_checkout_id: checkout.id
    })

    if (insertError) {
      console.error(
        `[LeaderboardCheckout] Ledger insert failed for checkout ${checkout.id} — the checkout is orphaned and will refuse activation:`,
        insertError
      )
      return NextResponse.json({ error: 'Failed to record the bid' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      url: checkout.url,
      checkoutId: checkout.id,
      chargeCents,
      targetTotalCents,
      activeCents
    })
  } catch (error) {
    console.error('[LeaderboardCheckout] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
