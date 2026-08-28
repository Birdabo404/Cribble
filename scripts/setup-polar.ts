// Provisions the Polar organization for the Cribble shop, end to end:
//
//   - Pro subscription products   (monthly $6.99, yearly $49.99)
//   - Team subscription products  (monthly $50, yearly $500)
//   - one one-time product per purchasable plate, with `plate_id` metadata
//     (the webhook grants ownership from it)
//   - the one-time "Leaderboard Sponsor Bid" product, with `cribble_key`
//     metadata — its catalog price is the $6.66 empty-board opening and is
//     nominal only: every checkout overrides it with a server-computed
//     ad-hoc fixed price (migration 055)
//   - the one-time "Billboard Slot Sponsorship" product, with `cribble_key`
//     metadata — its catalog price is the $200 flipper sticker and is
//     nominal only: every checkout overrides it with the fee-grossed
//     ad-hoc slot price (migration 061)
//   - the 25% "Pro Plate Perk" discount restricted to the plate products
//   - the webhook endpoint pointing at /api/webhooks/polar (raw format —
//     team products and sponsor bids reuse the same order events, nothing
//     extra)
//
// Idempotent: existing objects are matched by metadata (pro_key / team_key /
// plate_id / cribble_key, name as fallback) and reused; only missing pieces
// are created.
// Prices are compared against the catalog and drift is reported, never
// auto-changed — repricing live products is a deliberate dashboard act.
//
//   npx vite-node scripts/setup-polar.ts                          # provision missing objects
//   npx vite-node scripts/setup-polar.ts --check                  # read-only drift report (exit 1 on drift)
//   npx vite-node scripts/setup-polar.ts --write-env              # also upsert the POLAR_* block into .env.local
//   npx vite-node scripts/setup-polar.ts --url https://cribble.dev  # webhook target (default: https NEXT_PUBLIC_APP_URL)
//   npx vite-node scripts/setup-polar.ts --production             # required when POLAR_SERVER=production
//
// Needs POLAR_ACCESS_TOKEN in .env.local (org token; sandbox.polar.sh while
// POLAR_SERVER=sandbox).

import fs from 'node:fs'
import path from 'node:path'
import { Polar } from '@polar-sh/sdk'
import type { Discount } from '@polar-sh/sdk/models/components/discount'
import type { Product } from '@polar-sh/sdk/models/components/product'
import type { WebhookEndpoint } from '@polar-sh/sdk/models/components/webhookendpoint'
import type { WebhookEventType } from '@polar-sh/sdk/models/components/webhookeventtype'
import { BILLBOARD_PRICE_CENTS } from '../src/lib/billboard'
import { PLATES, type PlateDef } from '../src/lib/cosmetics/plates'
import { LEADERBOARD_SPONSOR_OPENING_CENTS } from '../src/lib/leaderboardSponsor'
import { getPolarServer } from '../src/lib/polar'

// --write-env target; POLAR_SETUP_ENV_FILE redirects it (tests, .env.production)
const ENV_FILE = process.env.POLAR_SETUP_ENV_FILE
  ? path.resolve(process.env.POLAR_SETUP_ENV_FILE)
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
// straight from the catalog. Cents everywhere — Polar amounts are integer
// cents.

interface DesiredSubscription {
  key: 'pro_monthly' | 'pro_yearly' | 'team_monthly' | 'team_yearly'
  /** Metadata key the product is tagged and matched by (pro_key / team_key)
   *  — the same key the webhook and sync use to classify fulfillment. */
  metaKey: 'pro_key' | 'team_key'
  envKey: string
  name: string
  description: string
  priceCents: number
  interval: 'month' | 'year'
}

const PRO_SUBSCRIPTIONS: DesiredSubscription[] = [
  {
    key: 'pro_monthly',
    metaKey: 'pro_key',
    envKey: 'POLAR_PRODUCT_PRO_MONTHLY',
    name: 'Cribble Pro',
    description: 'Cribble Pro membership, billed monthly. Animated banners, the Pro plate collection and 25% off all plates.',
    priceCents: 699,
    interval: 'month'
  },
  {
    key: 'pro_yearly',
    metaKey: 'pro_key',
    envKey: 'POLAR_PRODUCT_PRO_YEARLY',
    name: 'Cribble Pro (Yearly)',
    description: 'Cribble Pro membership, billed yearly — over 40% off versus monthly.',
    priceCents: 4999,
    interval: 'year'
  }
]

