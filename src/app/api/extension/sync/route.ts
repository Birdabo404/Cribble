import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { isTrackedAiDomain } from '@/lib/aiDomains'
import { recalculateUserScore } from '@/lib/scoring'
import { applyEventsUserEq, buildEventsUserInsertFields } from '@/lib/eventsIdentity'

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
  events: z.array(extensionEventSchema).max(200),
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
  console.log(`[Extension Sync] Registering device ${deviceUuid.slice(0, 8)}... for user ${userId}`)

  try {
    const currentTime = new Date().toISOString()

    // Use RPC function to handle device registration atomically
    // This prevents race conditions by ensuring only one device is active per user
    const { error } = await supabase.rpc('register_user_device', {
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
        // Update existing device: rebind to this (session-verified) user and activate
        const { error: updateError } = await supabase
          .from('user_devices')
          .update({
            user_id: userId,
            device_name: deviceInfo.deviceName,
            browser_info: deviceInfo,
            is_active: true,
            last_sync_at: currentTime,
            deactivated_at: null
          })
          .eq('device_uuid', deviceUuid)

        if (updateError) throw updateError
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

      return verifyDevice?.is_active === true
    }

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
    .select('id')
    .eq('user_id', userId)
    .eq('device_uuid', deviceUuid)
    .eq('is_active', true)
    .single()

  return !!device
}

// Process extension events
async function processEvents(userId: number, deviceUuid: string, events: ExtensionEvent[]) {
  if (!events || events.length === 0) return { processed: 0, errors: [] }

  // Validation constants
  const MAX_ACTIVE_TIME_MS = 30 * 60 * 1000 // 30 minutes max per event

  // Filter and validate events
  const validEvents = events.filter(event => {
    const duration = event.duration || 0

    // Server-side allowlist: only accept events for known AI tool domains
    if (!isTrackedAiDomain(event.domain)) {
      console.warn(`[Extension Sync] Rejecting event with untracked domain: ${event.domain}`)
      return false
    }

    if (duration > MAX_ACTIVE_TIME_MS) {
      console.warn(`[Extension Sync] Rejecting event with excessive duration: ${duration}ms on ${event.domain}`)
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

  // Resolve the identity column(s) this Supabase project expects. Some
  // deployments still key events_raw on the legacy twitter_user_id integer
  // column (with user_id as a UUID), so we must not hardcode user_id.
  const userInsertFields = await buildEventsUserInsertFields(supabase, userId)

  // Convert extension events to events_raw format
  const processedEvents = validEvents.map(event => ({
    ...userInsertFields,
    device_uuid: deviceUuid,
    timestamp: new Date(event.timestamp).toISOString(),
    domain: event.domain?.toLowerCase(),
    active_ms: Math.min(event.duration || 0, MAX_ACTIVE_TIME_MS),
    total_ms: Math.min(event.duration || 0, MAX_ACTIVE_TIME_MS),
    visits: event.type === 'visit' ? 1 : 0,
    client_version: 'extension_v1'
  }))

  // Check for duplicates within the batch first (domain + timestamp)
  const uniqueEvents = []
  const seenKeys = new Set()

  for (const event of processedEvents) {
    const key = `${event.domain}-${event.timestamp}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      uniqueEvents.push(event)
    }
  }

  if (uniqueEvents.length === 0) {
    return { processed: 0, errors: ['All events were filtered out as invalid or duplicates'] }
  }

  // Check for existing events already stored for this user, scoped through the
  // schema-compat identity column, then dedup by (domain, timestamp).
  const batchTimestamps = uniqueEvents.map(e => e.timestamp)
  let existingQuery = supabase
    .from('events_raw')
    .select('domain, timestamp')
    .in('timestamp', batchTimestamps)
  const { query: scopedExistingQuery } = await applyEventsUserEq(
    supabase,
    existingQuery,
    userId
  )
  const { data: existingEvents } = await scopedExistingQuery

  const existingEventKeys = new Set(
    (existingEvents || []).map(event => `${event.domain}-${event.timestamp}`)
  )

  const finalEvents = uniqueEvents.filter(event => {
    const key = `${event.domain}-${event.timestamp}`
    return !existingEventKeys.has(key)
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

  console.log(`[Extension Sync] Successfully inserted ${data.length} events (from ${events.length} submitted)`)
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
    if (isNaN(userIdNum) || userIdNum <= 0) {
      return NextResponse.json({
        success: false,
        error: 'Invalid user ID'
      }, { status: 400 })
    }

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
    const todayScore = todayStats?.reduce((sum, event) => sum + (event.active_ms || 0) * 0.001 + (event.visits || 0) * 50, 0) || 0
    const totalScore = totalStats?.reduce((sum, event) => sum + (event.active_ms || 0) * 0.001 + (event.visits || 0) * 50, 0) || 0

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
//
// Two paths:
// 1. Ingestion: the device UUID is already registered and active. Events are
//    attributed to the user the device is bound to in the database — the
//    client-supplied userId is never trusted for attribution.
// 2. Registration / re-binding: the device is unknown, inactive, or claimed
//    for a different user. This requires a valid dashboard session cookie and
//    the device is always bound to the SESSION user, so nobody can attach
//    devices (or events) to another person's account.
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
    const { deviceUuid, userId: claimedUserId, events } = parsed.data
    const batchId = parsed.data.batchId

    // Look up the current device binding
    const { data: device } = await supabase
      .from('user_devices')
      .select('user_id, is_active')
      .eq('device_uuid', deviceUuid)
      .maybeSingle()

    const deviceMatchesClaim =
      !!device && (!claimedUserId || Number(device.user_id) === claimedUserId)

    let finalUserId: number

    if (device && device.is_active && deviceMatchesClaim) {
      // Path 1: ingestion for an already-registered, active device.
      finalUserId = Number(device.user_id)
    } else {
      // Path 2: registration / re-activation / re-binding — session required.
      const session = await getSessionUserId(request)
      if (!session.ok) {
        return NextResponse.json({
          success: false,
          error: 'Device not registered. Sign in on the dashboard to link this device.'
        }, { status: 401 })
      }

      // The session decides ownership; a mismatched claim is rejected outright.
      if (claimedUserId && claimedUserId !== session.userId) {
        return NextResponse.json({
          success: false,
          error: 'User mismatch: you can only link devices to your own account.'
        }, { status: 403 })
      }

      // Never let one account take over a device that is actively bound to a
      // different account. The rightful owner must deactivate it first.
      if (device && device.is_active && Number(device.user_id) !== session.userId) {
        return NextResponse.json({
          success: false,
          error: 'This device is already linked to another account.'
        }, { status: 409 })
      }

      finalUserId = session.userId

      const userAgent = request.headers.get('user-agent') || ''
      const registered = await registerDevice(finalUserId, deviceUuid, parseUserAgent(userAgent))
      if (!registered) {
        console.error(`[Extension Sync] Device registration failed for ${deviceUuid.slice(0, 8)}...`)
        return NextResponse.json({
          success: false,
          error: 'Device registration failed'
        }, { status: 500 })
      }
    }

    // Final gate: device must be active and bound to the resolved user
    const isValidDevice = await validateDevice(finalUserId, deviceUuid)
    if (!isValidDevice) {
      return NextResponse.json({
        success: false,
        error: 'Device not active for this user'
      }, { status: 403 })
    }

    // Process events
    const result = await processEvents(finalUserId, deviceUuid, events)

    // Update device last sync time
    await supabase
      .from('user_devices')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('device_uuid', deviceUuid)

    // Recalculate scores with the same policy the dashboard uses, so the
    // leaderboard (user_scores) and dashboard (/api/user/me) stay consistent.
    if (result.processed > 0) {
      const { scoresStale } = await recalculateUserScore(supabase, finalUserId)
      if (scoresStale) {
        console.error(`[Extension Sync] Score recalculation failed for user ${finalUserId}`)
      }
    }

    // Update user's last sync time
    await supabase
      .from('users')
      .update({ last_extension_sync: new Date().toISOString() })
      .eq('id', finalUserId)

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

// DELETE - Unregister device (session-authenticated, owner only)
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ success: false, error: session.error }, { status: session.status })
    }

    const deviceUuid = request.headers.get('X-Extension-Device-UUID')

    if (!deviceUuid) {
      return NextResponse.json({
        success: false,
        error: 'Missing device UUID'
      }, { status: 400 })
    }

    // Only the owner can deactivate their device
    const { data: device } = await supabase
      .from('user_devices')
      .select('user_id')
      .eq('device_uuid', deviceUuid)
      .maybeSingle()

    if (!device) {
      return NextResponse.json({ success: false, error: 'Device not found' }, { status: 404 })
    }
    if (Number(device.user_id) !== session.userId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase
      .from('user_devices')
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString()
      })
      .eq('device_uuid', deviceUuid)

    if (error) throw error

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('[Extension Sync] DELETE error:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 })
  }
}
