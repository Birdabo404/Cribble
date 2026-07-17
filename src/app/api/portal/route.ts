import { NextRequest, NextResponse } from 'next/server'
import { PolarError } from '@polar-sh/sdk/models/errors/polarerror'
import { resolveAppUrl } from '@/lib/appUrl'
import { getPolarClient, isPolarConfigured } from '@/lib/polar'
import { getSessionUserId } from '@/lib/sessionAuth'

// GET route that opens Polar's hosted customer portal (manage/cancel
// subscription, view orders) for the signed-in user. Customers are keyed
// by external id = String(users.id), set at checkout time.

export const dynamic = 'force-dynamic'

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
