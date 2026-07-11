import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUserId } from '@/lib/sessionAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
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
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}


