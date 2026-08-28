import type { SupabaseClient } from '@supabase/supabase-js'
import { withAudit } from '@/lib/adminAudit'
import {
  BILLBOARD_PAYMENT_X_HANDLE,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  isRailSlot,
  RAIL_SLOT_PRICE_CENTS,
  type BillboardPlacement,
  type RailSlot
} from '@/lib/billboard'
import { insertMissingNotifications } from '@/lib/notifications'
import { isSponsorshipEmailConfigured, sendSponsorshipPaymentEmail } from '@/lib/sponsorshipEmail'

// The billboard APPROVE decision, extracted verbatim from the single
// review route (app/api/admin/billboard/[id]/review) so the batch
// endpoint can apply the identical transition per ad without forking
// the logic: status-guarded PENDING/CHANGES_REQUESTED -> APPROVED under
// withAudit, best-effort payment email for non-leaderboard placements,
// best-effort buyer notification keyed on the decision timestamp.
// Errors come back as structured { httpStatus, error } results — the
// single route maps them 1:1 onto its existing response contract, and
// the batch route records them per ad without aborting the rest.

export type BillboardApproveEmailStatus = 'sent' | 'failed' | 'skipped'

export type BillboardApproveResult =
  | { ok: true; status: 'APPROVED'; emailStatus: BillboardApproveEmailStatus }
  | { ok: false; httpStatus: number; error: string }

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

/**
 * Approve one billboard ad as staff member `actorId`, with an optional
 * written reason for the audit log. The caller owns request-level
 * concerns (rate limit, staff gate, ad-id validation); this owns the
 * decision itself. Never throws — every failure maps to a structured
 * result the routes translate into their responses.
 */
export async function approveBillboardAd(
  supabase: SupabaseClient,
  adId: number,
  actorId: number,
  reason: string | null
): Promise<BillboardApproveResult> {
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
      console.error('[BillboardReview] Ad lookup failed:', error)
      return { ok: false, httpStatus: 500, error: 'Failed to load ad' }
    }
    if (!ad) {
      return { ok: false, httpStatus: 404, error: 'Ad not found' }
    }

    const currentStatus = ad.status as string
    if (currentStatus !== 'PENDING' && currentStatus !== 'CHANGES_REQUESTED') {
      return {
        ok: false,
        httpStatus: 400,
        error: `Only pending or changes-requested ads can be approved — this ad is ${currentStatus}`
      }
    }

    const ownerUserId = ad.owner_user_id === null ? null : Number(ad.owner_user_id)
    const reviewedAt = new Date().toISOString()

    await withAudit(
      supabase,
      {
        adminUserId: actorId,
        targetUserId: ownerUserId,
        action: 'billboard_approve',
        oldValues: {
          ad_id: adId,
          status: currentStatus,
          review_note: ad.review_note ?? null,
          reviewed_at: ad.reviewed_at ?? null
        },
        newValues: {
          ad_id: adId,
          status: 'APPROVED',
          // Approval clears any stale redo note so the buyer page never
          // shows old feedback next to an APPROVED ad.
          review_note: null,
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
            status: 'APPROVED',
            review_note: null,
            reviewed_by: actorId,
            reviewed_at: reviewedAt,
            updated_at: reviewedAt
          })
          .eq('id', adId)
          .eq('status', currentStatus)
          .select('id')
        if (updateError) {
          throw new Error(
            `Failed to approve billboard ad ${adId}: ${updateError.message}`
          )
        }
        if (!updated || updated.length === 0) {
          throw new Error(
            `Billboard ad ${adId} changed concurrently; approve aborted`
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

    // Best-effort payment email — a pointer at the self-serve checkout
    // rather than the payment channel itself: it sends the buyer to the
    // "pay & go live" button on their sponsorship tracker. 'skipped'
    // means there was nothing to send (no billing_email on file, or the
    // email env is unset) — the in-app notification below carries the
    // same instruction regardless. The sender keys on ad id +
    // reviewed_at, so a retried approve can't double-deliver. A failure
    // never fails the approve — the admin queue reads emailStatus off
    // the response.
    // Leaderboard creatives never get this mail: their payment is
    // self-serve Polar bidding (migration 055), and approval just opens
    // the bid button.
    let emailStatus: BillboardApproveEmailStatus = 'skipped'
    if (placement !== 'leaderboard' && billingEmail && isSponsorshipEmailConfigured()) {
      const emailResult = await sendSponsorshipPaymentEmail({
        to: billingEmail,
        adId,
        reviewedAt,
        placement,
        priceLine
      })
      emailStatus = emailResult.ok ? 'sent' : 'failed'
      if (!emailResult.ok) {
        console.error('[BillboardReview] Payment email failed:', emailResult.error)
      }
    }

    // Best-effort: tell the buyer the outcome. Keyed on the decision
    // timestamp so a later re-review (after a resubmit) notifies again
    // while a double-submit cannot. External-sponsor ads have no account
    // to notify.
    if (ownerUserId !== null) {
      // Self-serve first: the pay button on the ad's row at /sponsorship
      // is the payment channel either way. Mention the email only when a
      // send actually went out (it points at the same button) — never
      // claim a mail that didn't land. X DM stays the backup channel.
      const paymentLine =
        emailStatus === 'sent'
          ? `To go live, pay ${priceLine} from the sponsorship page — the pay button on your ad's row (instructions were also emailed to ${billingEmail}). DM @${BILLBOARD_PAYMENT_X_HANDLE} on X as backup.`
          : `To go live, pay ${priceLine} from the sponsorship page — the pay button on your ad's row. DM @${BILLBOARD_PAYMENT_X_HANDLE} on X as backup.`
      // Leaderboard approval opens self-serve bidding (migration 055) —
      // no manual ask, no activation wait.
      await insertMissingNotifications(supabase, ownerUserId, [
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
              body: `Your sponsor ad passed review. ${paymentLine} Your ad activates automatically the moment payment completes.`,
              data: { kind: 'billboard_review', result: 'approved', adId },
              dedupeKey: `billboard_${adId}_approved_${reviewedAt}`
            }
      ])
    }

    return { ok: true, status: 'APPROVED', emailStatus }
  } catch (err) {
    console.error('[BillboardReview] Approve failed:', err)
    return { ok: false, httpStatus: 500, error: 'Failed to apply review decision' }
  }
}
