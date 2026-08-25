import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import {
  BILLBOARD_PAYMENT_EMAIL,
  BILLBOARD_PAYMENT_X_HANDLE,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  isRailSlot,
  RAIL_SLOT_PRICE_CENTS,
  type BillboardPlacement,
  type RailSlot
} from '@/lib/billboard'
import { insertMissingNotifications, type NotificationInput } from '@/lib/notifications'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { isSponsorshipEmailConfigured, sendSponsorshipPaymentEmail } from '@/lib/sponsorshipEmail'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Billboard review decision — owner only, copied structurally from the
// team-review route (rate limit, staff gate, audit-first, status-guarded
// update):
//   approve         — PENDING/CHANGES_REQUESTED -> APPROVED. Clears any
//                     stale redo note and best-effort emails the payment
//                     instructions to the ad's billing_email (migration
//                     040 — email-first, X DM as backup); the ad only
//                     goes live through the activate route. The response
//                     carries emailStatus ('sent' | 'failed' | 'skipped')
//                     so the admin queue knows whether to chase on X.
//   reject          — PENDING/CHANGES_REQUESTED -> REJECTED. Requires a
//                     written reason, stored in review_note so the buyer
//                     sees it at /sponsorship.
//   request_changes — PENDING -> CHANGES_REQUESTED. Requires a note
//                     (review_note); the buyer edits and resubmits.
// Every transition is guarded on the status we read, so a concurrent
// decision aborts instead of being silently overwritten. Unlike team
// review there is no assertCanTarget guard: the target is an ad, not a
// user account, and owner-seeded / external-sponsor ads (owner_user_id
// null or the operator's own) must stay reviewable. Ads without an
// owner_user_id skip buyer notifications entirely — the payment email is
// keyed on billing_email though, so an external-sponsor ad with one on
// file still gets it.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** Names the exact ask in the approval notification: the flipper's flat
 *  price, the requested slot's ladder price + code, or the ladder floor
 *  when the buyer left the slot open. */
function approvedPriceLine(
  placement: BillboardPlacement,
  requestedSlot: RailSlot | null
): string {
  if (placement !== 'rail') return `$${BILLBOARD_PRICE_CENTS / 100}/wk`
  if (requestedSlot) {
    return `$${RAIL_SLOT_PRICE_CENTS[requestedSlot] / 100}/wk · slot ${requestedSlot}`
  }
  return `from $${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}/wk`
}

type ReviewAction = 'approve' | 'reject' | 'request_changes'

