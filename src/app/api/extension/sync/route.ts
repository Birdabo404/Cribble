import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface DeviceInfo {
  userAgent: string
  browserName: string
  browserVersion: string
  os: string
  deviceName: string
}

interface ExtensionEvent {
  type: string
  domain: string
  timestamp: number
  duration?: number
  score?: number
  metadata?: any
}

interface SyncRequest {
  deviceUuid: string
  userId?: number
  events: ExtensionEvent[]
  batchId: string
  deviceInfo: DeviceInfo
}

const extensionEventSchema = z.object({
  type: z.string(),
  domain: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  duration: z.number().int().nonnegative().optional(),
  score: z.number().int().optional(),
  metadata: z.any().optional()
})

const syncRequestSchema = z.object({
  deviceUuid: z.string().uuid(),
  userId: z.number().int().positive().optional(),
  events: z.array(extensionEventSchema),
  batchId: z.string().min(1)
})

// Helper function to parse user agent
function parseUserAgent(userAgent: string): DeviceInfo {
  const browserRegex = /(Chrome|Firefox|Safari|Edge)\/(\d+\.\d+)/i
  const osRegex = /(Windows|Mac|Linux|Android|iOS)/i
  
  const browserMatch = userAgent.match(browserRegex)
  const osMatch = userAgent.match(osRegex)
  
  const browserName = browserMatch ? browserMatch[1] : 'Unknown'
  const browserVersion = browserMatch ? browserMatch[2] : '0.0'
  const os = osMatch ? osMatch[1] : 'Unknown'
  
  return {
    userAgent,
    browserName,
    browserVersion,
    os,
    deviceName: `${browserName} ${browserVersion} on ${os}`
  }
}

// Register or update device with atomic operations to prevent race conditions
async function registerDevice(userId: number, deviceUuid: string, deviceInfo: DeviceInfo) {
  console.log(`[Extension Sync] Registering device ${deviceUuid} for user ${userId}`)

  try {
    const currentTime = new Date().toISOString()

    // Use RPC function to handle device registration atomically
    // This prevents race conditions by ensuring only one device is active per user
    const { data: result, error } = await supabase.rpc('register_user_device', {
      p_user_id: userId,
      p_device_uuid: deviceUuid,
      p_device_name: deviceInfo.deviceName,
      p_browser_info: deviceInfo,
      p_last_sync_at: currentTime
    })

    if (error) {
      console.error(`[Extension Sync] RPC error:`, error)

      // Fallback to manual approach if RPC is not available
      console.log(`[Extension Sync] Falling back to manual device registration`)

      // First, deactivate all other devices for this user
      await supabase
        .from('user_devices')
        .update({
          is_active: false,
          deactivated_at: currentTime
        })
        .eq('user_id', userId)
        .neq('device_uuid', deviceUuid)

      // Check if device already exists
      const { data: existingDevice } = await supabase
        .from('user_devices')
        .select('*')
        .eq('device_uuid', deviceUuid)
        .single()

      if (existingDevice) {
        // Update existing device and ensure it's active
        const { error: updateError } = await supabase
          .from('user_devices')
          .update({
            device_name: deviceInfo.deviceName,
            browser_info: deviceInfo,
            is_active: true,
            last_sync_at: currentTime,
            deactivated_at: null
          })
          .eq('device_uuid', deviceUuid)

        if (updateError) throw updateError
        console.log(`[Extension Sync] Updated existing device ${deviceUuid} - Set to active`)
      } else {
        // Create new device
        const { error: insertError } = await supabase
          .from('user_devices')
          .insert({
            user_id: userId,
            device_uuid: deviceUuid,
            device_name: deviceInfo.deviceName,
            browser_info: deviceInfo,
            is_active: true,
            last_sync_at: currentTime
          })

        if (insertError) throw insertError
        console.log(`[Extension Sync] Created new device ${deviceUuid} - Set to active`)
      }

      // Update user's active device
      await supabase
        .from('users')
        .update({
          active_device_uuid: deviceUuid,
          last_extension_sync: currentTime
        })
        .eq('id', userId)

      // Verify the device is active
      const { data: verifyDevice } = await supabase
        .from('user_devices')
        .select('is_active')
        .eq('device_uuid', deviceUuid)
        .single()

      const isActive = verifyDevice?.is_active === true
      console.log(`[Extension Sync] Device registration verification - Device ${deviceUuid} is_active: ${isActive}`)

      return isActive
    }

    // RPC succeeded
    console.log(`[Extension Sync] Device registered successfully via RPC: ${deviceUuid}`)
    return true

  } catch (error) {
    console.error(`[Extension Sync] Device registration failed:`, error)
    return false
  }
}

