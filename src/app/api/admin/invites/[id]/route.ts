import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { createServiceClient } from '@/lib/supabaseServer'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

// Revoke an invite code (soft delete — keeps the redemption history).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params
    const inviteId = Number(id)
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      return NextResponse.json({ error: 'Invalid invite id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const reason = cleanReason(body.reason)
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason of at least 10 characters is required' },
        { status: 400 }
      )
    }

    // Migration 020 locks the invite row and commits revoke + audit in
    // one transaction. An audit failure rolls back the revocation.
    const { data, error } = await supabase.rpc('revoke_staff_invite', {
      p_admin_user_id: staff.staff.userId,
      p_invite_id: inviteId,
      p_reason: reason
    })
    const invite = Array.isArray(data) ? data[0] : data

    if (error) {
      console.error('Failed to revoke invite:', error)
      return NextResponse.json({ error: 'Failed to revoke invite' }, { status: 500 })
    }
    if (!invite) {
      return NextResponse.json({ error: 'Invite not found or already revoked' }, { status: 404 })
    }

    return NextResponse.json({ invite })
  } catch (error) {
    console.error('Admin invite DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
