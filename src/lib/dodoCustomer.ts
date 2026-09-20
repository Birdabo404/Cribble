import type { SupabaseClient } from '@supabase/supabase-js'

// users.dodo_customer_id — the bridge between a Cribble account and its
// Dodo Payments customer record. Dodo has no external customer id, so the
// link is learned after the fact from objects that carry both the
// customer id and Cribble's `metadata.userId` (webhook payloads, the
// payment/subscription the shop bounces back with). Once stored, the
// pull-based sync lists that customer's subscriptions and payments, and
// the billing portal opens for that customer.
//
// Every helper here is best-effort by contract: linking is a convenience
// for those two paths — it must never fail fulfillment.

/** The stored Dodo customer id for a user, or null when never linked
 *  (or when the read fails — logged, treated as unlinked). */
export async function readDodoCustomerId(
  supabase: SupabaseClient,
  userId: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('dodo_customer_id')
    .eq('id', userId)
    .single()

  if (error || !data) {
    console.error(
      `[DodoCustomer] Failed to read customer id for user ${userId}:`,
      error?.message ?? 'user not found'
    )
    return null
  }
  return typeof data.dodo_customer_id === 'string' && data.dodo_customer_id
    ? data.dodo_customer_id
    : null
}

/** Store the Dodo customer id on a user row — first link wins. A row that
 *  already carries a DIFFERENT id is left alone (logged): Dodo attaches
 *  same-email checkouts to an existing customer, so a second id for one
 *  account is possible; the webhook still fulfills by metadata.userId
 *  regardless. Never throws. */
export async function linkDodoCustomer(
  supabase: SupabaseClient,
  userId: number,
  customerId: string
): Promise<void> {
  if (!customerId) return
  const { data, error } = await supabase
    .from('users')
    .update({ dodo_customer_id: customerId })
    .eq('id', userId)
    .is('dodo_customer_id', null)
    .select('id')

  if (error) {
    console.error(`[DodoCustomer] Failed to link customer ${customerId} to user ${userId}:`, error.message)
    return
  }
  if (!data || data.length === 0) {
    // Either already linked to this id (fine) or to another one — only
    // the latter is worth a log line.
    const existing = await readDodoCustomerId(supabase, userId)
    if (existing && existing !== customerId) {
      console.warn(
        `[DodoCustomer] User ${userId} is linked to customer ${existing}; ignoring ${customerId} seen on a newer object`
      )
    }
  }
}

/** users.id for a Dodo customer id, or null when no account is linked to
 *  it. The webhook's fallback recipient for dashboard-created objects
 *  that carry no checkout metadata. */
export async function findUserIdByDodoCustomer(
  supabase: SupabaseClient,
  customerId: string
): Promise<number | null> {
  if (!customerId) return null
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('dodo_customer_id', customerId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(`[DodoCustomer] Lookup by customer ${customerId} failed:`, error.message)
    return null
  }
  const id = data?.id
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}
