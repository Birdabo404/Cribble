import { Polar } from '@polar-sh/sdk'

// Polar.sh payments configuration. Every helper degrades gracefully when
// the POLAR_* env vars are missing (returns null / false instead of
// throwing) so the app boots fine with the shop unconfigured — routes are
// expected to answer 503 in that state.

export type PolarServer = 'sandbox' | 'production'

export type ProProductKey = 'pro_monthly' | 'pro_yearly'

export function getPolarServer(): PolarServer {
  return process.env.POLAR_SERVER === 'production' ? 'production' : 'sandbox'
}

let cachedClient: Polar | null = null
let cachedToken: string | null = null

/** Polar API client, or null when POLAR_ACCESS_TOKEN is not set. */
export function getPolarClient(): Polar | null {
  const token = process.env.POLAR_ACCESS_TOKEN
  if (!token) return null
  if (!cachedClient || cachedToken !== token) {
    cachedClient = new Polar({ accessToken: token, server: getPolarServer() })
    cachedToken = token
  }
  return cachedClient
}

/** True when the Polar API client can be constructed. Routes should also
 *  check that the specific product they need resolves to an id. */
export function isPolarConfigured(): boolean {
  return Boolean(process.env.POLAR_ACCESS_TOKEN)
}

export function getPolarWebhookSecret(): string | null {
  return process.env.POLAR_WEBHOOK_SECRET || null
}

/** Polar product id for a Pro subscription interval, or null if unset. */
export function resolveProProductId(key: ProProductKey): string | null {
  switch (key) {
    case 'pro_monthly':
      return process.env.POLAR_PRODUCT_PRO_MONTHLY || null
    case 'pro_yearly':
      return process.env.POLAR_PRODUCT_PRO_YEARLY || null
    default: {
      const _exhaustive: never = key
      return _exhaustive
    }
  }
}

export type TeamProductKey = 'team_monthly' | 'team_yearly'

const TEAM_PRODUCT_KEYS: readonly TeamProductKey[] = ['team_monthly', 'team_yearly']

/** Polar product id for a Team subscription interval, or null if unset. */
export function resolveTeamProductId(key: TeamProductKey): string | null {
  switch (key) {
    case 'team_monthly':
      return process.env.POLAR_PRODUCT_TEAM_MONTHLY || null
    case 'team_yearly':
      return process.env.POLAR_PRODUCT_TEAM_YEARLY || null
    default: {
      const _exhaustive: never = key
      return _exhaustive
    }
  }
}

/** Configured Team product ids (unset keys skipped). The webhook decides
 *  team-vs-pro fulfillment by membership here — subscription events for
 *  any other product keep the historical Pro handling. */
export function getTeamProductIds(): Set<string> {
  const ids = new Set<string>()
  for (const key of TEAM_PRODUCT_KEYS) {
    const id = resolveTeamProductId(key)
    if (id) ids.add(id)
  }
  return ids
}

/** The slice of a Polar subscription that team classification needs.
 *  Webhook Subscription payloads embed the full product (with metadata);
 *  CustomerStateSubscription from the customer-state sync carries no
 *  product embed, so for those shapes only the id check can apply. */
export interface TeamSubscriptionLike {
  productId: string
  product?: { metadata?: Record<string, unknown> } | null
}

/** True when a subscription is on a Team product: its product id is in
 *  the configured POLAR_PRODUCT_TEAM_* set, or the embedded product
 *  carries the `team_key` metadata the setup script stamps on team
 *  products. The metadata fallback exists because a missing env var
 *  once silently routed a real Team purchase into the Pro grant — when
 *  it fires without an id match, the misconfiguration is logged so the
 *  stale env can be fixed. Products matching neither classify as Pro
 *  (historical founder products rely on that default). */
export function isTeamSubscription(subscription: TeamSubscriptionLike): boolean {
  if (getTeamProductIds().has(subscription.productId)) return true
  const teamKey = subscription.product?.metadata?.['team_key']
  if (typeof teamKey === 'string' && teamKey) {
    console.warn(
      `[Polar] Product ${subscription.productId} carries team_key="${teamKey}" metadata but is not in the configured team product ids — POLAR_PRODUCT_TEAM_MONTHLY / POLAR_PRODUCT_TEAM_YEARLY are missing or stale in this environment`
    )
    return true
  }
  return false
}

/** Polar product id for the one-time "Leaderboard Sponsor Bid" product
 *  (scripts/setup-polar.ts), or null if unset. Its catalog price is
 *  nominal — every checkout overrides it with a server-computed ad-hoc
 *  fixed price, so the id is all the app ever needs. */
export function resolveLeaderboardBidProductId(): string | null {
  return process.env.POLAR_PRODUCT_LEADERBOARD_BID || null
}

/** Polar product id for the one-time "Billboard Slot Sponsorship"
 *  product (scripts/setup-polar.ts), or null if unset. Like the
 *  leaderboard bid, its catalog price is nominal — every checkout
 *  overrides it with the ad-hoc fee-grossed slot price (migration
 *  061), so the id is all the app ever needs. */
export function resolveBillboardSlotProductId(): string | null {
  return process.env.POLAR_PRODUCT_BILLBOARD_SLOT || null
}

/** Parsed POLAR_PLATE_PRODUCT_MAP (JSON string of plateId -> Polar product
 *  id). Malformed JSON or non-string values yield an empty/partial map
 *  rather than an exception. */
export function getPlateProductMap(): Record<string, string> {
  const raw = process.env.POLAR_PLATE_PRODUCT_MAP
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: Record<string, string> = {}
    for (const [plateId, productId] of Object.entries(parsed)) {
      if (typeof productId === 'string' && productId.length > 0) {
        map[plateId] = productId
      }
    }
    return map
  } catch {
    console.error('[Polar] POLAR_PLATE_PRODUCT_MAP is not valid JSON — plate checkout disabled')
    return {}
  }
}

/** Polar product id for a shop plate, or null if the plate isn't mapped. */
export function resolvePlateProductId(plateId: string): string | null {
  return getPlateProductMap()[plateId] || null
}
