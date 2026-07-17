import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { clearProfileFields, isModeratableField, type ModeratableField } from '@/lib/moderation'
import { assertCanTarget, cleanReason, getStaffUser, resolveStaffRole } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Wipe offensive profile content: bio, location, website, banner and/or
// social links. The removed values are preserved in the audit row, so a
// bogus takedown is always reviewable (and reversible by hand).

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

  const staff = await getStaffUser(request, 'user.moderate_content')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const { id } = await params
  const targetId = Number(id)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const rawFields: unknown[] = Array.isArray(body.fields) ? body.fields : []
  const fields = Array.from(new Set(rawFields.filter(isModeratableField))) as ModeratableField[]
  if (fields.length === 0) {
    return NextResponse.json(
      { error: 'fields must include at least one of bio, location, website, banner, socials' },
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
      .select('id, twitter_username, staff_role, is_admin, metadata')
      .eq('id', targetId)
      .maybeSingle()

    if (error) {
      console.error('[AdminModerate] Target lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load user' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const guard = assertCanTarget(staff.staff, Number(target.id), resolveStaffRole(target))
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const currentMeta =
      target.metadata && typeof target.metadata === 'object'
        ? (target.metadata as Record<string, unknown>)
        : {}

    const result = await clearProfileFields(supabase, {
      actorId: staff.staff.userId,
      targetId: Number(target.id),
      fields,
      currentMeta,
      reason
    })

    return NextResponse.json({ success: true, cleared: result.cleared })
  } catch (err) {
    console.error('[AdminModerate] Action failed:', err)
    return NextResponse.json({ error: 'Failed to clear profile content' }, { status: 500 })
  }
}
