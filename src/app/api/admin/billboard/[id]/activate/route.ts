import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_MAX_LIVE,
  BILLBOARD_PAYMENT_X_HANDLE,
  BILLBOARD_PRICE_CENTS,
  isLiveAd,
  isRailSlot,
  RAIL_SLOT_PRICE_CENTS,
  RAIL_SLOTS,
  type BillboardPlacement,
  type RailSlot
} from '@/lib/billboard'
import { insertMissingNotifications } from '@/lib/notifications'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Billboard slot lifecycle — owner only, same structure as the review
// route (rate limit, staff gate, audit-first, guarded update):
//   activate — "mark paid + go live". APPROVED and not currently in a
//              live window; refuses when BILLBOARD_MAX_LIVE flipper ads
//              are already live (the cap lives here in app code per
//              migration 030, scoped to placement='flipper' since 035).
//              Rail ads instead require a `slot` in the body (one of
//              RAIL_SLOTS) and refuse 409 while that slot has a live
//              occupant — slot exclusivity is time-windowed, so per
//              migration 035 it too lives here rather than in a DB
//              constraint; the winning slot is stamped onto rail_slot.
//              Stamps paid_at (kept if already set — a renewal of an
//              expired window doesn't rewrite payment history),
//              starts_at = now, ends_at = now + 7 days. Billing is NOT
//              touched: payment happens manually over the approval
//              email thread (or X DM as backup) before this click.
//              Leaderboard-placement ads are refused outright: their
//              liveness derives from paid Polar bids (migration 055),
//              never from an admin-stamped window.
//   archive  — early takedown of a live/approved ad, any placement.
//              Requires a written reason (audit log only; review_note
//              stays the buyer-facing review feedback). Click stats
//              survive, per migration 030. For leaderboard creatives
//              this is the takedown lever: the board derivation drops
//              non-APPROVED creatives before ranking.
// The activate update is guarded on both the status and the starts_at we
// read, so two staff sessions activating at once can't double-stamp the
// window. The flipper count and the rail slot-occupancy check are
// read-then-write and technically racy, but this is a manually-worked
// owner queue, not a hot path.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

// The dollar figure tracks the product being activated: $200 flipper,
// or the activated slot's ladder price for rails (the slot is always
// known here — rail activation validated it before this runs).
function paymentReminderFor(placement: BillboardPlacement, slot: RailSlot | null): string {
  const cents =
    placement === 'rail' && slot ? RAIL_SLOT_PRICE_CENTS[slot] : BILLBOARD_PRICE_CENTS
  return `Going live does not touch billing — the $${
    cents / 100
  } is collected manually over the payment email thread (X DM @${BILLBOARD_PAYMENT_X_HANDLE} as backup) before marking paid.`
}

type ActivateAction = 'activate' | 'archive'