function isReviewAction(value: unknown): value is ReviewAction {
  return value === 'approve' || value === 'reject' || value === 'request_changes'
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
      { error: 'action must be approve, reject or request_changes' },
      { status: 400 }
    )
  }

  const staff = await getStaffUser(request, 'billboard.review')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const { id } = await params
  const adId = Number(id)
  if (!Number.isInteger(adId) || adId <= 0) {
    return NextResponse.json({ error: 'Invalid ad id' }, { status: 400 })
  }

  // Rejections and redo requests always carry written feedback (it lands
  // in review_note AND the audit log); approvals may, but the queue's
  // one-click approve sends none.
  const reason = cleanReason(body.reason)
  if (action === 'reject' && !reason) {
    return NextResponse.json(
      { error: 'A reason of at least 10 characters is required to reject' },
      { status: 400 }
    )
  }
  if (action === 'request_changes' && !reason) {
    return NextResponse.json(
      { error: 'A note of at least 10 characters is required to request changes' },
      { status: 400 }
    )
  }

  try {
    // placement + requested_rail_slot ride along so the approval
    // notification and payment email can name the exact price (and
    // slot) being asked for; billing_email is where that email goes.
    const { data: ad, error } = await supabase
      .from('billboard_ads')
      .select(
        'id, owner_user_id, status, review_note, reviewed_at, placement, requested_rail_slot, billing_email'
      )
      .eq('id', adId)
      .maybeSingle()

    if (error) {
      console.error('[AdminBillboardReview] Ad lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load ad' }, { status: 500 })
    }
    if (!ad) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }

    const currentStatus = ad.status as string
    switch (action) {
      case 'approve':
      case 'reject':
        if (currentStatus !== 'PENDING' && currentStatus !== 'CHANGES_REQUESTED') {
          return NextResponse.json(
            {
              error: `Only pending or changes-requested ads can be ${
                action === 'approve' ? 'approved' : 'rejected'
              } — this ad is ${currentStatus}`
            },
            { status: 400 }
          )
        }
        break
      case 'request_changes':
        if (currentStatus !== 'PENDING') {
          return NextResponse.json(
            { error: `Changes can only be requested on a pending ad — this ad is ${currentStatus}` },
            { status: 400 }
          )
        }
        break
      default: {
        const exhaustive: never = action
        return exhaustive
      }
    }

    const actorId = staff.staff.userId
    const ownerUserId = ad.owner_user_id === null ? null : Number(ad.owner_user_id)
    const reviewedAt = new Date().toISOString()

    let nextStatus: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'
    let auditAction: string
    switch (action) {
      case 'approve':
        nextStatus = 'APPROVED'
        auditAction = 'billboard_approve'
        break
      case 'reject':
        nextStatus = 'REJECTED'
        auditAction = 'billboard_reject'
        break
      case 'request_changes':
        nextStatus = 'CHANGES_REQUESTED'
        auditAction = 'billboard_request_changes'
        break
      default: {
        const exhaustive: never = action
        return exhaustive
      }
    }

    // Approval clears any stale redo note so the buyer page never shows
    // old feedback next to an APPROVED ad; the other two surface it.
    const nextNote = action === 'approve' ? null : reason

    await withAudit(
      supabase,
      {
        adminUserId: actorId,
        targetUserId: ownerUserId,
        action: auditAction,
        oldValues: {
          ad_id: adId,
          status: currentStatus,
          review_note: ad.review_note ?? null,
          reviewed_at: ad.reviewed_at ?? null
        },
        newValues: {
          ad_id: adId,
          status: nextStatus,
          review_note: nextNote,
          reviewed_at: reviewedAt
        },
        reason
      },
      async () => {
        // Guarded on the status the decision was based on: if another
        // staff session (or a buyer resubmit) moved it meanwhile, zero
        // rows update and the action fails instead of stomping.
        const { data: updated, error: updateError } = await supabase
          .from('billboard_ads')
          .update({
            status: nextStatus,
            review_note: nextNote,
            reviewed_by: actorId,
            reviewed_at: reviewedAt,
            updated_at: reviewedAt
          })
          .eq('id', adId)
          .eq('status', currentStatus)
          .select('id')
        if (updateError) {
          throw new Error(
            `Failed to ${action} billboard ad ${adId}: ${updateError.message}`
          )
        }
        if (!updated || updated.length === 0) {
          throw new Error(
            `Billboard ad ${adId} changed concurrently; ${action} aborted`
          )
        }
      }
    )

    // The exact ask, shared by the payment email and the approval
    // notification below.
    const placement: BillboardPlacement =
      ad.placement === 'rail'
        ? 'rail'
        : ad.placement === 'leaderboard'
          ? 'leaderboard'
          : 'flipper'
    const requestedSlot: RailSlot | null = isRailSlot(ad.requested_rail_slot)
      ? ad.requested_rail_slot
      : null
    const priceLine = approvedPriceLine(placement, requestedSlot)
    const billingEmail =
      typeof ad.billing_email === 'string' && ad.billing_email ? ad.billing_email : null

    // Best-effort payment email — the primary channel since migration
    // 040. 'skipped' means there was nothing to send (no billing_email
    // on file, or the email env is unset) and ops chases over X DM
    // instead. The sender keys on ad id + reviewed_at, so a retried
    // approve can't double-deliver. A failure never fails the approve —
    // the admin queue reads emailStatus off the response and falls back
    // to X.
    // Leaderboard creatives never get the manual-payment ask: their
    // payment is self-serve Polar bidding (migration 055), and approval
    // just opens the bid button.
    let emailStatus: 'sent' | 'failed' | 'skipped' = 'skipped'
    if (
      action === 'approve' &&
      placement !== 'leaderboard' &&
      billingEmail &&
      isSponsorshipEmailConfigured()
    ) {
      const emailResult = await sendSponsorshipPaymentEmail({
        to: billingEmail,
        adId,
        reviewedAt,
        placement,
        priceLine
      })
      emailStatus = emailResult.ok ? 'sent' : 'failed'
      if (!emailResult.ok) {
        console.error('[AdminBillboardReview] Payment email failed:', emailResult.error)
      }
    }

    // Best-effort: tell the buyer the outcome. Keyed on the decision
    // timestamp so a later re-review (after a resubmit) notifies again
    // while a double-submit cannot. External-sponsor ads have no account
    // to notify.
    if (ownerUserId !== null) {
      let notification: NotificationInput & { dedupeKey: string }
      switch (action) {
        case 'approve': {
          // Email-first: point at the thread that actually closes the
          // deal when a send went out; otherwise (no billing_email, env
          // unset, provider failure) name the public billing address
          // instead of claiming an email that never landed. X DM stays
          // the backup channel either way.
          const paymentLine =
            emailStatus === 'sent'
              ? `Payment instructions (${priceLine}) were emailed to ${billingEmail} — reply there to complete payment, or DM @${BILLBOARD_PAYMENT_X_HANDLE} on X as backup.`
              : `To complete payment (${priceLine}), email ${BILLBOARD_PAYMENT_EMAIL} — or DM @${BILLBOARD_PAYMENT_X_HANDLE} on X as backup.`
          // Leaderboard approval opens self-serve bidding (migration
          // 055) — no manual ask, no activation wait.
          notification =
            placement === 'leaderboard'
              ? {
                  type: 'premium',
                  title: 'SPONSORSHIP AD APPROVED',
                  body: 'Your leaderboard sponsor creative passed review. Bidding is open — place a bid from the sponsorship page and your spot activates the moment payment completes.',
                  data: { kind: 'billboard_review', result: 'approved', adId },
                  dedupeKey: `billboard_${adId}_approved_${reviewedAt}`
                }
              : {
                  type: 'premium',
                  title: 'SPONSORSHIP AD APPROVED',
                  body: `Your sponsor ad passed review. ${paymentLine} Once it's confirmed, your ad is activated and goes live, usually within a few minutes to a few hours.`,
                  data: { kind: 'billboard_review', result: 'approved', adId },
                  dedupeKey: `billboard_${adId}_approved_${reviewedAt}`
                }
          break
        }
        case 'reject':
          notification = {
            type: 'premium',
            title: 'SPONSORSHIP AD REJECTED',
            body: `Your sponsor ad did not pass review: ${reason}`,
            data: { kind: 'billboard_review', result: 'rejected', adId },
            dedupeKey: `billboard_${adId}_rejected_${reviewedAt}`
          }
          break
        case 'request_changes':
          notification = {
            type: 'premium',
            title: 'SPONSORSHIP AD NEEDS CHANGES',
            body: `Requested changes: ${reason} — edit and resubmit your ad at /sponsorship.`,
            data: { kind: 'billboard_review', result: 'changes_requested', adId },
            dedupeKey: `billboard_${adId}_changes_${reviewedAt}`
          }
          break
        default: {
          const exhaustive: never = action
          return exhaustive
        }
      }
      await insertMissingNotifications(supabase, ownerUserId, [notification])
    }

    // emailStatus rides on every decision for a uniform shape; only an
    // approve can move it off 'skipped'.
    return NextResponse.json({ success: true, status: nextStatus, emailStatus })
  } catch (err) {
    console.error('[AdminBillboardReview] Action failed:', err)
    return NextResponse.json({ error: 'Failed to apply review decision' }, { status: 500 })
  }
}
