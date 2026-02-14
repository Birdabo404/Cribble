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
        { success: false, error: 'No session found' },
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
        { success: false, error: 'Invalid or expired session' },
        { status: 401 }
      )
    }

    const userId = session.user_id

    // Get the days parameter (default 84 for 12 weeks)
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '84', 10)
    
    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    
    console.log(`[Activity API] Fetching activity for user ${userId} from ${startDate.toISOString()} to ${endDate.toISOString()}`)

    // Fetch events grouped by day - use user_id filter only (integer column)
    const { data: events, error: eventsError } = await supabase
      .from('events_raw')
      .select('timestamp, active_ms, visits')
      .eq('user_id', userId)
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .order('timestamp', { ascending: true })

    if (eventsError) {
      console.error('[Activity API] Error fetching events:', eventsError)
      // Return empty data instead of error to avoid breaking the UI
      return NextResponse.json({
        success: true,
        activity: [],
        stats: { totalScore: 0, daysWithActivity: 0, averageScore: 0, totalDays: days }
      })
    }

    console.log(`[Activity API] Found ${events?.length || 0} events`)

    // Group events by day and calculate daily scores
    const dailyScores: Record<string, number> = {}
    
    // Initialize all days with 0
    for (let i = 0; i < days; i++) {
      const date = new Date(endDate)
      date.setDate(date.getDate() - i)
      const dateKey = date.toISOString().split('T')[0]
      dailyScores[dateKey] = 0
    }

    // Calculate scores for days with events
    if (events && events.length > 0) {
      for (const event of events) {
        const dateKey = new Date(event.timestamp).toISOString().split('T')[0]
        // Score calculation: active_ms * 0.001 + visits * 50
        const eventScore = (event.active_ms || 0) * 0.001 + (event.visits || 0) * 50
        dailyScores[dateKey] = (dailyScores[dateKey] || 0) + eventScore
      }
    }

    // Convert to array format sorted by date
    const activityData = Object.entries(dailyScores)
      .map(([date, score]) => ({ date, score: Math.round(score) }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Calculate some summary stats
    const totalScore = activityData.reduce((sum, d) => sum + d.score, 0)
    const daysWithActivity = activityData.filter(d => d.score > 0).length
    const averageScore = daysWithActivity > 0 ? Math.round(totalScore / daysWithActivity) : 0

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

