import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAppUrl } from '@/lib/appUrl'
import { getPlate } from '@/lib/cosmetics/plates'
import { getOwnedPlateIds, isProTier } from '@/lib/entitlements'
import {
  getDodoClient,
  getProPlateDiscountCode,
  isDodoActive,
  resolvePlateProductId as resolveDodoPlateProductId,
  resolveProProductId as resolveDodoProProductId,
  resolveTeamProductId as resolveDodoTeamProductId
} from '@/lib/dodo'
import { houseGrantFor } from '@/lib/houseEntitlements'
import {
  getPolarClient,
  isPolarConfigured,
  resolvePlateProductId,
  resolveProProductId,
  resolveTeamProductId
} from '@/lib/polar'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// GET so the shop can link straight to /api/checkout?type=... — the route
// resolves the product id server-side (client-supplied product ids are
// never trusted) and redirects to hosted checkout. Dodo when configured,
// otherwise Polar.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** True when the buyer is on a Pro tier and a plate discount is configured.
 *  No discount env, or a failed read, degrades to full price. */
async function buyerIsPro(userId: number): Promise<boolean> {
  if (!process.env.POLAR_DISCOUNT_PRO_PLATES && !process.env.DODO_DISCOUNT_PRO_PLATES) {
    return false
  }
  const { data: buyer, error } = await supabase
    .from('users')
    .select('subscription_tier')
    .eq('id', userId)
    .single()
  if (error || !buyer) return false
  return isProTier(buyer.subscription_tier)
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

    const useDodo = isDodoActive()
    if (!useDodo && !isPolarConfigured()) {
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
      // even if someone maps them in POLAR_PLATE_PRODUCT_MAP by mistake.
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
      productId = useDodo ? resolveDodoPlateProductId(plateId!) : resolvePlateProductId(plateId!)
      if (!productId) {
        return NextResponse.json(
          { success: false, error: 'Unknown plate' },
          { status: 404 }
        )
      }
    } else {
      // House complimentary accounts already have Pro / Team. Sending
      // them to Polar would put a card on file.
      if (houseGrantFor({ id: session.userId })) {
        return NextResponse.redirect(new URL('/shop?checkout=complimentary', appUrl))
      }

      productId =
        type === 'team_monthly' || type === 'team_yearly'
          ? useDodo
            ? resolveDodoTeamProductId(type)
            : resolveTeamProductId(type)
          : useDodo
            ? resolveDodoProProductId(type)
            : resolveProProductId(type)
      if (!productId) {
        return NextResponse.json(
          { success: false, error: 'Shop is not configured yet' },
          { status: 503 }
        )
      }
    }

    const metadata: Record<string, string | number | boolean> = {
      userId: session.userId
    }
    if (type === 'plate') metadata.plateId = plateId!

    const proBuyer = type === 'plate' ? await buyerIsPro(session.userId) : false
    const discountId = proBuyer ? process.env.POLAR_DISCOUNT_PRO_PLATES || null : null
    const dodoDiscount = proBuyer && useDodo ? getProPlateDiscountCode() : null

    // Team buyers land on the /team console (which runs the same sync ack
    // and then shows the under-review roster); everything else returns to
    // the shop.
    const successPath =
      type === 'team_monthly' || type === 'team_yearly' ? '/team' : '/shop'

    if (useDodo) {
      try {
        const dodo = getDodoClient()!
        const checkout = await dodo.checkoutSessions.create({
          product_cart: [{ product_id: productId, quantity: 1 }],
          metadata,
          return_url: `${appUrl}${successPath}?checkout=success`,
          cancel_url: `${appUrl}/shop`,
          feature_flags: { redirect_immediately: true },
          ...(dodoDiscount ? { discount_codes: [dodoDiscount] } : {})
        })
        if (checkout.checkout_url) return NextResponse.redirect(checkout.checkout_url)
      } catch (error) {
        console.error('[Checkout] Dodo checkout failed:', error)
      }
      if (!isPolarConfigured()) {
        return NextResponse.redirect(new URL('/shop?checkout=error', appUrl))
      }
      const polarProductId =
        type === 'plate'
          ? resolvePlateProductId(plateId!)
          : type === 'team_monthly' || type === 'team_yearly'
            ? resolveTeamProductId(type)
            : resolveProProductId(type)
      if (!polarProductId) {
        return NextResponse.redirect(new URL('/shop?checkout=error', appUrl))
      }
      productId = polarProductId
    }

    const polar = getPolarClient()!
    const checkout = await polar.checkouts.create({
      products: [productId],
      externalCustomerId: String(session.userId),
      metadata,
      // {CHECKOUT_ID} is Polar's template token, interpolated at redirect
      // time — built by string concat so the braces are never URL-encoded.
      // The success page passes it back to the sync route for the
      // purchase-ack notification.
      successUrl: `${appUrl}${successPath}?checkout=success&checkout_id={CHECKOUT_ID}`,
      ...(discountId ? { discountId } : {})
    })

    return NextResponse.redirect(checkout.url)
  } catch (error) {
    console.error('[Checkout] Failed to create Polar checkout:', error)
    // Browser navigation route — land back on the shop instead of raw JSON.
    return NextResponse.redirect(new URL('/shop?checkout=error', appUrl))
  }
}
