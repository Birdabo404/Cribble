import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlate } from '@/lib/cosmetics/plates'
import { insertMissingNotifications } from '@/lib/notifications'

// The single entry point for Pro fulfillment. Both delivery paths — the
// Polar webhook (production) and /api/user/subscription/sync (local dev,
// where webhooks can't reach localhost) — funnel through here so tier,
// premium_since and the welcome notification always land together.
// Idempotent by construction: every step is a no-op or an upsert on
// redelivery, so calling it on every webhook retry / every sync is safe.

export interface GrantProEntitlementOptions {
  /** Polar product id of the triggering subscription. Context only — the
   *  grant is identical for every Pro product. */
  productId?: string | null
  /** Polar subscription id of the triggering subscription. Context only. */
  sourceId?: string | null
}

/**
 * Flip a user to Pro and deliver everything that comes with it:
 *   - users.subscription_tier = 'PRO'
 *   - users.metadata.premium_since — set once, on the first grant only,
 *     so redeliveries never move the "Premium since" date. The metadata
 *     JSONB is read and merged (never replaced) to preserve keys like
 *     equipped_plate.
 *   - a deduped 'premium' blue-check notification (dedupe_key
 *     premium_welcome)
 */
export async function grantProEntitlement(
  supabase: SupabaseClient,
  userId: number,
  // Still passed by the webhook/sync callers for audit context and future
  // product-keyed grants; nothing branches on it since the founder promo
  // retired.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  opts: GrantProEntitlementOptions = {}
): Promise<void> {
  const { data: user, error: readError } = await supabase
    .from('users')
    .select('metadata')
    .eq('id', userId)
    .single()

  if (readError || !user) {
    throw new Error(
      `Failed to read user ${userId} for Pro grant: ${readError?.message ?? 'user not found'}`
    )
  }

  const metadata = (user.metadata ?? {}) as Record<string, unknown>
  const hasPremiumSince =
    typeof metadata.premium_since === 'string' && metadata.premium_since.length > 0

  // Only touch metadata when premium_since needs stamping — steady-state
  // regrants update the tier column alone.
  const update: Record<string, unknown> = { subscription_tier: 'PRO' }
  if (!hasPremiumSince) {
    update.metadata = { ...metadata, premium_since: new Date().toISOString() }
  }

  const { error: updateError } = await supabase.from('users').update(update).eq('id', userId)

  if (updateError) {
    throw new Error(
      `Failed to set subscription_tier=PRO for user ${userId}: ${updateError.message}`
    )
  }

  await insertMissingNotifications(supabase, userId, [
    {
      type: 'premium',
      title: 'YOUR BLUE CHECK IS HERE',
      body: 'It now shows next to your name on your profile, your player card and the leaderboard.',
      data: {},
      dedupeKey: 'premium_welcome'
    }
  ])
}

export interface GrantPlatePurchaseOptions {
  /** Catalog plate id resolved from the order/product metadata. */
  plateId: string
  /** Polar order id — the refund hook deletes by source_order_id. */
  orderId: string
}

/**
 * Deliver a PURCHASED plate. Both fulfillment paths — the order.paid
 * webhook and the pull-based order reconciliation in subscriptionSync —
 * funnel through here so the ownership row and the "delivered"
 * notification always land together. Champion/beta/founder gifts have
 * their own grant paths and never come through here.
 * Idempotent, first-acquisition-wins: ignoreDuplicates makes the upsert
 * insert nothing when a row already exists on the
 * (user_id, item_type, item_id) unique index, so a duplicate order can
 * never rewrite acquired_via/source_order_id — an admin/champion grant
 * can't be turned into a "purchase" that order.refunded would later
 * delete. The notification is deduped per order id. Throws on upsert
 * failure (webhook retries / sync surfaces the error); the notification
 * is best-effort — insertMissingNotifications never throws.
 */
export async function grantPlatePurchase(
  supabase: SupabaseClient,
  userId: number,
  { plateId, orderId }: GrantPlatePurchaseOptions
): Promise<void> {
  const { error } = await supabase.from('user_cosmetics').upsert(
    {
      user_id: userId,
      item_type: 'plate',
      item_id: plateId,
      acquired_via: 'purchase',
      source_order_id: orderId
    },
    { onConflict: 'user_id,item_type,item_id', ignoreDuplicates: true }
  )

  if (error) {
    throw new Error(`Failed to grant plate ${plateId} to user ${userId}: ${error.message}`)
  }

  const plateName = getPlate(plateId)?.name ?? plateId
  await insertMissingNotifications(supabase, userId, [
    {
      type: 'shop',
      title: 'DELIVERY COMPLETE',
      body: `Your ${plateName} plate has been delivered successfully. Thank you for purchasing.`,
      data: { kind: 'purchase_delivered', plateId, orderId },
      dedupeKey: `plate_delivered_${orderId}`
    }
  ])
}

/** The gift plate minted for invite-code beta testers. */
const BETA_TESTER_PLATE_ID = 'beta-tester'

/**
 * Gift the never-sold Beta Tester plate to invite-code signups, called
 * from POST /api/user/onboarding when the welcome page is completed.
 * Users without an invite_redemptions row (legacy pre-invite signups)
 * are skipped. Like the founder and champion grants the row is
 * permanent — never revoked, so early testers keep the plate forever.
 * Idempotent: the ownership upsert no-ops on the unique
 * (user_id, item_type, item_id) index and the announcement notification
 * is deduped by dedupe_key, so re-saving onboarding never double-grants
 * or re-notifies. Logs and returns on every failure — never throws,
 * because onboarding must not fail over a gift.
 */
export async function grantBetaTesterPlate(
  supabase: SupabaseClient,
  userId: number
): Promise<void> {
  try {
    // invite_redemptions has no unique constraint on user_id, so cap the
    // read at one row — a bare maybeSingle() errors on multiple rows.
    const { data: redemption, error: redemptionError } = await supabase
      .from('invite_redemptions')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()

    if (redemptionError) {
      console.error('[BetaGrant] Redemption lookup failed:', redemptionError)
      return
    }
    if (!redemption) return

    const { error: upsertError } = await supabase.from('user_cosmetics').upsert(
      {
        user_id: userId,
        item_type: 'plate',
        item_id: BETA_TESTER_PLATE_ID,
        acquired_via: 'beta_grant'
      },
      { onConflict: 'user_id,item_type,item_id', ignoreDuplicates: true }
    )

    if (upsertError) {
      console.error('[BetaGrant] Beta tester plate grant failed:', upsertError)
      return
    }

    await insertMissingNotifications(supabase, userId, [
      {
        type: 'system',
        title: 'TEST PILOT',
        body: 'Beta tester gift minted — thanks for flying the early build. Equip it from your profile editor.',
        data: { plateId: BETA_TESTER_PLATE_ID },
        dedupeKey: `plate_${BETA_TESTER_PLATE_ID}`
      }
    ])
  } catch (error) {
    console.error('[BetaGrant] Grant failed:', error)
  }
}
