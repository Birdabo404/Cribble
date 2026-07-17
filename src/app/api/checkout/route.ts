import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAppUrl } from '@/lib/appUrl'
import { getPlate } from '@/lib/cosmetics/plates'
import { isProTier } from '@/lib/entitlements'
import {
  getPolarClient,
  isPolarConfigured,
  resolvePlateProductId,
  resolveProProductId
} from '@/lib/polar'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// GET so the shop can link straight to /api/checkout?type=... — the route
// resolves the Polar product id server-side (client-supplied product ids
// are never trusted), creates the checkout, and redirects the browser to
// Polar's hosted checkout page.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** Polar discount id auto-attached to plate checkouts for Pro members —
 *  backs the shop's "-25% PRO" copy. Absent env or a failed tier read
 *  degrades to full price rather than blocking the checkout. */
async function resolveProPlateDiscountId(userId: number): Promise<string | null> {
  const discountId = process.env.POLAR_DISCOUNT_PRO_PLATES
  if (!discountId) return null

  const { data: buyer, error } = await supabase
    .from('users')
    .select('subscription_tier')
    .eq('id', userId)
    .single()

  if (error || !buyer) return null
  return isProTier(buyer.subscription_tier) ? discountId : null
}

const querySchema = z
  .object({
    type: z.enum(['pro_monthly', 'pro_yearly', 'plate']),
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

    if (!isPolarConfigured()) {
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
      productId = resolvePlateProductId(plateId!)
      if (!productId) {
        return NextResponse.json(
          { success: false, error: 'Unknown plate' },
          { status: 404 }
        )
      }
    } else {
      productId = resolveProProductId(type)
      if (!productId) {
        return NextResponse.json(
          { success: false, error: 'Shop is not configured yet' },
          { status: 503 }
        )
      }
    }

    const polar = getPolarClient()!
    const metadata: Record<string, string | number | boolean> = {
      userId: session.userId
    }
    if (type === 'plate') metadata.plateId = plateId!

    const discountId =
      type === 'plate' ? await resolveProPlateDiscountId(session.userId) : null

    const checkout = await polar.checkouts.create({
      products: [productId],
      externalCustomerId: String(session.userId),
      metadata,
      successUrl: `${appUrl}/shop?checkout=success`,
      ...(discountId ? { discountId } : {})
    })

    return NextResponse.redirect(checkout.url)
  } catch (error) {
    console.error('[Checkout] Failed to create Polar checkout:', error)
    // Browser navigation route — land back on the shop instead of raw JSON.
    return NextResponse.redirect(new URL('/shop?checkout=error', appUrl))
  }
}
