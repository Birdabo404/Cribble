import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    // Get session token from cookie
    const sessionToken = request.cookies.get('cribble_session')?.value

    if (!sessionToken) {
      return NextResponse.json(
        { error: 'No session found' },
        { status: 401 }
      )
    }

    // Find active session
    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .select('user_id, expires_at')
      .eq('session_token', sessionToken)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 401 }
      )
    }
    
    // Get user data
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, twitter_username, twitter_name, twitter_profile_image, created_at, last_login, subscription_tier, user_type, active_device_uuid, last_extension_sync')
      .eq('id', session.user_id)
      .single()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Calculate scores and stats directly from events_raw for reliability
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Get all events for this user
    const userId = Number(session.user_id)
    
    // Try direct query - the leaderboard route uses the same pattern
    const { data: allEvents, error: eventsError } = await supabase
      .from('events_raw')
      .select('active_ms, visits, timestamp, total_ms')
      .eq('user_id', userId)

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
    } else if (allEvents && allEvents.length > 0) {
      const calculateScore = (events: any[]) => 
        events.reduce((sum, e) => sum + (e.active_ms || 0) * 0.001 + (e.visits || 0) * 50, 0)

      const todayEvents = allEvents.filter(e => e.timestamp >= todayStart)
      const weekEvents = allEvents.filter(e => e.timestamp >= weekStart)
      const monthEvents = allEvents.filter(e => e.timestamp >= monthStart)

      // Calculate scores
      scores = {
        total_score: Math.round(calculateScore(allEvents)),
        today_score: Math.round(calculateScore(todayEvents)),
        week_score: Math.round(calculateScore(weekEvents)),
        month_score: Math.round(calculateScore(monthEvents)),
        last_calculated_at: now.toISOString()
      }

      // Calculate detailed stats
      const totalVisits = allEvents.reduce((sum, e) => sum + (e.visits || 0), 0)
      const todayVisits = todayEvents.reduce((sum, e) => sum + (e.visits || 0), 0)
      const totalActiveMs = allEvents.reduce((sum, e) => sum + (e.active_ms || 0), 0)
      const todayActiveMs = todayEvents.reduce((sum, e) => sum + (e.active_ms || 0), 0)
      const totalMs = allEvents.reduce((sum, e) => sum + (e.total_ms || e.active_ms || 0), 0)
      const todayMs = todayEvents.reduce((sum, e) => sum + (e.total_ms || e.active_ms || 0), 0)

      // Efficiency: active time / total time * 100
      const efficiency = todayMs > 0 ? Math.min(100, Math.round((todayActiveMs / todayMs) * 100)) : 0

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

    // Get user's active device info (.maybeSingle returns null on 0 rows, no error)
    const { data: activeDevice } = await supabase
      .from('user_devices')
      .select('*')
      .eq('user_id', session.user_id)
      .eq('is_active', true)
      .maybeSingle()

    return NextResponse.json({
      user,
      scores,
      stats,
      activeDevice: activeDevice ? {
        device_uuid: activeDevice.device_uuid,
        device_name: activeDevice.device_name,
        last_sync_at: activeDevice.last_sync_at
      } : null
    })
    
  } catch (error) {
    console.error('Get user API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 