import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import { getPlate } from '@/lib/cosmetics/plates'
import { grantProEntitlement } from '@/lib/entitlementGrant'
import { houseGrantFor } from '@/lib/houseEntitlements'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import {
  assertCanTarget,
  cleanReason,
  getStaffUser,
  resolveStaffRole,
  type StaffAction
} from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Manual monetization actions — owner only. Pro grants reuse
// grantProEntitlement, the same fulfillment path as the Polar webhook;
// revokes mirror the webhook's subscription.revoked handler. Plate
// grants land in user_cosmetics as acquired_via='admin_grant' with no
// order id, so they are distinguishable from purchases forever.
//
// TEAM-tier targets are refused for the Pro actions: the team lifecycle
// belongs to the review queue (/api/admin/teams/[id]/review) and the
// Polar webhook, and a Pro grant/revoke here would silently desync
// subscription_tier from team_review_status.
//
// The no-self-target guardrail applies here too: the owner cannot grant
// their own account Pro or plates through the panel.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

type EntitlementAction = 'grant_pro' | 'revoke_pro' | 'grant_plate' | 'revoke_plate'

const ENTITLEMENT_ACTIONS: readonly EntitlementAction[] = [
  'grant_pro',
  'revoke_pro',
  'grant_plate',
  'revoke_plate'
]

function isEntitlementAction(value: unknown): value is EntitlementAction {
  return typeof value === 'string' && (ENTITLEMENT_ACTIONS as string[]).includes(value)
}

function staffActionFor(action: EntitlementAction): StaffAction {
  switch (action) {
    case 'grant_pro':
      return 'entitlement.grant_pro'
    case 'revoke_pro':
      return 'entitlement.revoke_pro'
    case 'grant_plate':
      return 'entitlement.grant_plate'
    case 'revoke_plate':
      return 'entitlement.revoke_plate'
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
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
  if (!isEntitlementAction(action)) {
    return NextResponse.json(
      { error: 'action must be grant_pro, revoke_pro, grant_plate or revoke_plate' },
      { status: 400 }
    )
  }

  const staff = await getStaffUser(request, staffActionFor(action))
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const { id } = await params
  const targetId = Number(id)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  const reason = cleanReason(body.reason)
  if (!reason) {
    return NextResponse.json(
      { error: 'A reason of at least 10 characters is required' },
      { status: 400 }
    )
  }

  const needsPlate = action === 'grant_plate' || action === 'revoke_plate'
  const plateId = needsPlate && typeof body.plateId === 'string' ? body.plateId.trim() : null
  if (needsPlate && (!plateId || !getPlate(plateId))) {
    return NextResponse.json({ error: 'Unknown plate' }, { status: 400 })
  }

  try {
    const { data: target, error } = await supabase
      .from('users')
      .select('id, twitter_username, staff_role, is_admin, subscription_tier')
      .eq('id', targetId)
      .maybeSingle()

    if (error) {
      console.error('[AdminEntitlements] Target lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load user' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const guard = assertCanTarget(staff.staff, Number(target.id), resolveStaffRole(target))
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const currentTier = (target.subscription_tier || 'FREE').toUpperCase()
    const actorId = staff.staff.userId

    // Pro actions must not touch a paying team: grant_pro would
    // overwrite TEAM→PRO while team_review_status stays behind, and
    // revoke_pro would FREE the row out from under the review state
    // machine. The team tier is only ever reverted by the review
    // queue's reject or the Polar webhook.
    if (currentTier === 'TEAM' && (action === 'grant_pro' || action === 'revoke_pro')) {
      return NextResponse.json(
        { error: 'This account is on the Team plan — manage it from the team review queue' },
        { status: 400 }
      )
    }

    if (action === 'revoke_pro' && houseGrantFor(target) === 'PRO') {
      return NextResponse.json(
        { error: 'House complimentary Pro cannot be revoked' },
        { status: 400 }
      )
    }

    switch (action) {
      case 'grant_pro':
        await withAudit(
          supabase,
          {
            adminUserId: actorId,
            targetUserId: targetId,
            action: 'entitlement.grant_pro',
            oldValues: { subscription_tier: currentTier },
            newValues: { subscription_tier: 'PRO' },
            reason
          },
          () => grantProEntitlement(supabase, targetId)
        )
        break

      case 'revoke_pro':
        await withAudit(
          supabase,
          {
            adminUserId: actorId,
            targetUserId: targetId,
            action: 'entitlement.revoke_pro',
            oldValues: { subscription_tier: currentTier },
            newValues: { subscription_tier: 'FREE' },
            reason
          },
          async () => {
            const { error: updateError } = await supabase
              .from('users')
              .update({ subscription_tier: 'FREE' })
              .eq('id', targetId)
            if (updateError) {
              throw new Error(
                `Failed to set subscription_tier=FREE for user ${targetId}: ${updateError.message}`
              )
            }
          }
        )
        break

      case 'grant_plate':
        await withAudit(
          supabase,
          {
            adminUserId: actorId,
            targetUserId: targetId,
            action: 'entitlement.grant_plate',
            oldValues: null,
            newValues: { plate: plateId, acquired_via: 'admin_grant' },
            reason
          },
          async () => {
            const { error: upsertError } = await supabase.from('user_cosmetics').upsert(
              {
                user_id: targetId,
                item_type: 'plate',
                item_id: plateId!,
                acquired_via: 'admin_grant',
                source_order_id: null
              },
              { onConflict: 'user_id,item_type,item_id' }
            )
            if (upsertError) {
              throw new Error(
                `Failed to grant plate ${plateId} to user ${targetId}: ${upsertError.message}`
              )
            }
          }
        )
        break

      case 'revoke_plate': {
        // Snapshot the row first so the audit entry records how the plate
        // had been acquired (purchase order id, grant, etc.).
        const { data: existing } = await supabase
          .from('user_cosmetics')
          .select('item_id, acquired_via, source_order_id, created_at')
          .eq('user_id', targetId)
          .eq('item_type', 'plate')
          .eq('item_id', plateId!)
          .maybeSingle()

        if (!existing) {
          return NextResponse.json({ error: 'User does not own this plate' }, { status: 404 })
        }

        await withAudit(
          supabase,
          {
            adminUserId: actorId,
            targetUserId: targetId,
            action: 'entitlement.revoke_plate',
            oldValues: existing as Record<string, unknown>,
            newValues: null,
            reason
          },
          async () => {
            const { error: deleteError } = await supabase
              .from('user_cosmetics')
              .delete()
              .eq('user_id', targetId)
              .eq('item_type', 'plate')
              .eq('item_id', plateId!)
            if (deleteError) {
              throw new Error(
                `Failed to revoke plate ${plateId} from user ${targetId}: ${deleteError.message}`
              )
            }
          }
        )
        break
      }

      default: {
        const exhaustive: never = action
        return exhaustive
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[AdminEntitlements] Action failed:', err)
    return NextResponse.json({ error: 'Failed to apply entitlement change' }, { status: 500 })
  }
}
