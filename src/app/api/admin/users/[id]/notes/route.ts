import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { ADMIN_NOTES_MAX, updateAdminNotes } from '@/lib/moderation'
import { assertCanTarget, cleanReason, getStaffUser, resolveStaffRole } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Internal staff notes on a user (users.admin_notes). Never rendered on
// any public surface — panel-only context for the next moderator.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'user.edit_notes')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const { id } = await params
  const targetId = Number(id)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  if (typeof body.notes !== 'string' || body.notes.length > ADMIN_NOTES_MAX) {
    return NextResponse.json(
      { error: `notes must be a string of at most ${ADMIN_NOTES_MAX} characters` },
      { status: 400 }
    )
  }
  const reason = cleanReason(body.reason)
  if (!reason) {
    return NextResponse.json(
      { error: 'A reason of at least 10 characters is required' },
      { status: 400 }
    )
  }

  try {
    const { data: target, error } = await supabase
      .from('users')
      .select('id, twitter_username, staff_role, is_admin, admin_notes')
      .eq('id', targetId)
      .maybeSingle()

    if (error) {
      console.error('[AdminNotes] Target lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load user' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const guard = assertCanTarget(staff.staff, Number(target.id), resolveStaffRole(target))
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const result = await updateAdminNotes(supabase, {
      actorId: staff.staff.userId,
      targetId: Number(target.id),
      notes: body.notes,
      currentNotes: typeof target.admin_notes === 'string' ? target.admin_notes : null,
      reason
    })

    return NextResponse.json({ success: true, notes: result.notes })
  } catch (err) {
    console.error('[AdminNotes] Action failed:', err)
    return NextResponse.json({ error: 'Failed to update notes' }, { status: 500 })
  }
}
