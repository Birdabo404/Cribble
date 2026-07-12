import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'

const supabase = createServiceClient()

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

    // Connected = device exists and is active.
    // No userId in the response: this endpoint requires no auth, so it must
    // not map device UUIDs to accounts.
    return NextResponse.json({ connected: !!device.is_active })
  } catch {
    return NextResponse.json({ connected: false, error: 'Internal server error' }, { status: 500 })
  }
}


