import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET - Return user's devices
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('X-User-ID')
    
    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing user ID' 
      }, { status: 400 })
    }
    
    const userIdNum = parseInt(userId)
    
    // Get all devices for this user
    const { data: devices, error } = await supabase
      .from('user_devices')
      .select('*')
      .eq('user_id', userIdNum)
      .order('last_sync_at', { ascending: false })
    
    if (error) {
      console.error('[Extension Devices] Database error:', error)
      return NextResponse.json({ 
        success: false, 
        error: 'Database query failed' 
      }, { status: 500 })
    }
    
    // Format devices for dashboard
    const formattedDevices = (devices || []).map(device => ({
      id: device.id,
      deviceUuid: device.device_uuid,
      deviceName: device.device_name,
      browserInfo: device.browser_info,
      isActive: device.is_active,
      lastSyncAt: device.last_sync_at,
      createdAt: device.created_at,
      deactivatedAt: device.deactivated_at
    }))
    
    console.log(`[Extension Devices] Found ${formattedDevices.length} devices for user ${userIdNum}`)
    
    return NextResponse.json({
      success: true,
      devices: formattedDevices
    })
    
  } catch (error) {
    console.error('[Extension Devices] GET error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

// POST - Register new device (alternative to sync route)
export async function POST(request: NextRequest) {
  try {
    const { deviceUuid, userId, deviceInfo } = await request.json()
    
    if (!deviceUuid || !userId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required fields' 
      }, { status: 400 })
    }
    
    // Check if device already exists
    const { data: existingDevice } = await supabase
      .from('user_devices')
      .select('*')
      .eq('device_uuid', deviceUuid)
      .single()
    
    if (existingDevice) {
      // Update existing device
      const { error } = await supabase
        .from('user_devices')
        .update({
          device_name: deviceInfo?.deviceName || 'Unknown Device',
          browser_info: deviceInfo,
          is_active: true,
          last_sync_at: new Date().toISOString(),
          deactivated_at: null
        })
        .eq('device_uuid', deviceUuid)
      
      if (error) throw error
      console.log(`[Extension Devices] Updated existing device ${deviceUuid}`)
    } else {
      // Create new device (trigger will deactivate old ones)
      const { error } = await supabase
        .from('user_devices')
        .insert({
          user_id: userId,
          device_uuid: deviceUuid,
          device_name: deviceInfo?.deviceName || 'Unknown Device',
          browser_info: deviceInfo,
          is_active: true,
          last_sync_at: new Date().toISOString()
        })
      
      if (error) throw error
      console.log(`[Extension Devices] Created new device ${deviceUuid}`)
    }
    
    // Update user's active device
    await supabase
      .from('users')
      .update({
        active_device_uuid: deviceUuid,
        last_extension_sync: new Date().toISOString()
      })
      .eq('id', userId)
    
    return NextResponse.json({
      success: true,
      message: 'Device registered successfully'
    })
    
  } catch (error) {
    console.error('[Extension Devices] POST error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

// DELETE - Deactivate device or purge if requested
export async function DELETE(request: NextRequest) {
  try {
    const { deviceUuid, purge } = await request.json()
    
    if (!deviceUuid) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing device UUID' 
      }, { status: 400 })
    }
    
    if (purge) {
      // Permanently delete the device record
      const { error } = await supabase
        .from('user_devices')
        .delete()
        .eq('device_uuid', deviceUuid)
      if (error) throw error
      console.log(`[Extension Devices] Purged device ${deviceUuid}`)
      return NextResponse.json({ success: true, message: 'Device removed permanently' })
    } else {
      // Deactivate device
      const { error } = await supabase
        .from('user_devices')
        .update({ 
          is_active: false, 
          deactivated_at: new Date().toISOString() 
        })
        .eq('device_uuid', deviceUuid)
      if (error) throw error
      console.log(`[Extension Devices] Deactivated device ${deviceUuid}`)
      return NextResponse.json({ success: true, message: 'Device deactivated successfully' })
    }
  } catch (error) {
    console.error('[Extension Devices] DELETE error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
} 