function isActivateAction(value: unknown): value is ActivateAction {
  return value === 'activate' || value === 'archive'
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
  if (!isActivateAction(action)) {
    return NextResponse.json(
      { error: 'action must be activate or archive' },
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

  // Takedowns always carry a written reason into the audit log;
  // activations may, but the queue's one-click activate sends none.
  const reason = cleanReason(body.reason)
  if (action === 'archive' && !reason) {
    return NextResponse.json(
      { error: 'A reason of at least 10 characters is required to archive' },
      { status: 400 }
    )
  }

  try {
    const { data: ad, error } = await supabase
      .from('billboard_ads')
      .select('id, owner_user_id, status, placement, rail_slot, paid_at, starts_at, ends_at')
      .eq('id', adId)
      .maybeSingle()

    if (error) {
      console.error('[AdminBillboardActivate] Ad lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load ad' }, { status: 500 })
    }
    if (!ad) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }

    if (ad.status !== 'APPROVED') {
      return NextResponse.json(
        {
          error: `Only approved ads can be ${
            action === 'activate' ? 'activated' : 'archived'
          } — this ad is ${ad.status}`
        },
        { status: 400 }
      )
    }

    const now = new Date()
    const actorId = staff.staff.userId
    const ownerUserId = ad.owner_user_id === null ? null : Number(ad.owner_user_id)

    switch (action) {
      case 'activate': {
        // Leaderboard creatives (migration 055) have no admin-stamped
        // window: payment is self-serve Polar bidding and liveness
        // derives from paid contributions, so "mark paid + go live" is
        // meaningless. Hard-refused here even though the queue never
        // offers the button — archive stays available as the takedown.
        if (ad.placement === 'leaderboard') {
          return NextResponse.json(
            {
              error:
                'Leaderboard creatives cannot be activated — they go live automatically from paid bids. Use archive to take one down.'
            },
            { status: 400 }
          )
        }

        if (isLiveAd(ad, now)) {
          return NextResponse.json(
            { error: 'Ad is already live — its current window has to end first' },
            { status: 400 }
          )
        }

        const nowIso = now.toISOString()
        const placement: BillboardPlacement =
          ad.placement === 'rail' ? 'rail' : 'flipper'

        // Per-product occupancy guard, enforced here in app code: the
        // 8-live flipper cap (migration 030) or rail slot exclusivity
        // (migration 035). Both are read-then-write in the same spirit —
        // see the file header on why that's acceptable here.
        let railSlot: RailSlot | null = null
        if (placement === 'rail') {
          // Rail activation assigns the slot the admin picked. Only this
          // staff-gated route ever writes rail_slot — buyers can't.
          const requestedSlot: unknown = body.slot
          if (!isRailSlot(requestedSlot)) {
            return NextResponse.json(
              { error: `Rail activation needs a slot — one of ${RAIL_SLOTS.join(', ')}` },
              { status: 400 }
            )
          }

          const { count: occupied, error: occupiedError } = await supabase
            .from('billboard_ads')
            .select('id', { count: 'exact', head: true })
            .eq('placement', 'rail')
            .eq('rail_slot', requestedSlot)
            .eq('status', 'APPROVED')
            .not('paid_at', 'is', null)
            .lte('starts_at', nowIso)
            .gte('ends_at', nowIso)
            .neq('id', adId)

          if (occupiedError || occupied === null) {
            console.error(
              '[AdminBillboardActivate] Slot occupancy check failed:',
              occupiedError
            )
            return NextResponse.json(
              { error: 'Failed to check slot occupancy' },
              { status: 500 }
            )
          }
          if (occupied > 0) {
            return NextResponse.json(
              {
                error: `Slot ${requestedSlot} has a live ad right now — pick a free slot or wait for its window to end.`
              },
              { status: 409 }
            )
          }
          railSlot = requestedSlot
        } else {
          // The 8-slot flipper cap, scoped to its own product since
          // migration 035.
          const { count, error: countError } = await supabase
            .from('billboard_ads')
            .select('id', { count: 'exact', head: true })
            .eq('placement', 'flipper')
            .eq('status', 'APPROVED')
            .not('paid_at', 'is', null)
            .lte('starts_at', nowIso)
            .gte('ends_at', nowIso)
            .neq('id', adId)

          if (countError || count === null) {
            console.error('[AdminBillboardActivate] Live count failed:', countError)
            return NextResponse.json(
              { error: 'Failed to count live ads' },
              { status: 500 }
            )
          }
          if (count >= BILLBOARD_MAX_LIVE) {
            return NextResponse.json(
              {
                error: `All ${BILLBOARD_MAX_LIVE} flipper slots are live right now — archive one or wait for a window to end.`
              },
              { status: 409 }
            )
          }
        }

        const startsAt = nowIso
        const endsAt = new Date(
          now.getTime() + BILLBOARD_DURATION_DAYS * 86_400_000
        ).toISOString()
        const paidAt = (ad.paid_at as string | null) ?? nowIso

        await withAudit(
          supabase,
          {
            adminUserId: actorId,
            targetUserId: ownerUserId,
            action: 'billboard_activate',
            oldValues: {
              ad_id: adId,
              status: 'APPROVED',
              placement,
              rail_slot: (ad.rail_slot as string | null) ?? null,
              paid_at: ad.paid_at ?? null,
              starts_at: ad.starts_at ?? null,
              ends_at: ad.ends_at ?? null
            },
            newValues: {
              ad_id: adId,
              status: 'APPROVED',
              placement,
              rail_slot: railSlot,
              paid_at: paidAt,
              starts_at: startsAt,
              ends_at: endsAt
            },
            reason
          },
          async () => {
            // Guarded on status AND the starts_at we read: a concurrent
            // activate (or archive) makes this match zero rows and abort
            // instead of double-stamping the window. rail_slot rides
            // along — the picked slot for rails, null (a no-op) for
            // flipper ads.
            let update = supabase
              .from('billboard_ads')
              .update({
                paid_at: paidAt,
                starts_at: startsAt,
                ends_at: endsAt,
                rail_slot: railSlot,
                updated_at: nowIso
              })
              .eq('id', adId)
              .eq('status', 'APPROVED')
            update =
              ad.starts_at === null
                ? update.is('starts_at', null)
                : update.eq('starts_at', ad.starts_at)
            const { data: updated, error: updateError } = await update.select('id')
            if (updateError) {
              throw new Error(
                `Failed to activate billboard ad ${adId}: ${updateError.message}`
              )
            }
            if (!updated || updated.length === 0) {
              throw new Error(
                `Billboard ad ${adId} changed concurrently; activate aborted`
              )
            }
          }
        )

        // Best-effort: tell the buyer their slot is running. Keyed on the
        // window start so a renewal notifies again while a double-submit
        // cannot. External-sponsor ads have no account to notify.
        if (ownerUserId !== null) {
          await insertMissingNotifications(supabase, ownerUserId, [
            {
              type: 'premium',
              title: 'SPONSORSHIP AD LIVE',
              body: `Your sponsor ad is LIVE for the next ${BILLBOARD_DURATION_DAYS} days.`,
              data: { kind: 'billboard_review', result: 'live', adId },
              dedupeKey: `billboard_${adId}_live_${startsAt}`
            }
          ])
        }

        return NextResponse.json({
          success: true,
          status: 'APPROVED',
          starts_at: startsAt,
          ends_at: endsAt,
          rail_slot: railSlot,
          paymentReminder: paymentReminderFor(placement, railSlot)
        })
      }

      case 'archive': {
        const nowIso = now.toISOString()

        await withAudit(
          supabase,
          {
            adminUserId: actorId,
            targetUserId: ownerUserId,
            action: 'billboard_archive',
            oldValues: {
              ad_id: adId,
              status: 'APPROVED',
              paid_at: ad.paid_at ?? null,
              starts_at: ad.starts_at ?? null,
              ends_at: ad.ends_at ?? null
            },
            newValues: { ad_id: adId, status: 'ARCHIVED' },
            reason
          },
          async () => {
            const { data: updated, error: updateError } = await supabase
              .from('billboard_ads')
              .update({ status: 'ARCHIVED', updated_at: nowIso })
              .eq('id', adId)
              .eq('status', 'APPROVED')
              .select('id')
            if (updateError) {
              throw new Error(
                `Failed to archive billboard ad ${adId}: ${updateError.message}`
              )
            }
            if (!updated || updated.length === 0) {
              throw new Error(
                `Billboard ad ${adId} changed concurrently; archive aborted`
              )
            }
          }
        )

        return NextResponse.json({ success: true, status: 'ARCHIVED' })
      }

      default: {
        const exhaustive: never = action
        return exhaustive
      }
    }
  } catch (err) {
    console.error('[AdminBillboardActivate] Action failed:', err)
    return NextResponse.json({ error: 'Failed to apply slot action' }, { status: 500 })
  }
}
