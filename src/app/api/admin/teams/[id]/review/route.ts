import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import { insertMissingNotifications } from '@/lib/notifications'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import {
  assertCanTarget,
  cleanReason,
  getStaffUser,
  resolveStaffRole
} from '@/lib/staffAuth'
import { houseGrantFor } from '@/lib/houseEntitlements'
import { createServiceClient } from '@/lib/supabaseServer'

// The anti-impersonation review decision — any staff (team.review sits
// at the moderator floor: it's review work and never touches billing;
// assertCanTarget still keeps staff accounts out of reach), mirroring
// the entitlements route's rate limit, target guard and audit-first
// pattern:
//   approve — team_review_status='approved' + team_approved_at=now().
//             This is the ONLY writer of team_approved_at. The team
//             account gets the gold-badge notification.
//   reject  — team_review_status='rejected' and the tier reverts to
//             FREE (guarded on TEAM, so a lapsed subscription is left
//             alone). Requires a written reason; approving again later
//             stays possible. Billing is NOT touched here — the caller
//             is reminded to cancel/refund the Polar subscription
//             manually.
// Both transitions are guarded on the status we read, so a concurrent
// decision (or the identity tripwire) can never be silently overwritten.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const REFUND_REMINDER =
  'Rejection does not touch billing — cancel and refund the Polar subscription manually.'

type ReviewAction = 'approve' | 'reject'

function isReviewAction(value: unknown): value is ReviewAction {
  return value === 'approve' || value === 'reject'
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
      { error: 'action must be approve or reject' },
      { status: 400 }
    )
  }

  const staff = await getStaffUser(request, 'team.review')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const { id } = await params
  const targetId = Number(id)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  // Rejections always carry a written reason into the audit log;
  // approvals may, but the queue's one-click approve sends none.
  const reason = cleanReason(body.reason)
  if (action === 'reject' && !reason) {
    return NextResponse.json(
      { error: 'A reason of at least 10 characters is required to reject' },
      { status: 400 }
    )
  }

  try {
    const { data: target, error } = await supabase
      .from('users')
      .select(
        `id, twitter_username, staff_role, is_admin, subscription_tier,
         team_review_status, team_approved_at`
      )
      .eq('id', targetId)
      .maybeSingle()

    if (error) {
      console.error('[AdminTeamReview] Target lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load user' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const guard = assertCanTarget(staff.staff, Number(target.id), resolveStaffRole(target))
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const currentStatus = target.team_review_status
    if (currentStatus !== 'pending' && currentStatus !== 'approved' && currentStatus !== 'rejected') {
      return NextResponse.json(
        { error: 'This account has never purchased a team plan' },
        { status: 400 }
      )
    }
    if (action === 'approve' && currentStatus === 'approved') {
      return NextResponse.json({ error: 'Team is already approved' }, { status: 400 })
    }
    if (action === 'reject' && currentStatus === 'rejected') {
      return NextResponse.json({ error: 'Team is already rejected' }, { status: 400 })
    }
    if (action === 'reject' && houseGrantFor(target) === 'TEAM') {
      return NextResponse.json(
        { error: 'House complimentary Team cannot be rejected' },
        { status: 400 }
      )
    }

    const currentTier = (target.subscription_tier || 'FREE').toUpperCase()
    const actorId = staff.staff.userId

    if (action === 'approve') {
      const approvedAt = new Date().toISOString()

      await withAudit(
        supabase,
        {
          adminUserId: actorId,
          targetUserId: targetId,
          action: 'team_approve',
          oldValues: {
            team_review_status: currentStatus,
            team_approved_at: target.team_approved_at ?? null
          },
          newValues: { team_review_status: 'approved', team_approved_at: approvedAt },
          reason
        },
        async () => {
          // Guarded on the status we based the decision on: if the
          // tripwire (or another staff session) moved it meanwhile,
          // zero rows update and the action fails instead of stomping.
          const { data: updated, error: updateError } = await supabase
            .from('users')
            .update({ team_review_status: 'approved', team_approved_at: approvedAt })
            .eq('id', targetId)
            .eq('team_review_status', currentStatus)
            .select('id')
          if (updateError) {
            throw new Error(
              `Failed to approve team for user ${targetId}: ${updateError.message}`
            )
          }
          if (!updated || updated.length === 0) {
            throw new Error(
              `Team review status changed concurrently for user ${targetId}; approve aborted`
            )
          }
        }
      )

      // Best-effort: tell the team their gold badge is live. Keyed on the
      // approval timestamp so a later re-approval (after a tripwire
      // re-review) notifies again while a double-submit cannot.
      await insertMissingNotifications(supabase, targetId, [
        {
          type: 'premium',
          title: 'TEAM VERIFIED — GOLD BADGE ACTIVE',
          body: 'Your team account passed review. The gold badge is live and your affiliate seats are open.',
          data: { kind: 'team_review', result: 'approved' },
          dedupeKey: `team_approved_${approvedAt}`
        }
      ])

      return NextResponse.json({ success: true, review_status: 'approved' })
    }

    // action === 'reject'
    await withAudit(
      supabase,
      {
        adminUserId: actorId,
        targetUserId: targetId,
        action: 'team_reject',
        oldValues: {
          team_review_status: currentStatus,
          subscription_tier: currentTier
        },
        newValues: { team_review_status: 'rejected', subscription_tier: 'FREE' },
        reason
      },
      async () => {
        const { data: updated, error: statusError } = await supabase
          .from('users')
          .update({ team_review_status: 'rejected' })
          .eq('id', targetId)
          .eq('team_review_status', currentStatus)
          .select('id')
        if (statusError) {
          throw new Error(
            `Failed to reject team for user ${targetId}: ${statusError.message}`
          )
        }
        if (!updated || updated.length === 0) {
          throw new Error(
            `Team review status changed concurrently for user ${targetId}; reject aborted`
          )
        }

        // Revert the tier only while it is still TEAM — a lapsed or
        // already-reverted subscription is left exactly as it is.
        const { error: tierError } = await supabase
          .from('users')
          .update({ subscription_tier: 'FREE' })
          .eq('id', targetId)
          .eq('subscription_tier', 'TEAM')
        if (tierError) {
          throw new Error(
            `Failed to revert tier to FREE for user ${targetId}: ${tierError.message}`
          )
        }
      }
    )

    return NextResponse.json({
      success: true,
      review_status: 'rejected',
      refundReminder: REFUND_REMINDER
    })
  } catch (err) {
    console.error('[AdminTeamReview] Action failed:', err)
    return NextResponse.json({ error: 'Failed to apply review decision' }, { status: 500 })
  }
}
