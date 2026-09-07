import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import { setUserStatus } from '@/lib/moderation'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import {
  assertCanTarget,
  cleanReason,
  getStaffUser,
  resolveStaffRole
} from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Fraud flag triage decision — any staff (abuse.review is a moderator-floor
// review action; assertCanTarget still keeps staff-owned accounts out of
// reach). Mirrors the team-review route's rate limit, target guard and
// audit-first pattern:
//   confirm — mark the flag 'confirmed'. Optionally suspend the account in
//             the same request (suspend:true), which hides them from the
//             board via the existing moderation path (its own audit row).
//   dismiss — mark the flag 'dismissed' (a false positive / accepted).
// Both require a written reason that lands in the audit log, and both are
// guarded on the 'open' status we read, so a concurrent decision can never be
// silently overwritten. Resolving does NOT delete the flag: the signal
// snapshot stays for the audit trail, and the dedupe key stops the sweep from
// resurrecting a decided flag.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

type ReviewAction = 'confirm' | 'dismiss'

function isReviewAction(value: unknown): value is ReviewAction {
  return value === 'confirm' || value === 'dismiss'
}

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

  const body = await request.json().catch(() => ({}))
  const action: unknown = body.action
  if (!isReviewAction(action)) {
    return NextResponse.json(
      { error: 'action must be confirm or dismiss' },
      { status: 400 }
    )
  }
  const suspend = action === 'confirm' && body.suspend === true

  const staff = await getStaffUser(request, 'abuse.review')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const { id } = await params
  const flagId = Number(id)
  if (!Number.isInteger(flagId) || flagId <= 0) {
    return NextResponse.json({ error: 'Invalid flag id' }, { status: 400 })
  }

  // Every triage decision carries a written reason into the audit log.
  const reason = cleanReason(body.reason)
  if (!reason) {
    return NextResponse.json(
      { error: 'A reason of at least 10 characters is required' },
      { status: 400 }
    )
  }

  try {
    const { data: flag, error: flagError } = await supabase
      .from('fraud_flags')
      .select('id, user_id, category, status, level, risk_score')
      .eq('id', flagId)
      .maybeSingle()

    if (flagError) {
      console.error('[AdminAbuseReview] Flag lookup failed:', flagError)
      return NextResponse.json({ error: 'Failed to load flag' }, { status: 500 })
    }
    if (!flag) {
      return NextResponse.json({ error: 'Flag not found' }, { status: 404 })
    }
    if (flag.status !== 'open') {
      return NextResponse.json(
        { error: `Flag is already ${flag.status}` },
        { status: 400 }
      )
    }

    const targetId = Number(flag.user_id)

    // Load the flagged account for the target guard (and its status, needed
    // if we also suspend). resolveStaffRole keeps staff-owned accounts safe.
    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('id, staff_role, is_admin, twitter_username, status')
      .eq('id', targetId)
      .maybeSingle()

    if (targetError) {
      console.error('[AdminAbuseReview] Target lookup failed:', targetError)
      return NextResponse.json({ error: 'Failed to load user' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'Flagged user not found' }, { status: 404 })
    }

    const guard = assertCanTarget(staff.staff, targetId, resolveStaffRole(target))
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const nextStatus = action === 'confirm' ? 'confirmed' : 'dismissed'
    const resolvedAt = new Date().toISOString()
    const actorId = staff.staff.userId

    await withAudit(
      supabase,
      {
        adminUserId: actorId,
        targetUserId: targetId,
        action: `fraud.${action}`,
        oldValues: { flag_id: flagId, status: flag.status },
        newValues: {
          flag_id: flagId,
          status: nextStatus,
          category: flag.category,
          level: flag.level,
          risk_score: Number(flag.risk_score)
        },
        reason
      },
      async () => {
        // Guarded on the status we based the decision on: if another staff
        // session (or a concurrent action) moved it, zero rows update and the
        // action fails instead of stomping a fresher decision.
        const { data: updated, error: updateError } = await supabase
          .from('fraud_flags')
          .update({
            status: nextStatus,
            resolved_by: actorId,
            resolved_at: resolvedAt,
            resolution_reason: reason,
            updated_at: resolvedAt
          })
          .eq('id', flagId)
          .eq('status', 'open')
          .select('id')
        if (updateError) {
          throw new Error(`Failed to ${action} flag ${flagId}: ${updateError.message}`)
        }
        if (!updated || updated.length === 0) {
          throw new Error(`Flag ${flagId} changed concurrently; ${action} aborted`)
        }
      }
    )

    // Optional enforcement: suspending hides the account from the board and
    // user search while keeping the decision reversible. Runs through the
    // shared moderation path (its own audit row), and only when the account
    // is still active so a re-run can't clobber a harsher existing status.
    let suspended = false
    if (suspend && (target.status ?? 'active') === 'active') {
      await setUserStatus(supabase, {
        actorId,
        targetId,
        action: 'suspend',
        currentStatus: target.status ?? 'active',
        reason
      })
      suspended = true
    }

    return NextResponse.json({
      success: true,
      status: nextStatus,
      suspended
    })
  } catch (err) {
    console.error('[AdminAbuseReview] Action failed:', err)
    return NextResponse.json({ error: 'Failed to apply review decision' }, { status: 500 })
  }
}
