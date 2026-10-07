// Provisions the Dodo Payments business for the Cribble shop, end to end:
//
//   - Pro subscription products   (monthly $6.99, yearly $49.99)
//   - Team subscription products  (monthly $50, yearly $500)
//   - one one-time product per purchasable plate, with `plate_id` metadata
//   - the 25% "Pro Plate Perk" discount code restricted to the plate
//     products (Dodo applies discounts by CODE — the app attaches it to
//     Pro members' plate checkouts and hides the code field on those)
//   - the webhook endpoint pointing at /api/webhooks/dodo, filtered to the
//     subscription / payment / refund events the route handles
//
// Idempotent: existing objects are matched by metadata (pro_key / team_key /
// plate_id / cribble_key, name as fallback) and reused; only missing pieces
// are created.
// Prices are compared against the catalog and drift is reported, never
// auto-changed — repricing live products is a deliberate dashboard act.
//
//   npx vite-node scripts/setup-dodo.ts                          # provision missing objects
//   npx vite-node scripts/setup-dodo.ts --check                  # read-only drift report (exit 1 on drift)
//   npx vite-node scripts/setup-dodo.ts --write-env              # also upsert the DODO_* block into .env.local
//   npx vite-node scripts/setup-dodo.ts --url https://cribble.dev  # webhook target (default: https NEXT_PUBLIC_APP_URL)
//   npx vite-node scripts/setup-dodo.ts --live                   # required when DODO_PAYMENTS_ENVIRONMENT=live_mode
//
// Needs DODO_PAYMENTS_API_KEY in .env.local (Developer → API Keys in the
// dashboard; the test-mode key while DODO_PAYMENTS_ENVIRONMENT=test_mode).

import fs from 'node:fs'
import path from 'node:path'
import DodoPayments from 'dodopayments'
import type { Discount } from 'dodopayments/resources/discounts'
import type { ProductListResponse } from 'dodopayments/resources/products'
import type { WebhookEventType } from 'dodopayments/resources/webhook-events'
import type { WebhookDetails } from 'dodopayments/resources/webhooks'
import { PLATES, type PlateDef } from '../src/lib/cosmetics/plates'
import { getDodoEnvironment } from '../src/lib/dodo'

// --write-env target; DODO_SETUP_ENV_FILE redirects it (tests, .env.production)
const ENV_FILE = process.env.DODO_SETUP_ENV_FILE
  ? path.resolve(process.env.DODO_SETUP_ENV_FILE)
  : path.resolve(__dirname, '../.env.local')

