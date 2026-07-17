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
