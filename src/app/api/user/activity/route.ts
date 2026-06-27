import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { applyEventsUserEq } from '@/lib/eventsIdentity'
import { eventScore } from '@/lib/scoring'
import { getSessionUserId } from '@/lib/sessionAuth'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function toDateKeyUtc(date: Date) {
  return date.toISOString().split('T')[0]
}

function utcDayStart(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

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
    const days = Math.min(
      365,
      Math.max(1, parseInt(searchParams.get('days') || '84', 10) || 84)
    )

    const endDate = utcDayStart(new Date())
    const startDate = new Date(endDate.getTime() - (days - 1) * ONE_DAY_MS)

    let eventsQuery = supabase
      .from('events_raw')
      .select('timestamp, active_ms, total_ms, visits, domain')
      .gte('timestamp', startDate.toISOString())
      .lt('timestamp', new Date(endDate.getTime() + ONE_DAY_MS).toISOString())
      .order('timestamp', { ascending: true })

    const { query: scopedEventsQuery, column: eventsUserColumn } =
      await applyEventsUserEq(supabase, eventsQuery, session.userId)
    eventsQuery = scopedEventsQuery

    const { data: events, error: eventsError } = await eventsQuery

    if (eventsError) {
      console.error('[Activity API] Error fetching events:', eventsError)
      return NextResponse.json({
        success: true,
        activity: [],
        stats: { totalScore: 0, daysWithActivity: 0, averageScore: 0, totalDays: days }
      })
    }

    if (!eventsUserColumn) {
      console.warn('[Activity API] No compatible events_raw user column found')
    }

    const dailyScores: Record<string, number> = {}
    for (let i = 0; i < days; i++) {
      const date = new Date(endDate.getTime() - i * ONE_DAY_MS)
      dailyScores[toDateKeyUtc(date)] = 0
    }

    if (events && events.length > 0) {
      for (const event of events) {
        const dateKey = toDateKeyUtc(new Date(event.timestamp))
        dailyScores[dateKey] = (dailyScores[dateKey] || 0) + eventScore(event)
      }
    }

    const activityData = Object.entries(dailyScores)
      .map(([date, score]) => ({ date, score: Math.round(score) }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const totalScore = activityData.reduce((sum, d) => sum + d.score, 0)
    const daysWithActivity = activityData.filter((d) => d.score > 0).length
    const averageScore =
      daysWithActivity > 0 ? Math.round(totalScore / daysWithActivity) : 0

    return NextResponse.json({
      success: true,
      activity: activityData,
      stats: {
        totalScore,
        daysWithActivity,
        averageScore,
        totalDays: days
      }
    })
  } catch (error) {
    console.error('[Activity API] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
