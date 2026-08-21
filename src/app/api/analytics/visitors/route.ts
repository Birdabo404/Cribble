import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { fetchVisitorPulse, isDatafastConfigured } from '@/lib/datafast'

// Public visitor pulse for the leaderboard ticker. Same cache stance as
// /api/status: force-dynamic handler (never prerendered at build, where
// no vendor should be hit) with the assembled counts in the Data Cache
// for 30 seconds and an s-maxage CDN layer on top. The inner DataFast
// fetches opt out of caching themselves — this is the only cache layer.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 30

const loadVisitorPulse = unstable_cache(
  async () => {
    const pulse = await fetchVisitorPulse()
    if (!pulse) throw new Error('DataFast pulse unavailable')
    return pulse
  },
  ['datafast-visitor-pulse'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  if (!isDatafastConfigured()) {
    return NextResponse.json(
      { success: false, configured: false },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    const pulse = await loadVisitorPulse()
    return NextResponse.json(
      { success: true, ...pulse },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`
        }
      }
    )
  } catch (err) {
    console.error('[DataFast] Visitor pulse failed:', err)
    return NextResponse.json(
      { success: false, configured: true },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
