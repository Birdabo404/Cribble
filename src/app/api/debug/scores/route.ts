import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    console.log('=== DEBUGGING SCORE CALCULATIONS ===')
    
    // Get all users
    const { data: users } = await supabase
      .from('users')
      .select('id, twitter_username')
    
    const results = []
    
    for (const user of users || []) {
      console.log(`Analyzing user ${user.id} (${user.twitter_username})`)
      
      // Get all events for this user
      const { data: allEvents } = await supabase
        .from('events_raw')
        .select('active_ms, visits, timestamp, domain')
        .or(`user_id.eq.${user.id},twitter_user_id.eq.${user.id}`)
        .order('timestamp', { ascending: false })
      
      if (!allEvents || allEvents.length === 0) {
        results.push({
          userId: user.id,
          username: user.twitter_username,
          totalEvents: 0,
          totalScore: 0,
          totalVisits: 0,
          totalActiveMs: 0,
          anomalousEvents: []
        })
        continue
      }
      
      // Calculate total score using the same formula as the API
      const totalScore = allEvents.reduce((sum, event) => 
        sum + (event.active_ms || 0) * 0.001 + (event.visits || 0) * 50, 0)
      
      const totalVisits = allEvents.reduce((sum, event) => sum + (event.visits || 0), 0)
      const totalActiveMs = allEvents.reduce((sum, event) => sum + (event.active_ms || 0), 0)
      
      // Find anomalous events (very high active time or visits)
      const anomalousEvents = allEvents.filter(event => 
        (event.active_ms || 0) > 30 * 60 * 1000 || // > 30 minutes
        (event.visits || 0) > 10 // > 10 visits in one event
      ).slice(0, 5).map(event => ({
        timestamp: event.timestamp,
        domain: event.domain,
        active_ms: event.active_ms,
        visits: event.visits,
        score: (event.active_ms || 0) * 0.001 + (event.visits || 0) * 50
      }))
      
      results.push({
        userId: user.id,
        username: user.twitter_username,
        totalEvents: allEvents.length,
        totalScore,
        totalVisits,
        totalActiveMs,
        anomalousEvents,
        recentEvents: allEvents.slice(0, 3).map(event => ({
          timestamp: event.timestamp,
          domain: event.domain,
          active_ms: event.active_ms,
          visits: event.visits,
          score: (event.active_ms || 0) * 0.001 + (event.visits || 0) * 50
        }))
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