const TEAM_SUBSCRIPTIONS: DesiredSubscription[] = [
  {
    key: 'team_monthly',
    metaKey: 'team_key',
    envKey: 'POLAR_PRODUCT_TEAM_MONTHLY',
    name: 'Cribble Team',
    description: 'Cribble Team company account, billed monthly. The gold badge, the square avatar and up to 10 affiliated pilots — every team verified by hand.',
    priceCents: 5000,
    interval: 'month'
  },
  {
    key: 'team_yearly',
    metaKey: 'team_key',
    envKey: 'POLAR_PRODUCT_TEAM_YEARLY',
    name: 'Cribble Team (Yearly)',
    description: 'Cribble Team company account, billed yearly — two months free versus monthly.',
    priceCents: 50000,
    interval: 'year'
  }
]

const PURCHASABLE_PLATES = PLATES.filter(
  (plate): plate is PlateDef & { priceUsd: number } => plate.priceUsd !== null
)

// The leaderboard sponsor bid (migration 055). Matched/tagged by
// cribble_key metadata like the discount; the price is the empty-board
// opening from lib/leaderboardSponsor and only nominal — checkout
// always attaches an ad-hoc fixed price, so drift here is cosmetic.
const LEADERBOARD_BID = {
  metaValue: 'leaderboard_bid',
  envKey: 'POLAR_PRODUCT_LEADERBOARD_BID',
  name: 'Leaderboard Sponsor Bid',
  description:
    'A ranked sponsor contribution on the Cribble leaderboard — each payment counts toward your creative\'s rolling 24-hour total. The charged amount is set per checkout; this catalog price is the empty-board opening.',
  priceCents: LEADERBOARD_SPONSOR_OPENING_CENTS
}

// The billboard slot purchase (migration 061). Matched/tagged by
// cribble_key metadata like the bid product; the price is the flipper
// sticker from lib/billboard and only nominal — checkout always
// attaches the ad-hoc fee-grossed slot price, so drift here is
// cosmetic.
const BILLBOARD_SLOT = {
  metaValue: 'billboard_slot',
  envKey: 'POLAR_PRODUCT_BILLBOARD_SLOT',
  name: 'Billboard Slot Sponsorship',
  description:
    'A 7-day sponsored slot on the Cribble Billboard — the rotating flipper under the navbar or an always-on profile rail. The charged amount is set per checkout (the advertised slot price plus payment processing); this catalog price is the flipper sticker.',
  priceCents: BILLBOARD_PRICE_CENTS
}

const DISCOUNT_NAME = 'Pro Plate Perk'
const DISCOUNT_BASIS_POINTS = 2500
const WEBHOOK_EVENTS: WebhookEventType[] = [
  'subscription.active',
  'subscription.canceled',
  'subscription.uncanceled',
  'subscription.revoked',
  'order.paid',
  'order.refunded'
]

// ---------------------------------------------------------------------------

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function fixedPriceCents(product: Product): number | null {
  for (const price of product.prices) {
    if ('amountType' in price && price.amountType === 'fixed') return price.priceAmount
  }
  return null
}

function matchProduct(
  products: Product[],
  recurring: boolean,
  metaKey: string,
  metaValue: string,
  fallbackName: string
): Product | null {
  const pool = products.filter((product) => product.isRecurring === recurring)
  const byMeta = pool.find((product) => String(product.metadata[metaKey] ?? '') === metaValue)
  return byMeta ?? pool.find((product) => product.name === fallbackName) ?? null
}

async function listAllProducts(polar: Polar): Promise<Product[]> {
  const products: Product[] = []
  const pages = await polar.products.list({ isArchived: false, limit: 100 })
  for await (const page of pages) products.push(...page.result.items)
  return products
}

async function listAllDiscounts(polar: Polar): Promise<Discount[]> {
  const discounts: Discount[] = []
  const pages = await polar.discounts.list({ limit: 100 })
  for await (const page of pages) discounts.push(...page.result.items)
  return discounts
}

