import { NextRequest, NextResponse } from 'next/server'
import {
  calculateScoreBuckets,
  fetchAllUserEvents,
  SCORE_POLICY
} from '@/lib/scoring'
import { getSessionUserId } from '@/lib/sessionAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

const supabase = supabaseAdmin || createServiceClient()

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      // is_admin is deliberately NOT selected: no client code consumes it and
      // admin checks happen server-side (adminAuth), so exposing the flag
      // here would only fingerprint admin accounts.
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

    const { events: allEvents, column: eventsUserColumn } =
      await fetchAllUserEvents(supabase, userId)

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

    if (!eventsUserColumn) {
      console.warn('[API] /user/me - No compatible events_raw user column found')
    } else if (allEvents === null) {
      console.error('[API] /user/me - Error fetching events')
    } else if (allEvents.length > 0) {
      const scoreBuckets = calculateScoreBuckets(allEvents, now)
      const { total, today } = scoreBuckets.aggregates

      scores = {
        total_score: scoreBuckets.totalScore,
        today_score: scoreBuckets.todayScore,
        week_score: scoreBuckets.weekScore,
        month_score: scoreBuckets.monthScore,
        last_calculated_at: now.toISOString()
      }

      // Session aggregates: active time is verified heartbeat time only,
      // and total time is real session wall-clock — visit rows no longer
      // leak their page-open duration into either number.
      const efficiency =
        today.wallMs > 0
          ? Math.min(100, Math.round((today.activeMs / today.wallMs) * 100))
          : 0

      stats = {
        total_visits: total.visits,
        today_visits: today.visits,
        total_time: total.wallMs,
        today_time: today.wallMs,
        active_time: total.activeMs,
        today_active_time: today.activeMs,
        efficiency
      }
    }

    // Referral bonus (migration 026) lives outside event math; add it to
    // the lifetime total so the dashboard matches the leaderboard, which
    // ranks on user_scores.total_score = events + bonus. A read error
    // (column not migrated yet) degrades to events-only, same as before.
    const { data: bonusRow, error: bonusError } = await supabase
      .from('user_scores')
      .select('bonus_score')
      .eq('user_id', userId)
      .maybeSingle()

    if (!bonusError) {
      const bonus = Math.round(Number(bonusRow?.bonus_score ?? 0))
      if (Number.isFinite(bonus) && bonus > 0) {
        scores.total_score += bonus
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
