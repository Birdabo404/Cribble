import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  isAnalyticsDbConfigured,
  readVisitorPulse
} from '@/lib/siteVisits'

// Public visitor pulse for the leaderboard ticker. Same cache stance as
// /api/status: force-dynamic handler (never prerendered at build) with
// the assembled counts in the Data Cache for 30 seconds and an s-maxage
// CDN layer on top. The inner Supabase read opts out of caching itself
// — this is the only cache layer.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 30

const loadVisitorPulse = unstable_cache(
  async () => {
    const supabase = createServiceClient()
    const { data, error } = await supabase.rpc('site_visitor_pulse')
    if (error) throw new Error(error.message)
    const pulse = readVisitorPulse(data)
    if (!pulse) throw new Error('Visitor pulse unavailable')
    return pulse
  },
  ['site-visitor-pulse'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  if (!isAnalyticsDbConfigured()) {
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
    console.error('[SiteVisits] Visitor pulse failed:', err)
    return NextResponse.json(
      { success: false, configured: true },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
