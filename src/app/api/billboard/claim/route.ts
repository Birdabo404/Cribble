import { NextRequest, NextResponse } from 'next/server'
import { resolveAppUrl } from '@/lib/appUrl'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { setSponsorClaimCookie } from '@/lib/sponsorAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// GET /api/billboard/claim?token=... — the guest sponsor magic link.
// The tracking email points here: a valid token (a billboard_guests
// bearer secret, migration 063) sets the httpOnly claim cookie so this
// browser owns the guest's ads, then lands on the sponsorship tracker.
// An invalid or missing token lands on the same page without a cookie —
// the link never confirms to a prober whether a token exists.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

// Minted tokens are exactly 32 random bytes as hex; anything else can
// skip the database roundtrip.
const TOKEN_SHAPE = /^[0-9a-f]{64}$/

export async function GET(request: NextRequest) {
  try {
    // Same budget as the other buyer-facing billboard routes — one email
    // click on the general API allowance.
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const trackerUrl = `${resolveAppUrl(request)}/sponsorship`
    const token = request.nextUrl.searchParams.get('token')

    if (!token || !TOKEN_SHAPE.test(token)) {
      return NextResponse.redirect(trackerUrl)
    }

    const { data, error } = await supabase
      .from('billboard_guests')
      .select('id')
      .eq('token', token)
      .maybeSingle()

    // A failed lookup is not proof the link is bad (sessionAuth's
    // 401-vs-503 rule): 503 keeps the emailed link retryable instead of
    // silently landing the guest on the tracker unclaimed.
    if (error) {
      console.error('[BillboardClaim] Guest lookup failed:', error.message)
      return NextResponse.json({ error: 'Claim lookup failed' }, { status: 503 })
    }

    if (!data) {
      return NextResponse.redirect(trackerUrl)
    }

    const response = NextResponse.redirect(trackerUrl)
    setSponsorClaimCookie(response, token)
    return response
  } catch (error) {
    console.error('[BillboardClaim] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
