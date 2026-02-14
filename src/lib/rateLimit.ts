import { NextRequest } from 'next/server'

interface RateLimitConfig {
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

// In-memory store (use Redis in production for multi-instance deployments)
const rateLimitStore = new Map<string, RateLimitEntry>()

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
): { 
  success: boolean
  limit: number
  remaining: number
  resetTime: number
  retryAfter?: number
} {
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
  
  // Very strict for admin operations
  admin: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10 // 10 requests per minute
  }
}

export function createRateLimitResponse(result: ReturnType<typeof checkRateLimit>) {
  const headers = new Headers()
  headers.set('X-RateLimit-Limit', result.limit.toString())
  headers.set('X-RateLimit-Remaining', result.remaining.toString())
  headers.set('X-RateLimit-Reset', new Date(result.resetTime).toISOString())
  
  if (!result.success && result.retryAfter) {
    headers.set('Retry-After', result.retryAfter.toString())
  }
  
  return headers
} 