function loadEnvLocal() {
  if (!fs.existsSync(ENV_FILE)) return
  const text = fs.readFileSync(ENV_FILE, 'utf8')
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    let value = match[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value
  }
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function readFlagValue(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : null
}

// ---------------------------------------------------------------------------
// Desired state, derived from the same sources the app reads at runtime:
// subscription prices mirror the /shop and /teams copy, plate prices come
// straight from the catalog. Cents everywhere — Dodo amounts are integer
// cents (lowest denomination of the currency).

interface DesiredSubscription {
  key: 'pro_monthly' | 'pro_yearly' | 'team_monthly' | 'team_yearly'
  /** Metadata key the product is tagged and matched by (pro_key / team_key). */
  metaKey: 'pro_key' | 'team_key'
  envKey: string
  name: string
  description: string
  priceCents: number
  interval: 'Month' | 'Year'
}

const PRO_SUBSCRIPTIONS: DesiredSubscription[] = [
  {
    key: 'pro_monthly',
    metaKey: 'pro_key',
    envKey: 'DODO_PRODUCT_PRO_MONTHLY',
    name: 'Cribble Pro',
    description: 'Cribble Pro membership, billed monthly. Animated banners, the Pro plate collection and 25% off all plates.',
    priceCents: 699,
    interval: 'Month'
  },
  {
    key: 'pro_yearly',
    metaKey: 'pro_key',
    envKey: 'DODO_PRODUCT_PRO_YEARLY',
    name: 'Cribble Pro (Yearly)',
    description: 'Cribble Pro membership, billed yearly — over 40% off versus monthly.',
    priceCents: 4999,
    interval: 'Year'
  }
]

const TEAM_SUBSCRIPTIONS: DesiredSubscription[] = [
  {
    key: 'team_monthly',
    metaKey: 'team_key',
    envKey: 'DODO_PRODUCT_TEAM_MONTHLY',
    name: 'Cribble Team',
    description: 'Cribble Team company account, billed monthly. The gold badge, the square avatar and up to 10 affiliated pilots — every team verified by hand.',
    priceCents: 5000,
    interval: 'Month'
  },
  {
    key: 'team_yearly',
    metaKey: 'team_key',
    envKey: 'DODO_PRODUCT_TEAM_YEARLY',
    name: 'Cribble Team (Yearly)',
    description: 'Cribble Team company account, billed yearly — two months free versus monthly.',
    priceCents: 50000,
    interval: 'Year'
  }
]

const PURCHASABLE_PLATES = PLATES.filter(
  (plate): plate is PlateDef & { priceUsd: number } => plate.priceUsd !== null
)

/** Dodo needs a tax category per product. Memberships are a hosted
 *  service; plates are downloadable-style digital goods. */
const SUBSCRIPTION_TAX_CATEGORY = 'saas'
const PLATE_TAX_CATEGORY = 'digital_products'

/** Dodo ends a subscription when its period runs out. A period equal to
 *  the payment frequency means ONE cycle then `expired`, so an ongoing
 *  plan needs a period far longer than any customer will keep it (Dodo's
 *  own guidance: e.g. 20 years with a monthly frequency). */
const SUBSCRIPTION_PERIOD_YEARS = 20

const DISCOUNT_NAME = 'Pro Plate Perk'
const DISCOUNT_CODE = 'PROPLATES'
const DISCOUNT_BASIS_POINTS = 2500
/** Mirrors SUBSCRIBED_EVENT_TYPES in src/app/api/webhooks/dodo/route.ts. */
const WEBHOOK_EVENTS: WebhookEventType[] = [
  'subscription.active',
  'subscription.renewed',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.expired',
  'subscription.on_hold',
  'payment.succeeded',
  'refund.succeeded'
]
const WEBHOOK_DESCRIPTION = 'Cribble shop'

// ---------------------------------------------------------------------------

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** The product's fixed price in cents, or null when the list row carries
 *  no price (usage-based / pay-what-you-want shapes). */
function listedPriceCents(product: ProductListResponse): number | null {
  const detail = product.price_detail
  if (detail && (detail.type === 'one_time_price' || detail.type === 'recurring_price')) {
    return detail.price
  }
  return typeof product.price === 'number' ? product.price : null
}

function matchProduct(
  products: ProductListResponse[],
  recurring: boolean,
  metaKey: string,
  metaValue: string,
  fallbackName: string
): ProductListResponse | null {
  const pool = products.filter((product) => product.is_recurring === recurring)
  const byMeta = pool.find((product) => String(product.metadata[metaKey] ?? '') === metaValue)
  return byMeta ?? pool.find((product) => product.name === fallbackName) ?? null
}

async function listAllProducts(dodo: DodoPayments): Promise<ProductListResponse[]> {
  const products: ProductListResponse[] = []
  for await (const product of dodo.products.list({ archived: false, page_size: 100 })) {
    products.push(product)
  }
  return products
}

async function listAllDiscounts(dodo: DodoPayments): Promise<Discount[]> {
  const discounts: Discount[] = []
  for await (const discount of dodo.discounts.list({ page_size: 100 })) {
    discounts.push(discount)
  }
  return discounts
}

async function listAllWebhooks(dodo: DodoPayments): Promise<WebhookDetails[]> {
  const endpoints: WebhookDetails[] = []
  for await (const endpoint of dodo.webhooks.list({ limit: 100 })) {
    endpoints.push(endpoint)
  }
  return endpoints
}

type RowStatus = 'ok' | 'created' | 'missing' | 'drift' | 'skipped'

interface ReportRow {
  section: string
  label: string
  status: RowStatus
  detail: string
}

const report: ReportRow[] = []
let driftCount = 0

function record(section: string, label: string, status: RowStatus, detail: string) {
  report.push({ section, label, status, detail })
  if (status === 'missing' || status === 'drift') driftCount += 1
}

/** Env var comparison is part of the drift report: a provisioned product the
 *  app can't see (stale/absent env id) is as broken as a missing product.
 *  When --write-env is about to fix the var anyway, report that instead. */
function recordEnvState(
  section: string,
  envKey: string,
  resolvedValue: string | null,
  willWrite: boolean
) {
  if (!resolvedValue) return
  const current = process.env[envKey] ?? ''
  if (current === resolvedValue) {
    record(section, envKey, 'ok', 'env matches')
  } else if (willWrite) {
    record(section, envKey, 'ok', 'writing to env file')
  } else {
    record(section, envKey, 'drift', current ? 'env has a different value' : 'env not set')
  }
}

function upsertEnvLocal(entries: Array<[string, string]>) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''
  for (const [key, value] of entries) {
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    if (pattern.test(text)) {
      text = text.replace(pattern, line)
    } else {
      if (text !== '' && !text.endsWith('\n')) text += '\n'
      text += `${line}\n`
    }
  }
  fs.writeFileSync(ENV_FILE, text)
}

