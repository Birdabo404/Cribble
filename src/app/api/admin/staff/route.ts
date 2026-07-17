import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { cleanReason, getStaffUser, isBreakglassOwner, resolveStaffRole } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Staff management — owner only. The API can promote a regular user to
// moderator and demote a moderator back, and NOTHING else: owners are
// never created or removed here (that takes the ADMIN_USERNAMES env or
// direct DB access), so a compromised session can't escalate anyone to
// owner or dethrone the operator.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'staff.manage')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, twitter_username, twitter_name, twitter_profile_image, staff_role, is_admin, status')
      .or('staff_role.not.is.null,is_admin.eq.true')
      .order('id', { ascending: true })

    if (error) {
      console.error('[AdminStaff] List failed:', error)
      return NextResponse.json({ error: 'Failed to list staff' }, { status: 500 })
    }

    const staffList = (data || [])
      .map((row) => ({
        userId: Number(row.id),
        username: row.twitter_username,
        display_name: row.twitter_name || row.twitter_username || `User${row.id}`,
        profile_image: row.twitter_profile_image || null,
        staff_role: resolveStaffRole(row),
        status: row.status || 'active'
      }))
      .filter((row) => row.staff_role !== null)

    return NextResponse.json({ success: true, staff: staffList })
  } catch (err) {
    console.error('[AdminStaff] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'staff.manage')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const body = await request.json().catch(() => ({}))
  const targetId = Number(body.userId)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }
  if (body.action !== 'promote' && body.action !== 'demote') {
    return NextResponse.json({ error: 'action must be promote or demote' }, { status: 400 })
  }
  const reason = cleanReason(body.reason)
  if (!reason) {
    return NextResponse.json(
      { error: 'A reason of at least 10 characters is required' },
      { status: 400 }
    )
  }

  if (targetId === staff.staff.userId) {
    return NextResponse.json(
      { error: 'You cannot change your own role' },
      { status: 403 }
    )
  }

  try {
    const { data: target, error } = await supabase
      .from('users')
      .select('id, twitter_username, staff_role, is_admin, status')
      .eq('id', targetId)
      .maybeSingle()

    if (error) {
      console.error('[AdminStaff] Target lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load user' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const targetRole = resolveStaffRole(target)
    if (targetRole === 'owner') {
      return NextResponse.json(
        { error: 'Owner accounts cannot be changed through the panel' },
        { status: 403 }
      )
    }

    // Breakglass accounts (is_admin flag or ADMIN_USERNAMES allowlist)
    // resolve to owner unless an explicit staff_role overrides them, so
    // demoting one by clearing staff_role would silently restore owner
    // access. Refuse and send the operator to the env/DB, which is the
    // real source of truth for these accounts.
    if (isBreakglassOwner(target)) {
      return NextResponse.json(
        {
          error:
            'This account has breakglass owner access (is_admin or ADMIN_USERNAMES). Change it in the environment allowlist or database, not the panel.'
        },
        { status: 403 }
      )
    }

    if (body.action === 'promote') {
      if (targetRole === 'moderator') {
        return NextResponse.json({ error: 'User is already a moderator' }, { status: 400 })
      }
      if (target.status && target.status !== 'active') {
        return NextResponse.json(
          { error: 'Only active accounts can be promoted' },
          { status: 400 }
        )
      }
    } else if (targetRole !== 'moderator') {
      return NextResponse.json({ error: 'User is not a moderator' }, { status: 400 })
    }

    const nextRole = body.action === 'promote' ? 'moderator' : null

    await withAudit(
      supabase,
      {
        adminUserId: staff.staff.userId,
        targetUserId: targetId,
        action: `staff.${body.action}`,
        oldValues: { staff_role: targetRole },
        newValues: { staff_role: nextRole },
        reason
      },
      async () => {
        const { error: updateError } = await supabase
          .from('users')
          .update({ staff_role: nextRole })
          .eq('id', targetId)
        if (updateError) {
          throw new Error(
            `Failed to set staff_role=${nextRole} for user ${targetId}: ${updateError.message}`
          )
        }
      }
    )

    return NextResponse.json({ success: true, staff_role: nextRole })
  } catch (err) {
    console.error('[AdminStaff] Action failed:', err)
    return NextResponse.json({ error: 'Failed to update staff role' }, { status: 500 })
  }
}
