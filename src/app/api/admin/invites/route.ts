import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { generateInviteCode } from '@/lib/inviteCodes'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    // Owner-only: invite codes create accounts. Runs through
    // resolveStaffRole, so an explicit staff_role='moderator' can't be
    // overridden by a stale is_admin flag or the env allowlist.
    const staff = await getStaffUser(request, 'invite.manage')
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status })
    }

    const { data: invites, error } = await supabase
      .from('invite_codes')
      .select(
        `id, code, note, max_uses, use_count, expires_at, revoked_at, created_at,
         invite_redemptions ( user_id, redeemed_at, users ( twitter_username ) )`
      )
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to list invites:', error)
      return NextResponse.json({ error: 'Failed to list invites' }, { status: 500 })
    }

    return NextResponse.json({ invites: invites ?? [] })
  } catch (error) {
    console.error('Admin invites GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const staff = await getStaffUser(request, 'invite.manage')
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status })
    }

    const body = await request.json().catch(() => ({}))
    const maxUses = Number.isInteger(body.maxUses) && body.maxUses > 0 && body.maxUses <= 1000
      ? body.maxUses
      : 1
    const expiresInDays = Number.isFinite(body.expiresInDays) && body.expiresInDays > 0
      ? Math.min(body.expiresInDays, 365)
      : null
    const note = cleanReason(body.note)
    if (!note) {
      return NextResponse.json(
        { error: 'A recipient/reason of at least 10 characters is required' },
        { status: 400 }
      )
    }

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null

    // Retry on the (unlikely) code collision.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateInviteCode()
      // Migration 020 inserts the invite and its audit row in one
      // transaction. Neither can exist without the other.
      const { data, error } = await supabase.rpc('create_staff_invite', {
        p_admin_user_id: staff.staff.userId,
        p_code: code,
        p_note: note,
        p_max_uses: maxUses,
        p_expires_at: expiresAt
      })
      const invite = Array.isArray(data) ? data[0] : data

      if (!error && invite) {
        return NextResponse.json({ invite }, { status: 201 })
      }
      if (!error) {
        console.error('Failed to create invite: RPC returned no row')
        return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 })
      }
      if (error.code !== '23505') {
        console.error('Failed to create invite:', error)
        return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Failed to generate a unique code' }, { status: 500 })
  } catch (error) {
    console.error('Admin invites POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