function resolveWebhookBaseUrl(): string | null {
  const flag = readFlagValue('--url')
  if (flag) return flag.replace(/\/+$/, '')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  if (appUrl.startsWith('https://')) return appUrl.replace(/\/+$/, '')
  return null
}

async function main() {
  loadEnvLocal()

  const check = hasFlag('--check')
  const writeEnv = hasFlag('--write-env')
  const willWriteEnv = writeEnv && !check
  const environment = getDodoEnvironment()

  const apiKey = process.env.DODO_PAYMENTS_API_KEY
  if (!apiKey) {
    console.error('DODO_PAYMENTS_API_KEY is not set in .env.local.')
    console.error(`Create an API key at https://app.dodopayments.com → Developer → API Keys (with the dashboard toggled to ${environment === 'test_mode' ? 'Test' : 'Live'} mode — keys are per mode), then re-run.`)
    process.exit(1)
  }
  if (environment === 'live_mode' && !check && !hasFlag('--live')) {
    console.error('DODO_PAYMENTS_ENVIRONMENT=live_mode — pass --live to confirm writes against the live business.')
    process.exit(1)
  }

  // DODO_PAYMENTS_BASE_URL: test/self-host override (takes precedence over environment)
  const dodo = new DodoPayments({
    bearerToken: apiKey,
    environment,
    baseURL: process.env.DODO_PAYMENTS_BASE_URL || undefined
  })
  console.log(`Dodo Payments setup — ${environment}${check ? ' (check only, nothing will be created)' : ''}\n`)

  const products = await listAllProducts(dodo)
  const envEntries: Array<[string, string]> = []

  // --- Subscriptions (Pro + Team) -------------------------------------------
  for (const sub of [...PRO_SUBSCRIPTIONS, ...TEAM_SUBSCRIPTIONS]) {
    let productId = matchProduct(products, true, sub.metaKey, sub.key, sub.name)?.product_id ?? null
    const matched = productId ? products.find((p) => p.product_id === productId) ?? null : null
    if (!productId && !check) {
      const created = await dodo.products.create({
        name: sub.name,
        description: sub.description,
        tax_category: SUBSCRIPTION_TAX_CATEGORY,
        metadata: { [sub.metaKey]: sub.key },
        price: {
          type: 'recurring_price',
          currency: 'USD',
          price: sub.priceCents,
          payment_frequency_count: 1,
          payment_frequency_interval: sub.interval,
          subscription_period_count: SUBSCRIPTION_PERIOD_YEARS,
          subscription_period_interval: 'Year'
        }
      })
      productId = created.product_id
      record('SUBSCRIPTIONS', sub.name, 'created', `${formatUsd(sub.priceCents)}/${sub.interval.toLowerCase()} → ${productId}`)
    } else if (!productId) {
      record('SUBSCRIPTIONS', sub.name, 'missing', `would create at ${formatUsd(sub.priceCents)}/${sub.interval.toLowerCase()}`)
    } else if (matched) {
      const cents = listedPriceCents(matched)
      const priceNote = cents === sub.priceCents ? formatUsd(sub.priceCents) : `price drift: Dodo has ${cents === null ? 'no fixed price' : formatUsd(cents)}, catalog says ${formatUsd(sub.priceCents)}`
      record('SUBSCRIPTIONS', sub.name, cents === sub.priceCents ? 'ok' : 'drift', `${priceNote} → ${productId}`)
    }
    if (productId) envEntries.push([sub.envKey, productId])
    recordEnvState('SUBSCRIPTIONS', sub.envKey, productId, willWriteEnv)
  }

  // --- Plate products ------------------------------------------------------
  const plateProductIds: string[] = []
  const plateMap: Record<string, string> = {}
  for (const plate of PURCHASABLE_PLATES) {
    const priceCents = Math.round(plate.priceUsd * 100)
    const productName = `${plate.name} — Leaderboard Plate`
    const matched = matchProduct(products, false, 'plate_id', plate.id, productName)
    let productId = matched?.product_id ?? null
    if (!productId && !check) {
      const created = await dodo.products.create({
        name: productName,
        description: plate.tagline,
        tax_category: PLATE_TAX_CATEGORY,
        metadata: { plate_id: plate.id },
        price: { type: 'one_time_price', currency: 'USD', price: priceCents }
      })
      productId = created.product_id
      record('PLATES', plate.id, 'created', `${formatUsd(priceCents)} → ${productId}`)
    } else if (!productId) {
      record('PLATES', plate.id, 'missing', `would create at ${formatUsd(priceCents)}`)
    } else if (matched) {
      const cents = listedPriceCents(matched)
      const metaOk = String(matched.metadata['plate_id'] ?? '') === plate.id
      if (!metaOk && !check) {
        await dodo.products.update(productId, {
          metadata: { ...matched.metadata, plate_id: plate.id }
        })
      }
      const priceOk = cents === priceCents
      const detail = [
        priceOk ? formatUsd(priceCents) : `price drift: Dodo has ${cents === null ? 'no fixed price' : formatUsd(cents)}, catalog says ${formatUsd(priceCents)}`,
        metaOk ? null : check ? 'plate_id metadata missing' : 'plate_id metadata added',
        `→ ${productId}`
      ].filter(Boolean).join(' ')
      record('PLATES', plate.id, priceOk && (metaOk || !check) ? 'ok' : 'drift', detail)
    }
    if (productId) {
      plateProductIds.push(productId)
      plateMap[plate.id] = productId
    }
  }

  // Retired plates are never (re)created but keep their mapping, so late
  // webhooks and refunds for them still resolve the plate. Production's map
  // is a sensitive (write-only) env var: this printed map replaces it whole.
  for (const plate of PLATES.filter((p) => p.retired)) {
    const matched = matchProduct(products, false, 'plate_id', plate.id, `${plate.name} — Leaderboard Plate`)
    if (matched) {
      plateMap[plate.id] = matched.product_id
      record('PLATES', plate.id, 'ok', `retired, kept in map → ${matched.product_id}`)
    }
  }

  const plateMapJson = JSON.stringify(plateMap)
  if (plateProductIds.length === PURCHASABLE_PLATES.length) {
    envEntries.push(['DODO_PLATE_PRODUCT_MAP', plateMapJson])
    recordEnvState('PLATES', 'DODO_PLATE_PRODUCT_MAP', plateMapJson, willWriteEnv)
  }

  // --- Pro plate discount --------------------------------------------------
  const discounts = await listAllDiscounts(dodo)
  let discount =
    discounts.find((d) => String(d.metadata['cribble_key'] ?? '') === 'pro_plate_perk') ??
    discounts.find((d) => d.code === DISCOUNT_CODE) ??
    discounts.find((d) => d.name === DISCOUNT_NAME) ??
    null

  if (!discount && !check && plateProductIds.length > 0) {
    discount = await dodo.discounts.create({
      name: DISCOUNT_NAME,
      code: DISCOUNT_CODE,
      type: 'percentage',
      amount: DISCOUNT_BASIS_POINTS,
      restricted_to: plateProductIds,
      metadata: { cribble_key: 'pro_plate_perk' }
    })
    record('DISCOUNT', DISCOUNT_NAME, 'created', `25% off ${plateProductIds.length} plates, code ${discount.code} → ${discount.discount_id}`)
  } else if (!discount) {
    record('DISCOUNT', DISCOUNT_NAME, 'missing', `would create a 25% discount code ${DISCOUNT_CODE} on all plates`)
  } else {
    const covered = new Set(discount.restricted_to)
    const missingProducts = plateProductIds.filter((id) => !covered.has(id))
    const percentOk = discount.type === 'percentage' && discount.amount === DISCOUNT_BASIS_POINTS
    if (missingProducts.length > 0 && !check) {
      discount = await dodo.discounts.update(discount.discount_id, {
        restricted_to: plateProductIds
      })
      record('DISCOUNT', DISCOUNT_NAME, 'ok', `extended to ${missingProducts.length} new plate product(s) → ${discount.discount_id}`)
    } else if (missingProducts.length > 0) {
      record('DISCOUNT', DISCOUNT_NAME, 'drift', `${missingProducts.length} plate product(s) not covered`)
    } else {
      record('DISCOUNT', DISCOUNT_NAME, percentOk ? 'ok' : 'drift', percentOk ? `25% on ${plateProductIds.length} plates, code ${discount.code} → ${discount.discount_id}` : 'discount is not 25% — fix in the dashboard')
    }
  }
  // The app attaches the discount by CODE (Dodo checkout sessions take
  // discount_codes, not ids).
  if (discount) envEntries.push(['DODO_DISCOUNT_PRO_PLATES', discount.code])
  recordEnvState('DISCOUNT', 'DODO_DISCOUNT_PRO_PLATES', discount?.code ?? null, willWriteEnv)

  // --- Webhook endpoint ----------------------------------------------------
  const baseUrl = resolveWebhookBaseUrl()
  if (!baseUrl) {
    record('WEBHOOK', '/api/webhooks/dodo', 'skipped', 'no https URL — pass --url https://<domain> (localhost needs a tunnel)')
  } else {
    const webhookUrl = `${baseUrl}/api/webhooks/dodo`
    const endpoints = await listAllWebhooks(dodo)
    let endpoint = endpoints.find((e) => e.url === webhookUrl) ?? null
    if (!endpoint && !check) {
      endpoint = await dodo.webhooks.create({
        url: webhookUrl,
        description: WEBHOOK_DESCRIPTION,
        filter_types: WEBHOOK_EVENTS
      })
      record('WEBHOOK', webhookUrl, 'created', `${WEBHOOK_EVENTS.length} events → ${endpoint.id}`)
    } else if (!endpoint) {
      record('WEBHOOK', webhookUrl, 'missing', 'would create (subscription + payment + refund events)')
    } else {
      const existingEvents = new Set((endpoint.filter_types ?? []).map((event) => String(event)))
      // An endpoint with no filter receives everything — that covers ours.
      const unfiltered = existingEvents.size === 0
      const missingEvents = unfiltered ? [] : WEBHOOK_EVENTS.filter((event) => !existingEvents.has(event))
      const enabled = !endpoint.disabled
      if ((missingEvents.length > 0 || !enabled) && !check) {
        endpoint = await dodo.webhooks.update(endpoint.id, {
          disabled: false,
          ...(missingEvents.length > 0
            ? { filter_types: [...new Set([...(endpoint.filter_types ?? []), ...WEBHOOK_EVENTS])] as WebhookEventType[] }
            : {})
        })
        record('WEBHOOK', webhookUrl, 'ok', `updated (${missingEvents.length} event(s) added${enabled ? '' : ', re-enabled'}) → ${endpoint.id}`)
      } else if (missingEvents.length > 0 || !enabled) {
        record('WEBHOOK', webhookUrl, 'drift', enabled ? `missing events: ${missingEvents.join(', ')}` : 'endpoint is disabled')
      } else {
        record('WEBHOOK', webhookUrl, 'ok', `${unfiltered ? 'all events' : 'all subscribed events'} → ${endpoint.id}`)
      }
    }
    if (endpoint) {
      // The secret is never in the endpoint object — separate read.
      const { secret } = await dodo.webhooks.retrieveSecret(endpoint.id)
      envEntries.push(['DODO_PAYMENTS_WEBHOOK_KEY', secret])
      recordEnvState('WEBHOOK', 'DODO_PAYMENTS_WEBHOOK_KEY', secret, willWriteEnv)
    }
  }

  // --- Report --------------------------------------------------------------
  let section = ''
  for (const row of report) {
    if (row.section !== section) {
      section = row.section
      console.log(`${section}`)
    }
    console.log(`  [${row.status.padEnd(7)}] ${row.label.padEnd(34)} ${row.detail}`)
  }

  if (envEntries.length > 0) {
    console.log('\nENV BLOCK (paste into .env.local / Vercel project env)')
    console.log(`DODO_PAYMENTS_ENVIRONMENT=${environment}`)
    for (const [key, value] of envEntries) console.log(`${key}=${value}`)
    if (willWriteEnv) {
      upsertEnvLocal(envEntries)
      console.log(`\nWrote ${envEntries.length} var(s) to ${ENV_FILE}`)
    }
  }

  console.log('\nNotes')
  console.log('  - Restart the dev server / redeploy after changing env vars.')
  console.log('  - Run migrations/072_dodo_customer_id.sql once per database before the first checkout.')
  console.log('  - Local webhooks: `dodo wh listen http://localhost:3000/api/webhooks/dodo` (Dodo CLI, test mode only).')

  if (check && driftCount > 0) {
    console.log(`\n${driftCount} item(s) missing or drifted — run without --check to provision.`)
    process.exit(1)
  }
}

main().catch((error: unknown) => {
  console.error('\nSetup failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
