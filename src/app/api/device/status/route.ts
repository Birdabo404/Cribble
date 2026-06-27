import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { deviceUuid } = await request.json()
    if (!deviceUuid) {
      return NextResponse.json({ connected: false, error: 'Missing deviceUuid' }, { status: 400 })
    }

    const { data: device } = await supabase
      .from('user_devices')
      .select('user_id, is_active')
      .eq('device_uuid', deviceUuid)
      .single()

    if (!device) {
      return NextResponse.json({ connected: false })
    }

    // Connected = device exists and is active (do not expose internal user id)
    return NextResponse.json({ connected: !!device.is_active })
  } catch {
    return NextResponse.json({ connected: false, error: 'Internal server error' }, { status: 500 })
  }
}


