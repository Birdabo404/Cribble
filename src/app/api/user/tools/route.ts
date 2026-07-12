import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import {
  fetchAllUserEvents,
  normalizeLegacyEventValues,
  scoreFromEvents,
  type ScoreEventWithTimestamp
} from '@/lib/scoring'
import { resolveToolName } from '@/lib/toolNames'

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

    type Agg = {
      name: string
      visits: number
      active_ms: number
      score: number
      events: ScoreEventWithTimestamp[]
    }
    const grouped: Record<string, Agg> = {}

    for (const ev of events || []) {
      const name = resolveToolName(String(ev.domain || ''))
      if (!grouped[name]) {
        grouped[name] = { name, visits: 0, active_ms: 0, score: 0, events: [] }
      }
      const normalized = normalizeLegacyEventValues(ev)
      grouped[name].visits += normalized.visits
      grouped[name].active_ms += normalized.activeMs
      grouped[name].events.push(ev)
    }

    // Score each tool's events as sessions (per-event scoring is what broke
    // the multipliers in the first place).
    for (const agg of Object.values(grouped)) {
      agg.score = scoreFromEvents(agg.events)
    }

    const all = Object.values(grouped).sort((a, b) => b.score - a.score || b.visits - a.visits)
    const totalScore = all.reduce((s, t) => s + t.score, 0)
    const totalVisits = all.reduce((s, t) => s + t.visits, 0)

    const tools = all.slice(0, limit).map((t) => ({
      name: t.name,
      visits: t.visits,
      active_ms: t.active_ms,
      score: Math.round(t.score),
      percent: totalScore > 0 ? Math.round((t.score / totalScore) * 100) : 0,
      visitsPercent: totalVisits > 0 ? Math.round((t.visits / totalVisits) * 100) : 0
    }))

    return NextResponse.json({
      success: true,
      tools,
      totals: {
        score: Math.round(totalScore),
        visits: totalVisits,
        distinctTools: all.length
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
