import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    // Layer 1: Dev-only
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    // Layer 2: Must be authenticated
    const sessionToken = request.cookies.get('cribble_session')?.value
    if (!sessionToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { data: session } = await supabase
      .from('user_sessions')
      .select('user_id')
      .eq('session_token', sessionToken)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!session) {
      return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 })
    }

    // Layer 3: Confirmation token (env var if set, otherwise static phrase for dev)
    const debugToken = process.env.DEBUG_CLEANUP_TOKEN || 'CLEAN_ANOMALOUS_DATA_CONFIRMED'

    const { action, confirmToken } = await request.json()

    // Safety check - require confirmation token
    if (confirmToken !== debugToken) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid confirmation token' 
      }, { status: 400 })
    }
    
    if (action === 'clean_anomalous') {
      console.log('[Data Cleanup] Starting cleanup of anomalous events...')
      
      // Define what constitutes "anomalous"
      const MAX_REASONABLE_ACTIVE_MS = 30 * 60 * 1000 // 30 minutes
      const MAX_REASONABLE_VISITS = 50
      
      // Find anomalous events
      const { data: anomalousEvents, error: fetchError } = await supabase
        .from('events_raw')
        .select('id, twitter_user_id, domain, active_ms, visits, timestamp')
        .or(`active_ms.gt.${MAX_REASONABLE_ACTIVE_MS},visits.gt.${MAX_REASONABLE_VISITS}`)
      
      if (fetchError) {
        console.error('[Data Cleanup] Error fetching anomalous events:', fetchError)
        return NextResponse.json({ 
          success: false, 
          error: 'Failed to fetch anomalous events' 
        }, { status: 500 })
      }
      
      if (!anomalousEvents || anomalousEvents.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No anomalous events found',
          cleaned: 0
        })
      }
      
      console.log(`[Data Cleanup] Found ${anomalousEvents.length} anomalous events to clean`)
      
      // Log the events we're about to delete
      anomalousEvents.forEach(event => {
        const activeHours = (event.active_ms || 0) / (1000 * 60 * 60)
        console.log(`[Data Cleanup] Deleting anomalous event: ID ${event.id}, User ${event.twitter_user_id}, Domain ${event.domain}, Active: ${activeHours.toFixed(2)}h, Visits: ${event.visits}`)
      })
      
      // Delete anomalous events
      const eventIds = anomalousEvents.map(e => e.id)
      const { error: deleteError } = await supabase
        .from('events_raw')
        .delete()
        .in('id', eventIds)
      
      if (deleteError) {
        console.error('[Data Cleanup] Error deleting anomalous events:', deleteError)
        return NextResponse.json({ 
          success: false, 
          error: 'Failed to delete anomalous events' 
        }, { status: 500 })
      }
      
      console.log(`[Data Cleanup] Successfully deleted ${anomalousEvents.length} anomalous events`)
      
      return NextResponse.json({
        success: true,
        message: `Successfully cleaned ${anomalousEvents.length} anomalous events`,
        cleaned: anomalousEvents.length,
        deletedEvents: anomalousEvents.map(e => ({
          id: e.id,
          user: e.twitter_user_id,
          domain: e.domain,
          activeHours: ((e.active_ms || 0) / (1000 * 60 * 60)).toFixed(2),
          visits: e.visits,
          timestamp: e.timestamp
        }))
      })
    }
    
    return NextResponse.json({ 
      success: false, 
      error: 'Invalid action' 
    }, { status: 400 })
    
  } catch (error) {
    console.error('[Data Cleanup] Error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
