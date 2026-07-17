import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import { fetchAllUserEvents } from '@/lib/scoring'
import { rankToolsFromEvents } from '@/lib/topTools'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json(
        { success: false, error: session.error },
        { status: session.status }
      )
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '5', 10) || 5, 1), 20)

    const { events, column: eventsUserColumn } = await fetchAllUserEvents(
      supabase,
      session.userId
    )

    if (!eventsUserColumn) {
      console.warn('[Tools API] No compatible events_raw user column found')
    } else if (events === null) {
      console.error('[Tools API] Query error')
      return NextResponse.json(
        { success: false, error: 'Database query failed' },
        { status: 500 }
      )
    }

    // Shared ranking (score-first) — the leaderboard and public profiles go
    // through the same helper, so every surface names the same #1 tool.
    const ranked = rankToolsFromEvents(events || [])
    const totalScore = ranked.reduce((s, t) => s + t.score, 0)
    const totalVisits = ranked.reduce((s, t) => s + t.visits, 0)

    return NextResponse.json({
      success: true,
      tools: ranked.slice(0, limit),
      totals: {
        score: totalScore,
        visits: totalVisits,
        distinctTools: ranked.length
      }
    })
  } catch (err) {
    console.error('[Tools API] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
