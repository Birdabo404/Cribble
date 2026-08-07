import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import { ensureUserStatsRollup, TOP_TOOLS_ROLLUP_LIMIT } from '@/lib/userStats'

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
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '5', 10) || 5, 1),
      TOP_TOOLS_ROLLUP_LIMIT
    )

    // Tools come from the user_scores rollup (written on every sync,
    // lazily backfilled for pre-migration rows) instead of a second full
    // events_raw replay. The rollup stores the same rankToolsFromEvents
    // output every other surface uses, so the #1 tool still matches the
    // leaderboard and public profile.
    const rollup = await ensureUserStatsRollup(supabase, session.userId)
    if (rollup === null) {
      console.error('[Tools API] Stats rollup unavailable')
      return NextResponse.json(
        { success: false, error: 'Database query failed' },
        { status: 500 }
      )
    }

    const ranked = rollup.topTools
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
