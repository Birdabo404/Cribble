import DodoPayments, { APIError } from 'dodopayments'

// Dodo Payments configuration. Every helper degrades gracefully when the
// DODO_PAYMENTS_* env vars are missing (returns null / false instead of
// throwing) so the app boots fine with the shop unconfigured — routes are
// expected to answer 503 in that state.
//
// Identity model: Dodo has no external customer id. Cribble stamps
// `metadata.userId` on every checkout (flows onto the payment and
// subscription objects) and stores the Dodo customer id it learns from
// those objects on users.dodo_customer_id (see dodoCustomer.ts). Webhooks
// resolve the recipient from metadata first; the pull-based sync and the
// customer portal key off the stored customer id.

export type DodoEnvironment = 'test_mode' | 'live_mode'

export type ProProductKey = 'pro_monthly' | 'pro_yearly'

export function getDodoEnvironment(): DodoEnvironment {
  return process.env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode' ? 'live_mode' : 'test_mode'
}

let cachedClient: DodoPayments | null = null
let cachedKey: string | null = null

/** Dodo API client, or null when DODO_PAYMENTS_API_KEY is not set. */
export function getDodoClient(): DodoPayments | null {
  const apiKey = process.env.DODO_PAYMENTS_API_KEY
  if (!apiKey) return null
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new DodoPayments({
      bearerToken: apiKey,
      environment: getDodoEnvironment(),
      // DODO_PAYMENTS_BASE_URL: test/self-host override (takes precedence
      // over the environment). Undefined lets the SDK pick from environment.
      baseURL: process.env.DODO_PAYMENTS_BASE_URL || undefined
    })
    cachedKey = apiKey
  }
  return cachedClient
}

/** True when the Dodo API client can be constructed. Routes should also
 *  check that the specific product they need resolves to an id. */
export function isDodoConfigured(): boolean {
  return Boolean(process.env.DODO_PAYMENTS_API_KEY)
}

export function getDodoWebhookSecret(): string | null {
  return process.env.DODO_PAYMENTS_WEBHOOK_KEY || null
}

/** Dodo answers 404 for an unknown id and 422 for a malformed one. Both
 *  mean "this user has nothing here" to the sync/portal paths. */
export function isDodoMissing(error: unknown): boolean {
  return error instanceof APIError && (error.status === 404 || error.status === 422)
}

/** Dodo product id for a Pro subscription interval, or null if unset. */
export function resolveProProductId(key: ProProductKey): string | null {
  switch (key) {
    case 'pro_monthly':
      return process.env.DODO_PRODUCT_PRO_MONTHLY || null
    case 'pro_yearly':
      return process.env.DODO_PRODUCT_PRO_YEARLY || null
    default: {
      const _exhaustive: never = key
      return _exhaustive
    }
  }
}

export type TeamProductKey = 'team_monthly' | 'team_yearly'

const TEAM_PRODUCT_KEYS: readonly TeamProductKey[] = ['team_monthly', 'team_yearly']

/** Dodo product id for a Team subscription interval, or null if unset. */
export function resolveTeamProductId(key: TeamProductKey): string | null {
  switch (key) {
    case 'team_monthly':
      return process.env.DODO_PRODUCT_TEAM_MONTHLY || null
    case 'team_yearly':
      return process.env.DODO_PRODUCT_TEAM_YEARLY || null
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

/** The slice of a Dodo subscription that team classification needs. Dodo
 *  subscription payloads carry the product id only (no product embed), so
 *  classification is purely by configured id. */
export interface TeamSubscriptionLike {
  product_id: string
}

/** True when a subscription is on a configured DODO_PRODUCT_TEAM_*
 *  product. Products matching none classify as Pro. */
export function isTeamSubscription(subscription: TeamSubscriptionLike): boolean {
  return getTeamProductIds().has(subscription.product_id)
}

/** Parsed DODO_PLATE_PRODUCT_MAP (JSON string of plateId -> Dodo product
 *  id). Malformed JSON or non-string values yield an empty/partial map
 *  rather than an exception. */
export function getPlateProductMap(): Record<string, string> {
  const raw = process.env.DODO_PLATE_PRODUCT_MAP
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
    console.error('[Dodo] DODO_PLATE_PRODUCT_MAP is not valid JSON — plate checkout disabled')
    return {}
  }
}

/** Dodo product id for a shop plate, or null if the plate isn't mapped. */
export function resolvePlateProductId(plateId: string): string | null {
  return getPlateProductMap()[plateId] || null
}

/** Reverse lookup: the catalog plate id sold under a Dodo product id, or
 *  null. Dodo payment payloads carry a bare product_cart (no product
 *  metadata), so a payment without checkout metadata falls back to this. */
export function resolvePlateIdForProduct(productId: string): string | null {
  for (const [plateId, mappedProductId] of Object.entries(getPlateProductMap())) {
    if (mappedProductId === productId) return plateId
  }
  return null
}

/** Discount CODE (Dodo applies discounts by code, not id) auto-attached to
 *  plate checkouts for Pro members, or null when unset. */
export function getProPlateDiscountCode(): string | null {
  return process.env.DODO_DISCOUNT_PRO_PLATES || null
}

/** Dodo metadata values are string | number | boolean. */
export type DodoMetadata = Record<string, string | number | boolean>

/** The Cribble users.id stamped on a checkout as `metadata.userId` (set
 *  server-side by /api/checkout, carried onto the payment and
 *  subscription objects), or null when absent/malformed. The identity
 *  anchor for fulfillment — see the webhook and subscriptionSync. */
export function readMetadataUserId(metadata: DodoMetadata | null | undefined): number | null {
  const raw = metadata?.['userId']
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Plate id stamped on a checkout as `metadata.plateId` (or its
 *  snake_case variant on hand-created objects), or null. */
export function readMetadataPlateId(metadata: DodoMetadata | null | undefined): string | null {
  for (const value of [metadata?.['plateId'], metadata?.['plate_id']]) {
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number') return String(value)
  }
  return null
}
