import { NextRequest, NextResponse } from 'next/server'
import { fetchKlipyGifs, isKlipyConfigured } from '@/lib/klipy'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'

// GIF search proxy for the Banner Studio picker. Klipy's API key lives
// in the request path on their side, so the browser can never talk to
// them directly — this route holds the key and forwards search/trending
// queries. Sign-in is required (only the banner editor calls this) and
// the shared per-IP limiter keeps one client from burning the Klipy
// quota (test keys: 100 calls/min).
//
//   GET /api/gifs?q=<term>&page=<n>
//     q empty/absent → trending feed
//     → { success: true, gifs: KlipyGif[], page, hasNext }

export const dynamic = 'force-dynamic'

const QUERY_MAX = 80

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const session = await getSessionUserId(request)
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  if (!isKlipyConfigured()) {
    return NextResponse.json(
      { success: false, error: 'GIF search is not configured' },
      { status: 503 }
    )
  }

  const query = String(request.nextUrl.searchParams.get('q') || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, QUERY_MAX)
  const page = Math.max(1, Math.trunc(Number(request.nextUrl.searchParams.get('page')) || 1))

  const result = await fetchKlipyGifs({ query, page })
  if (!result) {
    return NextResponse.json(
      { success: false, error: 'GIF search is unavailable right now' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    success: true,
    gifs: result.items,
    page: result.page,
    hasNext: result.hasNext
  })
}
