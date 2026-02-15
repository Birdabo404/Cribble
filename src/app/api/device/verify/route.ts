import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// OPTIONS - Handle CORS preflight requests (middleware handles CORS)
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 200 })
}

// GET - Verify if device UUID is active and registered
export async function GET(request: NextRequest) {
  try {
    // Rate limiting - strict limits for device verification
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.auth)
    if (!rateLimitResult.success) {
      const headers = createRateLimitResponse(rateLimitResult)
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: rateLimitResult.retryAfter
        },
        { status: 429, headers }
      )
    }

    const { searchParams } = new URL(request.url)
    const deviceUuid = searchParams.get('deviceUuid')

    console.log('[Device Verify] GET request for device:', deviceUuid?.slice(0, 8) + '...')
    
    if (!deviceUuid) {
      return NextResponse.json({
        success: false,
        verified: false,
        isActive: false,
        error: 'Device UUID is required'
      }, { status: 400 })
    }

    // Check if device exists and is active
    const { data: device, error: deviceError } = await supabase
      .from('user_devices')
      .select(`
        id,
        user_id,
        device_uuid,
        device_name,
        is_active,
        last_sync_at,
        created_at
      `)
      .eq('device_uuid', deviceUuid)
      .single()

    if (deviceError || !device) {
      console.log('[Device Verify] Device not found:', deviceError?.message)
      return NextResponse.json({
        success: true,
        verified: false,
        isActive: false,
        message: 'Device not registered'
      }, { status: 200 })
    }

    console.log('[Device Verify] Found device:', {
      id: device.id,
      isActive: device.is_active,
      userId: device.user_id,
      lastSync: device.last_sync_at
    })

    const isActive = device.is_active === true
    
    // Optionally fetch user data if needed
    let userData = null
    if (device.user_id) {
      const { data: user } = await supabase
        .from('users')
        .select('id, twitter_id, twitter_name, twitter_username')
        .eq('id', device.user_id)
        .single()
      userData = user
    }
    
    return NextResponse.json({
      success: true,
      verified: isActive,
      isActive: isActive,
      message: isActive ? 'Device is active and verified' : 'Device is registered but not active',
      device: {
        uuid: device.device_uuid,
        name: device.device_name,
        userId: device.user_id,
        lastSync: device.last_sync_at,
        createdAt: device.created_at
      },
      user: userData ? {
        id: userData.id,
        authProviderId: userData.twitter_id,
        name: userData.twitter_name,
        username: userData.twitter_username
      } : null
    })

  } catch (error) {
    console.error('[Device Verify] GET error:', error)
    return NextResponse.json({
      success: false,
      verified: false,
      isActive: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// POST - Verify if device UUID is active and registered
export async function POST(request: NextRequest) {
  try {
    // Rate limiting - strict limits for device verification
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.auth)
    if (!rateLimitResult.success) {
      const headers = createRateLimitResponse(rateLimitResult)
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: rateLimitResult.retryAfter
        },
        { status: 429, headers }
      )
    }

    const { deviceUuid } = await request.json()

    if (!deviceUuid) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing device UUID',
        isActive: false,
        verified: false
      }, { status: 400 })
    }

    console.log(`[Device Verify] Checking device ${deviceUuid.slice(0, 8)}...`)
    
    // Check if device exists and is active
    const { data: device, error } = await supabase
      .from('user_devices')
      .select('id, device_uuid, is_active, last_sync_at, user_id')
      .eq('device_uuid', deviceUuid)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') {
        // Device not found
        console.log(`[Device Verify] Device ${deviceUuid.slice(0, 8)}... not found`)
        return NextResponse.json({ 
          success: true,
          isActive: false,
          verified: false,
          message: 'Device not registered'
        })
      }
      
      console.error('[Device Verify] Database error:', error)
      return NextResponse.json({ 
        success: false, 
        error: 'Database query failed',
        isActive: false,
        verified: false
      }, { status: 500 })
    }

    const isActive = device.is_active === true
    const hasRecentSync = device.last_sync_at && 
      (Date.now() - new Date(device.last_sync_at).getTime()) < 300000 // 5 minutes

    console.log(`[Device Verify] Device ${deviceUuid.slice(0, 8)}... - Active: ${isActive}, Recent sync: ${hasRecentSync}`)
    
    return NextResponse.json({
      success: true,
      isActive,
      verified: isActive,
      hasRecentSync,
      lastSyncAt: device.last_sync_at,
      userId: device.user_id
    })
    
  } catch (error) {
    console.error('[Device Verify] Error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error',
      isActive: false,
      verified: false
    }, { status: 500 })
  }
}