// Validate device is active for user
async function validateDevice(userId: number, deviceUuid: string) {
  const { data: device } = await supabase
    .from('user_devices')
    .select('*')
    .eq('user_id', userId)
    .eq('device_uuid', deviceUuid)
    .eq('is_active', true)
    .single()
  
  return !!device
}

// Process extension events
async function processEvents(userId: number, deviceUuid: string, events: ExtensionEvent[], batchId: string) {
  if (!events || events.length === 0) return { processed: 0, errors: [] }
  
  console.log(`[Extension Sync] Processing ${events.length} events for device ${deviceUuid}`)
  
  // Validation constants
  const MAX_ACTIVE_TIME_MS = 30 * 60 * 1000 // 30 minutes max per event
  const MAX_VISITS_PER_EVENT = 50 // reasonable limit
  
  // Filter and validate events
  const validEvents = events.filter(event => {
    const duration = event.duration || 0
    const visits = event.type === 'visit' ? 1 : 0
    
    // Log suspicious events
    if (duration > MAX_ACTIVE_TIME_MS) {
      console.warn(`[Extension Sync] Rejecting event with excessive duration: ${duration}ms (${duration/1000/60} minutes) on ${event.domain}`)
      return false
    }
    
    if (visits > MAX_VISITS_PER_EVENT) {
      console.warn(`[Extension Sync] Rejecting event with excessive visits: ${visits} on ${event.domain}`)
      return false
    }
    
    // Ensure reasonable timestamp
    const eventTime = new Date(event.timestamp).getTime()
    const now = Date.now()
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000)
    const oneHourFuture = now + (60 * 60 * 1000)
    
    if (eventTime < oneWeekAgo || eventTime > oneHourFuture) {
      console.warn(`[Extension Sync] Rejecting event with invalid timestamp: ${event.timestamp} on ${event.domain}`)
      return false
    }
    
    return true
  })
  
  if (validEvents.length !== events.length) {
    console.warn(`[Extension Sync] Filtered ${events.length - validEvents.length} invalid events out of ${events.length}`)
  }
  
  // Convert extension events to events_raw format (matching bulk API)
  const processedEvents = validEvents.map(event => ({
    device_uuid: deviceUuid,
    user_id: userId,
    timestamp: new Date(event.timestamp).toISOString(),
    domain: event.domain?.toLowerCase(),
    active_ms: Math.min(event.duration || 0, MAX_ACTIVE_TIME_MS),
    total_ms: Math.min(event.duration || 0, MAX_ACTIVE_TIME_MS),
    visits: event.type === 'visit' ? 1 : 0,
    client_version: 'extension_v1'
  }))
  
  // Check for duplicates within the batch first
  const uniqueEvents = []
  const seenKeys = new Set()

  for (const event of processedEvents) {
    const key = `${event.user_id}-${event.domain}-${event.timestamp}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      uniqueEvents.push(event)
    } else {
      console.warn(`[Extension Sync] Skipping duplicate event within batch: ${event.domain} at ${event.timestamp}`)
    }
  }

  if (uniqueEvents.length === 0) {
    return { processed: 0, errors: ['All events were filtered out as invalid or duplicates'] }
  }

  // Check for existing events in database to prevent duplicates
  const eventKeys = uniqueEvents.map(event => ({
    user_id: event.user_id,
    domain: event.domain,
    timestamp: event.timestamp
  }))

  // Query existing events with the same user_id, domain, and timestamp
  const { data: existingEvents } = await supabase
    .from('events_raw')
    .select('user_id, domain, timestamp')
    .or(
      eventKeys.map(key => `and(user_id.eq.${key.user_id},domain.eq.${key.domain},timestamp.eq.${key.timestamp})`).join(',')
    )

  // Filter out events that already exist in the database
  const existingEventKeys = new Set(
    (existingEvents || []).map(event => `${event.user_id}-${event.domain}-${event.timestamp}`)
  )

  const finalEvents = uniqueEvents.filter(event => {
    const key = `${event.user_id}-${event.domain}-${event.timestamp}`
    if (existingEventKeys.has(key)) {
      console.warn(`[Extension Sync] Skipping duplicate event (already in DB): ${event.domain} at ${event.timestamp}`)
      return false
    }
    return true
  })

  if (finalEvents.length === 0) {
    return { processed: 0, errors: ['All events already exist in database'] }
  }

  // Insert events with proper error handling for constraint violations
  const { data, error } = await supabase
    .from('events_raw')
    .insert(finalEvents)
    .select()

  if (error) {
    // Check if it's a duplicate constraint violation
    if (error.code === '23505') {
      console.warn(`[Extension Sync] Some events were duplicates and could not be inserted:`, error.message)
      return { processed: 0, errors: ['Some events were duplicates'] }
    }
    console.error(`[Extension Sync] Failed to insert events:`, error)
    return { processed: 0, errors: [error.message] }
  }

  const duplicatesFiltered = uniqueEvents.length - finalEvents.length
  console.log(`[Extension Sync] Successfully inserted ${data.length} events (filtered ${duplicatesFiltered} duplicates from ${events.length} original events)`)
  return { processed: data.length, errors: [] }
}

// GET - Return user's extension stats
export async function GET(request: NextRequest) {
  try {
    const deviceUuid = request.headers.get('X-Extension-Device-UUID')
    const userId = request.headers.get('X-Extension-User-ID')
    
    if (!deviceUuid || !userId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing device UUID or user ID' 
      }, { status: 400 })
    }
    
    const userIdNum = parseInt(userId)
    
    // Validate device
    const isValidDevice = await validateDevice(userIdNum, deviceUuid)
    if (!isValidDevice) {
      return NextResponse.json({ 
        success: false, 
        error: 'Device not registered or inactive' 
      }, { status: 403 })
    }
    
    // Get today's stats (last 24 hours)
    const { data: todayStats } = await supabase
      .from('events_raw')
      .select('active_ms, total_ms, visits, timestamp')
      .eq('user_id', userIdNum)
      .gte('timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    
    // Get total stats (all time)
    const { data: totalStats } = await supabase
      .from('events_raw')
      .select('active_ms, total_ms, visits')
      .eq('user_id', userIdNum)
    
    // Calculate scores (basic scoring based on activity only)
    const todayFromEvents = todayStats?.reduce((sum, event) => sum + (event.active_ms || 0) * 0.001 + (event.visits || 0) * 50, 0) || 0
    const totalFromEvents = totalStats?.reduce((sum, event) => sum + (event.active_ms || 0) * 0.001 + (event.visits || 0) * 50, 0) || 0
    const todayScore = todayFromEvents
    const totalScore = totalFromEvents
    
    // Calculate time stats
    const todayActiveTime = todayStats?.reduce((sum, event) => sum + (event.active_ms || 0), 0) || 0
    const todayTotalTime = todayStats?.reduce((sum, event) => sum + (event.total_ms || 0), 0) || 0
    const totalActiveTime = totalStats?.reduce((sum, event) => sum + (event.active_ms || 0), 0) || 0
    const totalTime = totalStats?.reduce((sum, event) => sum + (event.total_ms || 0), 0) || 0
    
    // Calculate visits
    const todayVisits = todayStats?.reduce((sum, event) => sum + (event.visits || 0), 0) || 0
    const totalVisits = totalStats?.reduce((sum, event) => sum + (event.visits || 0), 0) || 0
    
    // Calculate efficiency: active time / total time * 100
    const efficiency = todayTotalTime > 0 ? Math.min(100, Math.round((todayActiveTime / todayTotalTime) * 100)) : 0
    
    return NextResponse.json({
      success: true,
      data: {
        totalScore,
        todayScore,
        totalVisits,
        todayVisits,
        totalTime,
        todayTime: todayTotalTime,
        activeTime: todayActiveTime,
        efficiency,
        streak: 1,
        rank: 'Active'
      },
      debug: {
        counts: {
          today: todayStats?.length || 0,
          total: totalStats?.length || 0
        }
      }
    })
  } catch (error) {
    console.error('[Extension Sync] GET error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

// POST - Sync extension data
export async function POST(request: NextRequest) {
  try {
    // Rate limiting - allow higher limits for data ingestion
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.ingestion)
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

    // Basic runtime validation
    const parsed = syncRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
    }
    const { deviceUuid, userId, events, batchId } = parsed.data
    
    if (!deviceUuid || !batchId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required fields' 
      }, { status: 400 })
    }
    
  // Parse device info from user agent (ignore extension-provided stubs)
  const userAgent = request.headers.get('user-agent') || ''
  const finalDeviceInfo = parseUserAgent(userAgent)
    
    // If userId provided, this is a device registration
    if (userId) {
      console.log(`[Extension Sync] Device registration requested: ${deviceUuid} for user ${userId}`)
      
      // First check if user exists
      const { data: userExists } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .single()
      
      if (!userExists) {
        console.error(`[Extension Sync] User ${userId} not found in database`)
        return NextResponse.json({ 
          success: false, 
          error: `User ${userId} does not exist. Please ensure you are logged in properly.` 
        }, { status: 400 })
      }
      
      const registered = await registerDevice(userId, deviceUuid, finalDeviceInfo)
      if (!registered) {
        console.error(`[Extension Sync] Device registration failed for ${deviceUuid}`)
        return NextResponse.json({ 
          success: false, 
          error: 'Device registration failed' 
        }, { status: 500 })
      }
      console.log(`[Extension Sync] Device registration successful: ${deviceUuid}`)
    }
    
    // Get user ID from device if not provided
    let finalUserId = userId
    if (!finalUserId) {
      const { data: device } = await supabase
        .from('user_devices')
        .select('user_id, is_active')
        .eq('device_uuid', deviceUuid)
        .single()
      
      if (!device || !device.is_active) {
        return NextResponse.json({ 
          success: false, 
          error: 'Device not registered or inactive' 
        }, { status: 403 })
      }
      
      finalUserId = device.user_id
    }
    
    // Ensure we have a valid user ID
    if (!finalUserId) {
      return NextResponse.json({ 
        success: false, 
        error: 'User ID not found' 
      }, { status: 400 })
    }
    
    // Validate device is active
    const isValidDevice = await validateDevice(finalUserId, deviceUuid)
    if (!isValidDevice) {
      return NextResponse.json({ 
        success: false, 
        error: 'Device not active for this user' 
      }, { status: 403 })
    }
    
    // Process events
    const result = await processEvents(finalUserId, deviceUuid, events, batchId)
    
    // Update device last sync time
    await supabase
      .from('user_devices')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('device_uuid', deviceUuid)
    
    // Trigger score recalculation using the new centralized scoring system
    console.log(`[Extension Sync] Triggering score recalculation for user ${finalUserId}`)

    try {
      // Use the new RPC function to recalculate all scores
      const { error: scoreError } = await supabase.rpc('recalculate_user_score', {
        p_user_id: finalUserId
      })

      if (scoreError) {
        console.error(`[Extension Sync] Failed to recalculate user scores:`, scoreError)
      } else {
        console.log(`[Extension Sync] Successfully triggered score recalculation for user ${finalUserId}`)
      }

      // Update user's last sync time
      await supabase
        .from('users')
        .update({ last_extension_sync: new Date().toISOString() })
        .eq('id', finalUserId)

    } catch (error) {
      console.error(`[Extension Sync] Error triggering score recalculation:`, error)
    }
    
    console.log(`[Extension Sync] Sync completed: ${result.processed} events processed`)
    
    return NextResponse.json({
      success: true,
      processed: result.processed,
      errors: result.errors,
      batchId
    })
    
  } catch (error) {
    console.error('[Extension Sync] POST error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

// DELETE - Unregister device
export async function DELETE(request: NextRequest) {
  try {
    const deviceUuid = request.headers.get('X-Extension-Device-UUID')
    
    if (!deviceUuid) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing device UUID' 
      }, { status: 400 })
    }
    
    // Deactivate device
    const { error } = await supabase
      .from('user_devices')
      .update({ 
        is_active: false, 
        deactivated_at: new Date().toISOString() 
      })
      .eq('device_uuid', deviceUuid)
    
    if (error) throw error
    
    console.log(`[Extension Sync] Device ${deviceUuid} unregistered`)
    
    return NextResponse.json({ success: true })
    
  } catch (error) {
    console.error('[Extension Sync] DELETE error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}