async function listAllWebhooks(polar: Polar): Promise<WebhookEndpoint[]> {
  const endpoints: WebhookEndpoint[] = []
  const pages = await polar.webhooks.listWebhookEndpoints({ limit: 100 })
  for await (const page of pages) endpoints.push(...page.result.items)
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
  const server = getPolarServer()

  const token = process.env.POLAR_ACCESS_TOKEN
  if (!token) {
    console.error('POLAR_ACCESS_TOKEN is not set in .env.local.')
    console.error(`Create an organization access token at https://${server === 'sandbox' ? 'sandbox.polar.sh' : 'polar.sh'} → Settings → Developers, then re-run.`)
    process.exit(1)
  }
  if (server === 'production' && !check && !hasFlag('--production')) {
    console.error('POLAR_SERVER=production — pass --production to confirm writes against the live organization.')
    process.exit(1)
  }

  // POLAR_BASE_URL: test/self-host override (takes precedence over server)
  const polar = new Polar({
    accessToken: token,
    server,
    serverURL: process.env.POLAR_BASE_URL || undefined
  })
  console.log(`Polar setup — ${server}${check ? ' (check only, nothing will be created)' : ''}\n`)

  const products = await listAllProducts(polar)
  const envEntries: Array<[string, string]> = []

  // --- Subscriptions (Pro + Team) -------------------------------------------
  for (const sub of [...PRO_SUBSCRIPTIONS, ...TEAM_SUBSCRIPTIONS]) {
    let product = matchProduct(products, true, sub.metaKey, sub.key, sub.name)
    if (!product && !check) {
      product = await polar.products.create({
        name: sub.name,
        description: sub.description,
        metadata: { [sub.metaKey]: sub.key },
        recurringInterval: sub.interval,
        prices: [{ amountType: 'fixed', priceAmount: sub.priceCents }]
      })
      record('SUBSCRIPTIONS', sub.name, 'created', `${formatUsd(sub.priceCents)}/${sub.interval} → ${product.id}`)
    } else if (!product) {
      record('SUBSCRIPTIONS', sub.name, 'missing', `would create at ${formatUsd(sub.priceCents)}/${sub.interval}`)
    } else {
      const cents = fixedPriceCents(product)
      const priceNote = cents === sub.priceCents ? formatUsd(sub.priceCents) : `price drift: Polar has ${cents === null ? 'no fixed price' : formatUsd(cents)}, catalog says ${formatUsd(sub.priceCents)}`
      record('SUBSCRIPTIONS', sub.name, cents === sub.priceCents ? 'ok' : 'drift', `${priceNote} → ${product.id}`)
    }
    if (product) envEntries.push([sub.envKey, product.id])
    recordEnvState('SUBSCRIPTIONS', sub.envKey, product?.id ?? null, willWriteEnv)
  }

  // --- Plate products ------------------------------------------------------
  const plateProductIds: string[] = []
  const plateMap: Record<string, string> = {}
  for (const plate of PURCHASABLE_PLATES) {
    const priceCents = Math.round(plate.priceUsd * 100)
    const productName = `${plate.name} — Leaderboard Plate`
    let product = matchProduct(products, false, 'plate_id', plate.id, productName)
    if (!product && !check) {
      product = await polar.products.create({
        name: productName,
        description: plate.tagline,
        metadata: { plate_id: plate.id },
        prices: [{ amountType: 'fixed', priceAmount: priceCents }]
      })
      record('PLATES', plate.id, 'created', `${formatUsd(priceCents)} → ${product.id}`)
    } else if (!product) {
      record('PLATES', plate.id, 'missing', `would create at ${formatUsd(priceCents)}`)
    } else {
      const cents = fixedPriceCents(product)
      const metaOk = String(product.metadata['plate_id'] ?? '') === plate.id
      if (!metaOk && !check) {
        await polar.products.update({
          id: product.id,
          productUpdate: { metadata: { ...product.metadata, plate_id: plate.id } }
        })
      }
      const priceOk = cents === priceCents
      const detail = [
        priceOk ? formatUsd(priceCents) : `price drift: Polar has ${cents === null ? 'no fixed price' : formatUsd(cents)}, catalog says ${formatUsd(priceCents)}`,
        metaOk ? null : check ? 'plate_id metadata missing' : 'plate_id metadata added',
        `→ ${product.id}`
      ].filter(Boolean).join(' ')
      record('PLATES', plate.id, priceOk && (metaOk || !check) ? 'ok' : 'drift', detail)
    }
    if (product) {
      plateProductIds.push(product.id)
      plateMap[plate.id] = product.id
    }
  }

  const plateMapJson = JSON.stringify(plateMap)
  if (plateProductIds.length === PURCHASABLE_PLATES.length) {
    envEntries.push(['POLAR_PLATE_PRODUCT_MAP', plateMapJson])
    recordEnvState('PLATES', 'POLAR_PLATE_PRODUCT_MAP', plateMapJson, willWriteEnv)
  }

  // --- Leaderboard sponsor bid ----------------------------------------------
  {
    let product = matchProduct(
      products,
      false,
      'cribble_key',
      LEADERBOARD_BID.metaValue,
      LEADERBOARD_BID.name
    )
    if (!product && !check) {
      product = await polar.products.create({
        name: LEADERBOARD_BID.name,
        description: LEADERBOARD_BID.description,
        metadata: { cribble_key: LEADERBOARD_BID.metaValue },
        prices: [{ amountType: 'fixed', priceAmount: LEADERBOARD_BID.priceCents }]
      })
      record('LEADERBOARD', LEADERBOARD_BID.name, 'created', `${formatUsd(LEADERBOARD_BID.priceCents)} opening (ad-hoc priced per checkout) → ${product.id}`)
    } else if (!product) {
      record('LEADERBOARD', LEADERBOARD_BID.name, 'missing', `would create at the ${formatUsd(LEADERBOARD_BID.priceCents)} opening (ad-hoc priced per checkout)`)
    } else {
      // Catalog price is nominal (checkout always overrides it), so a
      // different stored price is reported like every other drift but
      // harms nothing.
      const cents = fixedPriceCents(product)
      const priceNote = cents === LEADERBOARD_BID.priceCents ? `${formatUsd(LEADERBOARD_BID.priceCents)} opening` : `price drift (cosmetic — checkouts are ad-hoc priced): Polar has ${cents === null ? 'no fixed price' : formatUsd(cents)}, catalog says ${formatUsd(LEADERBOARD_BID.priceCents)}`
      record('LEADERBOARD', LEADERBOARD_BID.name, cents === LEADERBOARD_BID.priceCents ? 'ok' : 'drift', `${priceNote} → ${product.id}`)
    }
    if (product) envEntries.push([LEADERBOARD_BID.envKey, product.id])
    recordEnvState('LEADERBOARD', LEADERBOARD_BID.envKey, product?.id ?? null, willWriteEnv)
  }

  // --- Billboard slot ---------------------------------------------------------
  {
    let product = matchProduct(
      products,
      false,
      'cribble_key',
      BILLBOARD_SLOT.metaValue,
      BILLBOARD_SLOT.name
    )
    if (!product && !check) {
      product = await polar.products.create({
        name: BILLBOARD_SLOT.name,
        description: BILLBOARD_SLOT.description,
        metadata: { cribble_key: BILLBOARD_SLOT.metaValue },
        prices: [{ amountType: 'fixed', priceAmount: BILLBOARD_SLOT.priceCents }]
      })
      record('BILLBOARD', BILLBOARD_SLOT.name, 'created', `${formatUsd(BILLBOARD_SLOT.priceCents)} sticker (ad-hoc grossed per checkout) → ${product.id}`)
    } else if (!product) {
      record('BILLBOARD', BILLBOARD_SLOT.name, 'missing', `would create at the ${formatUsd(BILLBOARD_SLOT.priceCents)} sticker (ad-hoc grossed per checkout)`)
    } else {
      // Catalog price is nominal (checkout always overrides it), so a
      // different stored price is reported like every other drift but
      // harms nothing.
      const cents = fixedPriceCents(product)
      const priceNote = cents === BILLBOARD_SLOT.priceCents ? `${formatUsd(BILLBOARD_SLOT.priceCents)} sticker` : `price drift (cosmetic — checkouts are ad-hoc priced): Polar has ${cents === null ? 'no fixed price' : formatUsd(cents)}, catalog says ${formatUsd(BILLBOARD_SLOT.priceCents)}`
      record('BILLBOARD', BILLBOARD_SLOT.name, cents === BILLBOARD_SLOT.priceCents ? 'ok' : 'drift', `${priceNote} → ${product.id}`)
    }
    if (product) envEntries.push([BILLBOARD_SLOT.envKey, product.id])
    recordEnvState('BILLBOARD', BILLBOARD_SLOT.envKey, product?.id ?? null, willWriteEnv)
  }

  // --- Pro plate discount --------------------------------------------------
  const discounts = await listAllDiscounts(polar)
  let discount =
    discounts.find((d) => String(d.metadata['cribble_key'] ?? '') === 'pro_plate_perk') ??
    discounts.find((d) => d.name === DISCOUNT_NAME) ??
    null

  if (!discount && !check && plateProductIds.length > 0) {
    discount = await polar.discounts.create({
      name: DISCOUNT_NAME,
      type: 'percentage',
      duration: 'once',
      basisPoints: DISCOUNT_BASIS_POINTS,
      products: plateProductIds,
      metadata: { cribble_key: 'pro_plate_perk' }
    })
    record('DISCOUNT', DISCOUNT_NAME, 'created', `25% off ${plateProductIds.length} plates → ${discount.id}`)
  } else if (!discount) {
    record('DISCOUNT', DISCOUNT_NAME, 'missing', 'would create a 25% once-per-order discount on all plates')
  } else {
    const covered = new Set(discount.products.map((p) => p.id))
    const missingProducts = plateProductIds.filter((id) => !covered.has(id))
    const percentOk = 'basisPoints' in discount && discount.basisPoints === DISCOUNT_BASIS_POINTS
    if (missingProducts.length > 0 && !check) {
      discount = await polar.discounts.update({
        id: discount.id,
        discountUpdate: { products: plateProductIds }
      })
      record('DISCOUNT', DISCOUNT_NAME, 'ok', `extended to ${missingProducts.length} new plate product(s) → ${discount.id}`)
    } else if (missingProducts.length > 0) {
      record('DISCOUNT', DISCOUNT_NAME, 'drift', `${missingProducts.length} plate product(s) not covered`)
    } else {
      record('DISCOUNT', DISCOUNT_NAME, percentOk ? 'ok' : 'drift', percentOk ? `25% on ${plateProductIds.length} plates → ${discount.id}` : 'discount is not 25% — fix in the dashboard')
    }
  }
  if (discount) envEntries.push(['POLAR_DISCOUNT_PRO_PLATES', discount.id])
  recordEnvState('DISCOUNT', 'POLAR_DISCOUNT_PRO_PLATES', discount?.id ?? null, willWriteEnv)

  // --- Webhook endpoint ----------------------------------------------------
  const baseUrl = resolveWebhookBaseUrl()
  if (!baseUrl) {
    record('WEBHOOK', '/api/webhooks/polar', 'skipped', 'no https URL — pass --url https://<domain> (localhost needs a tunnel)')
  } else {
    const webhookUrl = `${baseUrl}/api/webhooks/polar`
    const endpoints = await listAllWebhooks(polar)
    let endpoint = endpoints.find((e) => e.url === webhookUrl) ?? null
    if (!endpoint && !check) {
      endpoint = await polar.webhooks.createWebhookEndpoint({
        url: webhookUrl,
        name: 'Cribble shop',
        format: 'raw',
        events: WEBHOOK_EVENTS
      })
      record('WEBHOOK', webhookUrl, 'created', `${WEBHOOK_EVENTS.length} events → ${endpoint.id}`)
    } else if (!endpoint) {
      record('WEBHOOK', webhookUrl, 'missing', 'would create (raw format, subscription + order events)')
    } else {
      const existingEvents = new Set(endpoint.events.map((event) => String(event)))
      const missingEvents = WEBHOOK_EVENTS.filter((event) => !existingEvents.has(event))
      const formatOk = String(endpoint.format) === 'raw'
      if ((missingEvents.length > 0 || !formatOk) && !check) {
        endpoint = await polar.webhooks.updateWebhookEndpoint({
          id: endpoint.id,
          webhookEndpointUpdate: {
            format: 'raw',
            events: [...new Set([...endpoint.events, ...WEBHOOK_EVENTS])]
          }
        })
        record('WEBHOOK', webhookUrl, 'ok', `updated (${missingEvents.length} event(s) added${formatOk ? '' : ', format set to raw'}) → ${endpoint.id}`)
      } else if (missingEvents.length > 0 || !formatOk) {
        record('WEBHOOK', webhookUrl, 'drift', formatOk ? `missing events: ${missingEvents.join(', ')}` : 'format is not raw')
      } else {
        record('WEBHOOK', webhookUrl, 'ok', `raw format, all events → ${endpoint.id}`)
      }
    }
    if (endpoint) envEntries.push(['POLAR_WEBHOOK_SECRET', endpoint.secret])
    recordEnvState('WEBHOOK', 'POLAR_WEBHOOK_SECRET', endpoint?.secret ?? null, willWriteEnv)
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
    console.log(`POLAR_SERVER=${server}`)
    for (const [key, value] of envEntries) console.log(`${key}=${value}`)
    if (willWriteEnv) {
      upsertEnvLocal(envEntries)
      console.log(`\nWrote ${envEntries.length} var(s) to ${ENV_FILE}`)
    }
  }

  console.log('\nNotes')
  console.log('  - Restart the dev server / redeploy after changing env vars.')

  if (check && driftCount > 0) {
    console.log(`\n${driftCount} item(s) missing or drifted — run without --check to provision.`)
    process.exit(1)
  }
}

main().catch((error: unknown) => {
  console.error('\nSetup failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
