import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { isStatusAction, setUserStatus } from '@/lib/moderation'
import { assertCanTarget, cleanReason, getStaffUser, resolveStaffRole } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Ban / suspend / unban. Guardrails before anything happens: staff floor
// (moderator), no self-target, no staff target (owner may act on
// moderators), mandatory reason. A ban destroys every live session and
// the OAuth callbacks refuse new ones, so it takes effect immediately.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function POST(
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

  const staff = await getStaffUser(request, 'user.set_status')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const { id } = await params
  const targetId = Number(id)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  if (!isStatusAction(body.action)) {
    return NextResponse.json({ error: 'action must be ban, suspend or unban' }, { status: 400 })
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
      .select('id, twitter_username, staff_role, is_admin, status')
      .eq('id', targetId)
      .maybeSingle()

    if (error) {
      console.error('[AdminStatus] Target lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load user' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const guard = assertCanTarget(staff.staff, Number(target.id), resolveStaffRole(target))
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const result = await setUserStatus(supabase, {
      actorId: staff.staff.userId,
      targetId: Number(target.id),
      action: body.action,
      currentStatus: target.status ?? null,
      reason
    })

    return NextResponse.json({ success: true, status: result.status })
  } catch (err) {
    console.error('[AdminStatus] Action failed:', err)
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
  }
}
