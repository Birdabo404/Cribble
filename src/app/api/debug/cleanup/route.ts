import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/adminAudit'
import { getDebugStaffUser, hasValidDebugToken } from '@/lib/debugRouteAuth'
import { cleanReason } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

const supabase = createServiceClient()

export async function POST(request: NextRequest) {
  try {
    const staff = await getDebugStaffUser(request)
    if (!staff.ok) {
      return NextResponse.json({ success: false, error: staff.error }, { status: staff.status })
    }

    const body = await request.json().catch(() => ({}))
    const { action, confirmToken } = body
    const reason = cleanReason(body.reason)

    if (!hasValidDebugToken(confirmToken, 'DEBUG_CLEANUP_TOKEN')) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid confirmation token' 
      }, { status: 400 })
    }
    if (!reason) {
      return NextResponse.json(
        { success: false, error: 'A reason of at least 10 characters is required' },
        { status: 400 }
      )
    }
    
    if (action === 'clean_anomalous') {
      console.log('[Data Cleanup] Starting cleanup of anomalous events...')
      
      // Define what constitutes "anomalous"
      const MAX_REASONABLE_ACTIVE_MS = 30 * 60 * 1000 // 30 minutes
      const MAX_REASONABLE_VISITS = 50
      
      // Find anomalous events
      const { data: anomalousEvents, error: fetchError } = await supabase
        .from('events_raw')
        .select('id, user_id, domain, active_ms, visits, timestamp')
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
        console.log(`[Data Cleanup] Deleting anomalous event: ID ${event.id}, User ${event.user_id}, Domain ${event.domain}, Active: ${activeHours.toFixed(2)}h, Visits: ${event.visits}`)
      })
      
      // Delete anomalous events
      const eventIds = anomalousEvents.map(e => e.id)
      // Fail closed: no destructive cleanup happens unless the attempt is
      // durably attributed to the owner first.
      await logAdminAction(supabase, {
        adminUserId: staff.staff.userId,
        targetUserId: null,
        action: 'debug.clean_anomalous',
        oldValues: {
          event_count: eventIds.length,
          event_ids: eventIds.slice(0, 100)
        },
        newValues: { intended_result: 'delete anomalous events' },
        reason
      })

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
          user: e.user_id,
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
    }, { status: 500 })
  }
}
