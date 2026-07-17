import { NextRequest, NextResponse } from 'next/server'
import { getDebugStaffUser } from '@/lib/debugRouteAuth'
import { createServiceClient } from '@/lib/supabaseServer'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
  try {
    const staff = await getDebugStaffUser(request)
    if (!staff.ok) {
      return NextResponse.json({ success: false, error: staff.error }, { status: staff.status })
    }

    console.log('[Table Info] Checking events_raw schema...')
    
    // Check table schema using information_schema
    const { data: columns, error: columnsError } = await supabase
      .from('events_raw')
      .select('*')
      .limit(1)
    
    // Also try to get actual table info
    let schemaData: unknown = null
    let schemaError: { message?: string } | null = null
    try {
      const result = await supabase.rpc('get_table_info', { table_name: 'events_raw' })
      schemaData = result.data
      schemaError = result.error
    } catch {
      schemaError = { message: 'RPC not found' }
    }

    // Try simple count
    const { count, error: countError } = await supabase
      .from('events_raw')
      .select('*', { count: 'exact', head: true })

    // Try to get a sample row
    const { data: sample, error: sampleError } = await supabase
      .from('events_raw')
      .select('id, user_id, device_uuid, timestamp, domain')
      .limit(3)
    
    // Test specific user_id query
    const testUserId = 9
    const { data: userEvents, error: userError } = await supabase
      .from('events_raw')
      .select('id, user_id')
      .eq('user_id', testUserId)
      .limit(5)

    return NextResponse.json({
      success: true,
      results: {
        sampleRow: columns?.[0] ? Object.keys(columns[0]) : 'No rows',
        columnsError: columnsError?.message,
        sampleData: sample,
        sampleError: sampleError?.message,
        totalCount: count,
        countError: countError?.message,
        userEventsForId9: userEvents,
        userQueryError: userError?.message,
        schemaRpc: schemaData || schemaError?.message
      }
    })
    
  } catch (error) {
    console.error('[Table Info] Error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error'
    }, { status: 500 })
  }
}


