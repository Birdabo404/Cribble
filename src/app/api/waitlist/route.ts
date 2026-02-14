import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Check if environment variables are configured
const isConfigured = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return url && key && !url.includes('placeholder') && url !== 'undefined'
}

// Simple in-memory rate limiting (for immediate fix)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT = 3 // Max 3 signups per IP per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000 // 1 hour in ms

// Simple email validation
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email) && 
         email.length <= 254 && 
         !email.includes('..') &&
         !email.startsWith('.') &&
         !email.endsWith('.')
}

const DISPOSABLE_DOMAINS = [
  '10minutemail.com', 'guerrillamail.com', 'tempmail.org', 'mailinator.com',
  'throwaway.email', 'temp-mail.org', 'mohmal.com', 'sharklasers.com',
  'yopmail.com', 'maildrop.cc', 'trashmail.com', 'getnada.com'
]

function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return DISPOSABLE_DOMAINS.includes(domain) || domain?.includes('temp') || domain?.includes('trash')
}

// Block suspicious user agents (bots, scripts, etc.)
function isSuspiciousUserAgent(userAgent: string): boolean {
  const suspiciousPatterns = [
    'python-requests',
    'curl/',
    'wget/',
    'axios/',
    'node-fetch',
    'postmanruntime',
    'insomnia',
    'httpie',
    'bot',
    'crawler',
    'spider',
    'scraper'
  ]
  
  const lowerAgent = userAgent.toLowerCase()
  return suspiciousPatterns.some(pattern => lowerAgent.includes(pattern))
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // If not configured, return mock success
    if (!isConfigured()) {
      console.log('🔧 Database not configured, simulating waitlist signup for:', email)
      return NextResponse.json(
        { 
          message: 'Successfully added to waitlist (DEMO MODE)', 
          data: { email, demo_mode: true }
        },
        { status: 201 }
      )
    }

    // Get IP address for rate limiting
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown'

    // Rate limiting check
    const now = Date.now()
    const rateLimitData = rateLimitMap.get(ip)
    
    if (rateLimitData) {
      if (now < rateLimitData.resetTime) {
        if (rateLimitData.count >= RATE_LIMIT) {
          return NextResponse.json(
            { error: 'Too many requests. Please try again later.' },
            { status: 429 }
          )
        }
        rateLimitData.count++
      } else {
        rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
      }
    } else {
      rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    }

    // Block suspicious user agents (scripts, bots, etc.)
    const userAgent = request.headers.get('user-agent') || 'unknown'
    if (isSuspiciousUserAgent(userAgent)) {
      return NextResponse.json(
        { error: 'Automated requests are not allowed' },
        { status: 403 }
      )
    }

    // Enhanced email validation
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      )
    }

    // Block disposable emails
    if (isDisposableEmail(email)) {
      return NextResponse.json(
        { error: 'Disposable email addresses are not allowed' },
        { status: 400 }
      )
    }

    // Check if IP already registered an email today
    const today = new Date().toISOString().split('T')[0]
    const { data: existingIpEntry, error: ipCheckError } = await supabase
      .from('waitlist')
      .select('*')
      .eq('ip_address', ip)
      .gte('created_at', today)
      .limit(1)

    if (existingIpEntry && existingIpEntry.length > 0) {
      return NextResponse.json(
        { error: 'Only one signup per IP address allowed per day' },
        { status: 429 }
      )
    }

    // Insert email into waitlist with IP tracking
    const { data, error } = await supabase
      .from('waitlist')
      .insert([{ 
        email, 
        ip_address: ip,
        user_agent: userAgent
      }])
      .select()

    if (error) {
      // Handle duplicate email
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Email already registered' },
          { status: 409 }
        )
      }
      
      console.error('Supabase error:', error)
      return NextResponse.json(
        { error: 'Failed to add email to waitlist' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'Successfully added to waitlist', data },
      { status: 201 }
    )
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    // If not configured, return mock count
    if (!isConfigured()) {
      console.log('🔧 Database not configured, returning mock waitlist count')
      return NextResponse.json({ count: 42 })
    }

    // Get waitlist count
    const { count, error } = await supabase
      .from('waitlist')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json(
        { error: 'Failed to get waitlist count' },
        { status: 500 }
      )
    }

    return NextResponse.json({ count })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 