import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CheckoutSessionCreateParams } from 'dodopayments/resources/checkout-sessions'
import { resolveAppUrl } from '@/lib/appUrl'
import { getPlate } from '@/lib/cosmetics/plates'
import {
  getDodoClient,
  getProPlateDiscountCode,
  isDodoConfigured,
  resolvePlateProductId,
  resolveProProductId,
  resolveTeamProductId
} from '@/lib/dodo'
import { readDodoCustomerId } from '@/lib/dodoCustomer'
import { getOwnedPlateIds, isProTier } from '@/lib/entitlements'
import { houseGrantFor } from '@/lib/houseEntitlements'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// GET so the shop can link straight to /api/checkout?type=... — the route
// resolves the Dodo product id server-side (client-supplied product ids
// are never trusted), creates the checkout session, and redirects the
// browser to Dodo's hosted checkout page.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** Dodo discount CODE auto-attached to plate checkouts for Pro members —
 *  backs the shop's "-25% PRO" copy. Absent env or a failed tier read
 *  degrades to full price rather than blocking the checkout. */
async function resolveProPlateDiscountCode(userId: number): Promise<string | null> {
  const code = getProPlateDiscountCode()
  if (!code) return null

  const { data: buyer, error } = await supabase
    .from('users')
    .select('subscription_tier')
    .eq('id', userId)
    .single()

  if (error || !buyer) return null
  return isProTier(buyer.subscription_tier) ? code : null
}

const querySchema = z
  .object({
    type: z.enum(['pro_monthly', 'pro_yearly', 'team_monthly', 'team_yearly', 'plate']),
    plateId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]*$/i)
      .optional()
  })
  .refine((q) => q.type !== 'plate' || Boolean(q.plateId), {
    message: 'plateId is required when type=plate'
  })

export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request)

  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.redirect(new URL('/login', appUrl))
    }

    if (!isDodoConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Shop is not configured yet' },
        { status: 503 }
      )
    }

    const parsed = querySchema.safeParse({
      type: request.nextUrl.searchParams.get('type') ?? undefined,
      plateId: request.nextUrl.searchParams.get('plateId') ?? undefined
    })
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid checkout request' },
        { status: 400 }
      )
    }
    const { type, plateId } = parsed.data

    let productId: string | null
    if (type === 'plate') {
      // Catalog is the authority on what's sellable: unpriced plates
      // (champion trophy, pro exclusives, the beta gift) are refused here
      // even if someone maps them in DODO_PLATE_PRODUCT_MAP by mistake.
      const plate = getPlate(plateId!)
      if (!plate || plate.priceUsd === null) {
        return NextResponse.json(
          { success: false, error: 'Plate is not for sale' },
          { status: 404 }
        )
      }
      // Ownership gate: the shop hides the buy button on owned plates, but
      // a stale tab, double-click race or hand-typed URL would still charge
      // for a plate the buyer already has (the grant would just no-op).
      // Browser-navigation route, so bounce back to the shop with a notice
      // instead of raw JSON. getOwnedPlateIds degrades to [] on a failed
      // read — a flaky lookup lets the checkout proceed rather than
      // blocking a legitimate purchase.
      const ownedPlateIds = await getOwnedPlateIds(supabase, session.userId)
      if (ownedPlateIds.includes(plateId!)) {
        return NextResponse.redirect(new URL('/shop?checkout=owned', appUrl))
      }
      productId = resolvePlateProductId(plateId!)
      if (!productId) {
        return NextResponse.json(
          { success: false, error: 'Unknown plate' },
          { status: 404 }
        )
      }
    } else {
      // House complimentary accounts already have Pro / Team. Sending
      // them to Dodo would put a card on file.
      if (houseGrantFor({ id: session.userId })) {
        return NextResponse.redirect(new URL('/shop?checkout=complimentary', appUrl))
      }

      productId =
        type === 'team_monthly' || type === 'team_yearly'
          ? resolveTeamProductId(type)
          : resolveProProductId(type)
      if (!productId) {
        return NextResponse.json(
          { success: false, error: 'Shop is not configured yet' },
          { status: 503 }
        )
      }
    }

    const dodo = getDodoClient()!

    // metadata.userId is the buyer's identity for fulfillment: it flows
    // onto the payment and subscription objects, and the webhook trusts
    // it over the customer record (Dodo attaches same-email checkouts to
    // an EXISTING customer, which may be another Cribble account).
    const metadata: Record<string, string | number | boolean> = {
      userId: session.userId
    }
    if (type === 'plate') metadata.plateId = plateId!

    // A returning buyer checks out as the customer already linked to this
    // account, so their saved details and portal history line up. First
    // purchase: Dodo collects the email on the hosted page and the webhook
    // / return-bounce link the resulting customer id.
    const customerId = await readDodoCustomerId(supabase, session.userId)

    const discountCode =
      type === 'plate' ? await resolveProPlateDiscountCode(session.userId) : null

    // Team buyers land on the /team console (which runs the same sync ack
    // and then shows the under-review roster); everything else returns to
    // the shop. Dodo appends payment_id / subscription_id and status to the
    // return URL; the pages pass those to the sync route for the
    // purchase-ack notification.
    const successPath =
      type === 'team_monthly' || type === 'team_yearly' ? '/team' : '/shop'

    const params: CheckoutSessionCreateParams = {
      product_cart: [{ product_id: productId, quantity: 1 }],
      metadata,
      return_url: `${appUrl}${successPath}?checkout=success`,
      ...(customerId ? { customer: { customer_id: customerId } } : {}),
      ...(discountCode ? { discount_codes: [discountCode] } : {})
    }
    if (type === 'plate') {
      // The Pro perk is a plain discount code on Dodo's side. Hiding the
      // code field on plate checkouts is what keeps it a Pro perk — a
      // non-Pro buyer who learned the code could otherwise type it in.
      params.feature_flags = { allow_discount_code: false }
    }

    const checkout = await dodo.checkoutSessions.create(params)
    if (!checkout.checkout_url) {
      throw new Error(`Checkout session ${checkout.session_id} returned no checkout_url`)
    }

    return NextResponse.redirect(checkout.checkout_url)
  } catch (error) {
    console.error('[Checkout] Failed to create Dodo checkout session:', error)
    // Browser navigation route — land back on the shop instead of raw JSON.
    return NextResponse.redirect(new URL('/shop?checkout=error', appUrl))
  }
}
