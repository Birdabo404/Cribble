import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, rateLimitConfigs } from '@/lib/rateLimit'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  isAnalyticsDbConfigured,
  isLikelyBot,
  isTrackingDeclined,
  requestIp,
  visitorHash
} from '@/lib/siteVisits'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

function noContent(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' }
  })
}

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(request, rateLimitConfigs.visitorHit)
  if (!limit.success) return noContent()

  if (isTrackingDeclined(request.headers)) return noContent()

  const userAgent = request.headers.get('user-agent') ?? ''
  if (isLikelyBot(userAgent)) return noContent()

  if (!isAnalyticsDbConfigured()) return noContent()

  const hash = visitorHash(requestIp(request), userAgent)

  try {
    const { error } = await supabase.rpc('touch_site_visit', {
      p_visitor_hash: hash
    })
    if (error) {
      console.error('[SiteVisits] Heartbeat failed:', error)
    }
  } catch (err) {
    console.error('[SiteVisits] Heartbeat failed:', err)
  }

  return noContent()
}
