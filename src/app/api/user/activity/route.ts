import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getEventsIdentityColumn } from '@/lib/eventsIdentity'
import { fetchAllEventPages } from '@/lib/eventsFetch'
import { scoreFromEvents, type ScoreEventWithTimestamp } from '@/lib/scoring'
import { getSessionUserId } from '@/lib/sessionAuth'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

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

    const eventsUserColumn = await getEventsIdentityColumn(supabase)
    if (!eventsUserColumn) {
      console.warn('[Activity API] No compatible events_raw user column found')
    }

    const { rows: events, error: eventsError } = eventsUserColumn
      ? await fetchAllEventPages<ScoreEventWithTimestamp>(
          (from, to) =>
            supabase
              .from('events_raw')
              .select('timestamp, active_ms, total_ms, visits, domain')
              .eq(eventsUserColumn, session.userId)
              .gte('timestamp', startDate.toISOString())
              .lt('timestamp', new Date(endDate.getTime() + ONE_DAY_MS).toISOString())
              .order('timestamp', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to) as PromiseLike<{
                data: ScoreEventWithTimestamp[] | null
                error: { message: string } | null
              }>
        )
      : { rows: [] as ScoreEventWithTimestamp[], error: null }

    if (eventsError) {
      console.error('[Activity API] Error fetching events:', eventsError)
      return NextResponse.json({
        success: true,
        activity: [],
        stats: { totalScore: 0, daysWithActivity: 0, averageScore: 0, totalDays: days }
      })
    }

    // Group each day's events and score them as sessions, so a day's cell
    // agrees with how the same activity is scored everywhere else.
    const dayEvents: Record<string, ScoreEventWithTimestamp[]> = {}
    for (const event of events) {
      const dateKey = toDateKeyUtc(new Date(String(event.timestamp)))
      if (!dayEvents[dateKey]) dayEvents[dateKey] = []
      dayEvents[dateKey].push(event)
    }

    const dailyScores: Record<string, number> = {}
    for (let i = 0; i < days; i++) {
      const date = new Date(endDate.getTime() - i * ONE_DAY_MS)
      dailyScores[toDateKeyUtc(date)] = 0
    }
    for (const [dateKey, group] of Object.entries(dayEvents)) {
      if (dateKey in dailyScores) {
        dailyScores[dateKey] = scoreFromEvents(group)
      }
    }

    const activityData = Object.entries(dailyScores)
      .map(([date, score]) => ({ date, score }))
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
