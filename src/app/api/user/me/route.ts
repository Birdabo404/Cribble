import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { applyEventsUserEq } from '@/lib/eventsIdentity'
import {
  calculateScoreBuckets,
  SCORE_POLICY,
  visitsFromEvents
} from '@/lib/scoring'
import { getSessionUserId } from '@/lib/sessionAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const supabase =
  supabaseAdmin ||
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select(
        'id, twitter_username, twitter_name, twitter_profile_image, created_at, last_login, subscription_tier, user_type, active_device_uuid, last_extension_sync'
      )
      .eq('id', session.userId)
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const now = new Date()
    const userId = Number(session.userId)

    let eventsQuery = supabase
      .from('events_raw')
      .select('active_ms, visits, timestamp, total_ms, domain')
    const { query: scopedEventsQuery, column: eventsUserColumn } =
      await applyEventsUserEq(supabase, eventsQuery, userId)
    eventsQuery = scopedEventsQuery

    const { data: allEvents, error: eventsError } = await eventsQuery

    let scores = {
      total_score: 0,
      today_score: 0,
      week_score: 0,
      month_score: 0,
      last_calculated_at: now.toISOString()
    }

    let stats = {
      total_visits: 0,
      today_visits: 0,
      total_time: 0,
      today_time: 0,
      active_time: 0,
      today_active_time: 0,
      efficiency: 0
    }

    if (eventsError) {
      console.error('[API] /user/me - Error fetching events:', eventsError)
    } else if (!eventsUserColumn) {
      console.warn('[API] /user/me - No compatible events_raw user column found')
    } else if (allEvents && allEvents.length > 0) {
      const scoreBuckets = calculateScoreBuckets(allEvents, now)
      const todayEvents = scoreBuckets.windows.today

      scores = {
        total_score: scoreBuckets.totalScore,
        today_score: scoreBuckets.todayScore,
        week_score: scoreBuckets.weekScore,
        month_score: scoreBuckets.monthScore,
        last_calculated_at: now.toISOString()
      }

      const totalVisits = visitsFromEvents(allEvents)
      const todayVisits = visitsFromEvents(todayEvents)
      const totalActiveMs = allEvents.reduce((sum, e) => sum + (e.active_ms || 0), 0)
      const todayActiveMs = todayEvents.reduce((sum, e) => sum + (e.active_ms || 0), 0)
      const totalMs = allEvents.reduce(
        (sum, e) => sum + (e.total_ms || e.active_ms || 0),
        0
      )
      const todayMs = todayEvents.reduce(
        (sum, e) => sum + (e.total_ms || e.active_ms || 0),
        0
      )
      const efficiency =
        todayMs > 0 ? Math.min(100, Math.round((todayActiveMs / todayMs) * 100)) : 0

      stats = {
        total_visits: totalVisits,
        today_visits: todayVisits,
        total_time: totalMs,
        today_time: todayMs,
        active_time: totalActiveMs,
        today_active_time: todayActiveMs,
        efficiency
      }
    }

    const { data: activeDevice } = await supabase
      .from('user_devices')
      .select('*')
      .eq('user_id', session.userId)
      .eq('is_active', true)
      .maybeSingle()

    return NextResponse.json({
      user,
      scores,
      stats,
      scoring: {
        version: SCORE_POLICY.version,
        activeMsPerPoint: SCORE_POLICY.activeMsPerPoint,
        visitPoints: SCORE_POLICY.visitPoints
      },
      activeDevice: activeDevice
        ? {
            device_uuid: activeDevice.device_uuid,
            device_name: activeDevice.device_name,
            last_sync_at: activeDevice.last_sync_at
          }
        : null
    })
  } catch (error) {
    console.error('Get user API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
