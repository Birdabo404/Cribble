import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'

export interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Max requests per window
  skipSuccessfulRequests?: boolean
  skipFailedRequests?: boolean
}

interface RateLimitEntry {
  count: number
  resetTime: number
  firstRequest: number
}

export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  resetTime: number
  retryAfter?: number
}

// Process-local prefilter and fallback. Privileged staff requests also use
// the cross-instance Postgres counter in checkDistributedRateLimit.
const rateLimitStore = new Map<string, RateLimitEntry>()
const supabase = createServiceClient()

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  rateLimitStore.forEach((entry, key) => {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key)
    }
  })
}, 10 * 60 * 1000)

export function getRateLimitKey(request: NextRequest, identifier?: string): string {
  if (identifier) return identifier
  
  // Try to get real IP address
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ip = forwarded?.split(',')[0] || realIp || 'unknown'
  
  return `${ip}:${request.nextUrl.pathname}`
}

export function checkRateLimit(
  request: NextRequest, 
  config: RateLimitConfig,
  identifier?: string
): RateLimitResult {
  const key = getRateLimitKey(request, identifier)
  const now = Date.now()
  
  let entry = rateLimitStore.get(key)
  
  if (!entry || now > entry.resetTime) {
    // Create new entry or reset expired one
    entry = {
      count: 1,
      resetTime: now + config.windowMs,
      firstRequest: now
    }
    rateLimitStore.set(key, entry)
    
    return {
      success: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      resetTime: entry.resetTime
    }
  }
  
  if (entry.count >= config.maxRequests) {
    return {
      success: false,
      limit: config.maxRequests,
      remaining: 0,
      resetTime: entry.resetTime,
      retryAfter: Math.ceil((entry.resetTime - now) / 1000)
    }
  }
  
  entry.count++
  
  return {
    success: true,
    limit: config.maxRequests,
    remaining: config.maxRequests - entry.count,
    resetTime: entry.resetTime
  }
}

interface DistributedRateLimitRow {
  success: boolean
  remaining: number
  reset_at: string
}

/**
 * Atomic, cross-instance rate limit backed by Supabase Postgres
 * (migration 020). This is used after staff authentication and keyed by
 * staff user id + read/write scope, so neither IP rotation, route hopping,
 * nor serverless instance fan-out multiplies a stolen session's allowance.
 *
 * If the RPC is temporarily unavailable, retain the existing in-memory
 * limiter as a compatibility fallback. Staff actions already depend on
 * Supabase for authorization and mutation, so an outage cannot turn this
 * fallback into a useful database bypass.
 */
export async function checkDistributedRateLimit(
  request: NextRequest,
  config: RateLimitConfig,
  identifier?: string
): Promise<RateLimitResult> {
  const rawKey = identifier || getRateLimitKey(request)
  const rateKey = `v1:${createHash('sha256').update(rawKey).digest('hex')}`

  try {
    const { data, error } = await supabase.rpc('consume_staff_rate_limit', {
      p_key: rateKey,
      p_window_seconds: Math.max(1, Math.ceil(config.windowMs / 1000)),
      p_limit: config.maxRequests
    })

    if (error) {
      throw new Error(error.message)
    }

    const row = (Array.isArray(data) ? data[0] : data) as DistributedRateLimitRow | null
    const resetTime = row ? new Date(row.reset_at).getTime() : Number.NaN
    if (
      !row ||
      typeof row.success !== 'boolean' ||
      !Number.isFinite(row.remaining) ||
      !Number.isFinite(resetTime)
    ) {
      throw new Error('Invalid distributed rate-limit response')
    }

    return {
      success: row.success,
      limit: config.maxRequests,
      remaining: Math.max(0, Number(row.remaining)),
      resetTime,
      ...(row.success
        ? {}
        : { retryAfter: Math.max(1, Math.ceil((resetTime - Date.now()) / 1000)) })
    }
  } catch (error) {
    console.error('[RateLimit] Distributed limiter unavailable; using local fallback:', error)
    return checkRateLimit(request, config, `distributed-fallback:${rawKey}`)
  }
}

// Predefined rate limit configurations
export const rateLimitConfigs = {
  // Strict limits for auth/registration
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5 // 5 attempts per 15 minutes
  },
  
  // Moderate limits for general API usage
  api: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60 // 60 requests per minute
  },
  
  // Lenient limits for data ingestion
  ingestion: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 1000 // 1000 requests per minute
  },

  // Device verification polling (extension reconcile + setup wizard).
  // Must comfortably allow the extension's periodic reconcile without
  // permitting high-rate UUID enumeration.
  deviceVerify: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30 // 30 requests per minute
  },
  
  // Very strict for admin operations
  admin: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10 // 10 requests per minute
  }
}

export function createRateLimitResponse(result: RateLimitResult) {
  const headers = new Headers()
  headers.set('X-RateLimit-Limit', result.limit.toString())
  headers.set('X-RateLimit-Remaining', result.remaining.toString())
  headers.set('X-RateLimit-Reset', new Date(result.resetTime).toISOString())
  
  if (!result.success && result.retryAfter) {
    headers.set('Retry-After', result.retryAfter.toString())
  }
  
  return headers
} 