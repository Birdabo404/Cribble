import DodoPayments from 'dodopayments'

// Dodo Payments configuration. Helpers degrade when the DODO_* env vars
// are missing (null / false) so the app still boots, and routes answer
// 503 until scripts/setup-dodo.ts has provisioned the test catalog.
// Environment defaults to test_mode: a missing or mistyped value must
// never silently talk to live.

export type DodoEnvironment = 'test_mode' | 'live_mode'

export type ProProductKey = 'pro_monthly' | 'pro_yearly'
export type TeamProductKey = 'team_monthly' | 'team_yearly'

export function getDodoEnvironment(): DodoEnvironment {
  return process.env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode' ? 'live_mode' : 'test_mode'
}

let cachedClient: DodoPayments | null = null
let cachedToken: string | null = null
let cachedEnvironment: DodoEnvironment | null = null

/** Dodo API client, or null when DODO_PAYMENTS_API_KEY is not set. */
export function getDodoClient(): DodoPayments | null {
  const token = process.env.DODO_PAYMENTS_API_KEY
  if (!token) return null
  const environment = getDodoEnvironment()
  if (!cachedClient || cachedToken !== token || cachedEnvironment !== environment) {
    cachedClient = new DodoPayments({
      bearerToken: token,
      environment,
      webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY || null
    })
    cachedToken = token
    cachedEnvironment = environment
  }
  return cachedClient
}

export function isDodoConfigured(): boolean {
  return Boolean(process.env.DODO_PAYMENTS_API_KEY)
}

/** Local and preview can use test mode. Production takes Dodo payments
 *  only when the environment is explicitly live_mode, so a test key
 *  stored on Vercel cannot replace Polar. */
export function isDodoActive(): boolean {
  if (!isDodoConfigured()) return false
  if (process.env.VERCEL_ENV === 'production') return getDodoEnvironment() === 'live_mode'
  return true
}

export function getDodoWebhookKey(): string | null {
  return process.env.DODO_PAYMENTS_WEBHOOK_KEY || null
}

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

const TEAM_PRODUCT_KEYS: readonly TeamProductKey[] = ['team_monthly', 'team_yearly']

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

export function getTeamProductIds(): Set<string> {
  const ids = new Set<string>()
  for (const key of TEAM_PRODUCT_KEYS) {
    const id = resolveTeamProductId(key)
    if (id) ids.add(id)
  }
  return ids
}

/** True when a subscription is on a Team product: configured id, or the
 *  product metadata `team_key` the setup script stamps. The metadata
 *  fallback logs, matching the Polar misconfiguration that once granted
 *  a Team purchase as Pro. */
export function isDodoTeamProduct(
  productId: string,
  productMetadata?: Record<string, unknown> | null
): boolean {
  if (getTeamProductIds().has(productId)) return true
  const teamKey = productMetadata?.['team_key']
  if (typeof teamKey === 'string' && teamKey) {
    console.warn(
      `[Dodo] Product ${productId} carries team_key="${teamKey}" metadata but is not in the configured team product ids — DODO_PRODUCT_TEAM_MONTHLY / DODO_PRODUCT_TEAM_YEARLY are missing or stale in this environment`
    )
    return true
  }
  return false
}

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

export function resolvePlateProductId(plateId: string): string | null {
  return getPlateProductMap()[plateId] || null
}

/** Product id -> catalog plate id, for payments whose metadata omitted plateId. */
export function plateIdForProduct(productId: string): string | null {
  for (const [plateId, mapped] of Object.entries(getPlateProductMap())) {
    if (mapped === productId) return plateId
  }
  return null
}

/** Discount code auto-applied to plate checkouts for Pro members. */
export function getProPlateDiscountCode(): string | null {
  return process.env.DODO_DISCOUNT_PRO_PLATES || null
}

export function readUserId(metadata: Record<string, unknown> | null | undefined): number | null {
  const raw = metadata?.['userId']
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function readPlateId(metadata: Record<string, unknown> | null | undefined): string | null {
  const candidates = [metadata?.['plateId'], metadata?.['plate_id']]
  for (const value of candidates) {
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number') return String(value)
  }
  return null
}
