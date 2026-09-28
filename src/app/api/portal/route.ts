import { NextRequest, NextResponse } from 'next/server'
import { APIError } from 'dodopayments'
import { PolarError } from '@polar-sh/sdk/models/errors/polarerror'
import { resolveAppUrl } from '@/lib/appUrl'
import { getDodoClient, isDodoActive } from '@/lib/dodo'
import { houseGrantFor } from '@/lib/houseEntitlements'
import { getPolarClient, isPolarConfigured } from '@/lib/polar'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// GET route that opens the hosted customer portal (manage/cancel
// subscription, view orders) for the signed-in user. New checkouts are
// Dodo customers, stored on users.metadata.dodo_customer_id. Accounts
// that only exist in Polar still fall through to Polar's portal.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request)

  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.redirect(new URL('/login', appUrl))
    }

    if (houseGrantFor({ id: session.userId })) {
      return NextResponse.redirect(new URL('/shop?portal=complimentary', appUrl))
    }

    if (!isDodoActive() && !isPolarConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Shop is not configured yet' },
        { status: 503 }
      )
    }

    if (isDodoActive()) {
      const supabase = createServiceClient()
      const { data: user } = await supabase
        .from('users')
        .select('metadata')
        .eq('id', session.userId)
        .single()
      const metadata = (user?.metadata ?? {}) as Record<string, unknown>
      const customerId =
        typeof metadata.dodo_customer_id === 'string' ? metadata.dodo_customer_id : null
      if (customerId) {
        try {
          const portal = await getDodoClient()!.customers.customerPortal.create(customerId, {
            return_url: `${appUrl}/shop`
          })
          return NextResponse.redirect(portal.link)
        } catch (error) {
          if (!(error instanceof APIError && (error.status === 404 || error.status === 422))) {
            throw error
          }
        }
      }
      if (!isPolarConfigured()) {
        return NextResponse.redirect(new URL('/shop?portal=none', appUrl))
      }
    }

    const polar = getPolarClient()!

    try {
      const portalSession = await polar.customerSessions.create({
        externalCustomerId: String(session.userId),
        returnUrl: `${appUrl}/shop`
      })
      return NextResponse.redirect(portalSession.customerPortalUrl)
    } catch (error) {
      // A user who never checked out has no Polar customer — Polar answers
      // 404/422 for the unknown external id. Send them back to the shop.
      if (
        error instanceof PolarError &&
        (error.statusCode === 404 || error.statusCode === 422)
      ) {
        return NextResponse.redirect(new URL('/shop?portal=none', appUrl))
      }
      throw error
    }
  } catch (error) {
    console.error('[Portal] Failed to create Polar customer session:', error)
    return NextResponse.redirect(new URL('/shop?portal=error', appUrl))
  }
}
