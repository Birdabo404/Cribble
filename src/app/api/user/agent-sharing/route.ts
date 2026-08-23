import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()
const updateSchema = z.object({ enabled: z.boolean() }).strict()

function responseState(row: {
  leaderboard_enabled: boolean
  enabled_at: string | null
  updated_at: string
} | null) {
  return {
    enabled: row?.leaderboard_enabled === true,
    enabledAt: row?.enabled_at ?? null,
    updatedAt: row?.updated_at ?? null
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json(
        { success: false, error: session.error },
        { status: session.status }
      )
    }

    const { data, error } = await supabase
      .from('agent_usage_sharing')
      .select('leaderboard_enabled, enabled_at, updated_at')
      .eq('user_id', session.userId)
      .maybeSingle()

    if (error) {
      console.error('[AgentSharing] Read failed:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to load token sharing' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, ...responseState(data) })
  } catch (error) {
    console.error('[AgentSharing] GET error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.auth)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json(
        { success: false, error: session.error },
        { status: session.status }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('agent_usage_sharing')
      .upsert(
        {
          user_id: session.userId,
          leaderboard_enabled: parsed.data.enabled,
          consent_version: 2,
          enabled_at: parsed.data.enabled ? now : null,
          updated_at: now
        },
        { onConflict: 'user_id' }
      )
      .select('leaderboard_enabled, enabled_at, updated_at')
      .single()

    if (error || !data) {
      console.error('[AgentSharing] Update failed:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update token sharing' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, ...responseState(data) })
  } catch (error) {
    console.error('[AgentSharing] PUT error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
