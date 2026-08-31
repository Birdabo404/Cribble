import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { goatcounterStatsUrl } from '@/lib/goatcounterPublic'
import {
  TRACKER_FETCH_MS,
  TRACKER_STATS_SCHEMA_VERSION,
  parseGoatcounterDashboard,
  readResponseTextBounded
} from '@/lib/goatcounterStats'

// Public tracker snapshot for the leaderboard stats popup. Same cache
// stance as /api/analytics/visitors: force-dynamic handler with a 30s
// Data Cache layer. Fetch is bounded (bytes, timeout, page cap) and
// fails closed — no silent empty dashboard.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 30

const loadTrackerStats = unstable_cache(
  async () => {
    const url = goatcounterStatsUrl()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TRACKER_FETCH_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/html' },
        cache: 'no-store',
        redirect: 'error'
      })
      if (!res.ok) throw new Error(`Tracker HTTP ${res.status}`)
      const html = await readResponseTextBounded(res)
      const stats = parseGoatcounterDashboard(html)
      if (!stats) throw new Error('Tracker snapshot unreadable')
      return stats
    } finally {
      clearTimeout(timer)
    }
  },
  ['goatcounter-tracker-stats-v1'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  try {
    const stats = await loadTrackerStats()
    return NextResponse.json(
      { success: true, ...stats },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`
        }
      }
    )
  } catch (err) {
    console.error('[TrackerStats] Snapshot failed:', err)
    return NextResponse.json(
      { success: false, schemaVersion: TRACKER_STATS_SCHEMA_VERSION },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
