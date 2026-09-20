import { NextRequest, NextResponse } from 'next/server'
import { resolveAppUrl } from '@/lib/appUrl'
import { getDodoClient, isDodoConfigured, isDodoMissing } from '@/lib/dodo'
import { readDodoCustomerId } from '@/lib/dodoCustomer'
import { houseGrantFor } from '@/lib/houseEntitlements'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// GET route that opens Dodo's hosted customer portal (manage/cancel
// subscription, view payments and invoices) for the signed-in user. The
// customer is the one linked on users.dodo_customer_id — learned from the
// first fulfilled payment/subscription (webhook or checkout bounce).

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

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

    if (!isDodoConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Shop is not configured yet' },
        { status: 503 }
      )
    }

    // A user who never checked out has no Dodo customer to open a portal
    // for. Send them back to the shop.
    const customerId = await readDodoCustomerId(supabase, session.userId)
    if (!customerId) {
      return NextResponse.redirect(new URL('/shop?portal=none', appUrl))
    }

    const dodo = getDodoClient()!

    try {
      const portalSession = await dodo.customers.customerPortal.create(customerId, {
        return_url: `${appUrl}/shop`
      })
      return NextResponse.redirect(portalSession.link)
    } catch (error) {
      // A stale link (customer deleted on Dodo's side) reads the same as
      // never having checked out.
      if (isDodoMissing(error)) {
        return NextResponse.redirect(new URL('/shop?portal=none', appUrl))
      }
      throw error
    }
  } catch (error) {
    console.error('[Portal] Failed to create Dodo customer portal session:', error)
    return NextResponse.redirect(new URL('/shop?portal=error', appUrl))
  }
}
