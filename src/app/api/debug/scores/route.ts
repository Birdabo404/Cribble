import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import {
  calculateScoreBuckets,
  fetchAllUserEvents,
  sessionizeEvents,
  visitsFromEvents
} from '@/lib/scoring'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // Get all users
    const { data: users } = await supabase
      .from('users')
      .select('id, twitter_username')

    const results = []

    for (const user of users || []) {
      const { events } = await fetchAllUserEvents(supabase, user.id)
      const allEvents = events || []

      if (allEvents.length === 0) {
        results.push({
          userId: user.id,
          username: user.twitter_username,
          totalEvents: 0,
          totalScore: 0,
          totalVisits: 0,
          totalActiveMs: 0,
          sessions: 0,
          anomalousEvents: []
        })
        continue
      }

      // Same scoring path as the live APIs, so this debug view can be
      // trusted to explain what users actually see.
      const buckets = calculateScoreBuckets(allEvents)
      const sessions = sessionizeEvents(allEvents)

      // Anomalies: raw rows claiming implausible values.
      const anomalousEvents = allEvents
        .filter(event =>
          (event.active_ms || 0) > 30 * 60 * 1000 || // > 30 minutes
          (event.visits || 0) > 10 // > 10 visits in one event
        )
        .slice(0, 5)
        .map(event => ({
          timestamp: event.timestamp,
          domain: event.domain,
          active_ms: event.active_ms,
          visits: event.visits
        }))

      results.push({
        userId: user.id,
        username: user.twitter_username,
        totalEvents: allEvents.length,
        totalScore: buckets.totalScore,
        todayScore: buckets.todayScore,
        weekScore: buckets.weekScore,
        monthScore: buckets.monthScore,
        totalVisits: visitsFromEvents(allEvents),
        totalActiveMs: buckets.aggregates.total.activeMs,
        totalWallMs: buckets.aggregates.total.wallMs,
        sessions: sessions.length,
        anomalousEvents
      })
    }

    return NextResponse.json({
      success: true,
      data: results,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Debug API error:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
