// Provisions the Dodo Payments test (or live) catalog for the Cribble shop:
//
//   - Pro subscription products   (monthly $6.99, yearly $49.99)
//   - Team subscription products  (monthly $50, yearly $500)
//   - one one-time product per purchasable plate, with `plate_id` metadata
//   - the 25% "Pro Plate Perk" discount, restricted to plate products
//   - the webhook endpoint pointing at /api/webhooks/dodo
//   - support email on the primary brand, when it is empty
//
// Idempotent: existing objects are matched by metadata (pro_key / team_key /
// plate_id / cribble_key) and reused. Prices are compared and drift is
// reported — Dodo does not allow changing a product's price in place.
//
//   npx vite-node scripts/setup-dodo.ts
//   npx vite-node scripts/setup-dodo.ts --check
//   npx vite-node scripts/setup-dodo.ts --write-env
//   npx vite-node scripts/setup-dodo.ts --url https://cribble.dev
//   npx vite-node scripts/setup-dodo.ts --live
//
// Needs DODO_PAYMENTS_API_KEY in .env.local. Defaults to test_mode unless
// DODO_PAYMENTS_ENVIRONMENT=live_mode AND --live is passed.

import fs from 'node:fs'
import path from 'node:path'
import DodoPayments from 'dodopayments'
import type { Discount } from 'dodopayments/resources/discounts'
import type { Product, ProductListResponse } from 'dodopayments/resources/products/products'
import type { WebhookDetails } from 'dodopayments/resources/webhooks/webhooks'
import type { WebhookEventType } from 'dodopayments/resources/webhook-events'
import { PLATES, type PlateDef } from '../src/lib/cosmetics/plates'
import { getDodoEnvironment } from '../src/lib/dodo'

const ENV_FILE = process.env.DODO_SETUP_ENV_FILE
  ? path.resolve(process.env.DODO_SETUP_ENV_FILE)
  : path.resolve(__dirname, '../.env.local')

const SUPPORT_EMAIL = 'Birdabo@Cribble.dev'
const SHOP_BRAND_NAME = 'Cribble'
const DISCOUNT_CODE = 'CRIBBLEPRO25'
const DISCOUNT_BPS = 2500

const WEBHOOK_EVENTS: WebhookEventType[] = [
  'payment.succeeded',
  'refund.succeeded',
  'subscription.active',
  'subscription.plan_changed',
  'subscription.cancelled',
  'subscription.expired',
  'subscription.failed'
]

interface DesiredSubscription {
  key: 'pro_monthly' | 'pro_yearly' | 'team_monthly' | 'team_yearly'
  metaKey: 'pro_key' | 'team_key'
  envKey: string
  name: string
  description: string
  priceCents: number
  interval: 'Month' | 'Year'
}

const SUBSCRIPTIONS: DesiredSubscription[] = [
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
  },
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

interface ReportRow {
  section: string
  label: string
  status: string
  detail: string
}

const report: ReportRow[] = []
let driftCount = 0

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

function record(section: string, label: string, status: string, detail: string) {
  if (status === 'missing' || status === 'drift') driftCount += 1
  report.push({ section, label, status, detail })
}

function upsertEnvLocal(entries: Array<[string, string]>) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''
  for (const [key, value] of entries) {
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    if (pattern.test(text)) text = text.replace(pattern, line)
    else {
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
  return 'https://cribble.dev'
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function metaValue(product: ProductListResponse, key: string): string {
  const value = product.metadata?.[key]
  return typeof value === 'string' ? value : ''
}

function priceCents(product: ProductListResponse): number | null {
  return typeof product.price === 'number' ? product.price : null
}

function asListed(product: Product): ProductListResponse {
  const cents =
    product.price.type === 'one_time_price' || product.price.type === 'recurring_price'
      ? product.price.price
      : null
  return {
    business_id: product.business_id,
    created_at: product.created_at,
    entitlements: product.entitlements,
    is_recurring: product.is_recurring,
    metadata: product.metadata,
    product_id: product.product_id,
    tax_category: product.tax_category,
    updated_at: product.updated_at,
    name: product.name,
    price: cents
  }
}

async function listIterated<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iterable) items.push(item)
  return items
}

/** Product and discount lists are 0-indexed. The SDK's auto-pager assumes
 *  page 1 and then asks for page 2, which skips everything after the first page. */
async function listPaged<T>(
  fetchPage: (page: number) => Promise<{ items?: T[] | null }>
): Promise<T[]> {
  const items: T[] = []
  for (let page = 0; page < 50; page += 1) {
    const result = await fetchPage(page)
    const batch = result.items ?? []
    items.push(...batch)
    if (batch.length < 100) break
  }
  return items
}

async function main() {
  loadEnvLocal()
  const check = hasFlag('--check')
  const writeEnv = hasFlag('--write-env')
  const environment = getDodoEnvironment()
  if (environment === 'live_mode' && !check && !hasFlag('--live')) {
    console.error('DODO_PAYMENTS_ENVIRONMENT=live_mode — pass --live to confirm writes against the live business.')
    process.exit(1)
  }
  const token = process.env.DODO_PAYMENTS_API_KEY
  if (!token) {
    console.error('DODO_PAYMENTS_API_KEY is not set in .env.local.')
    process.exit(1)
  }

  const client = new DodoPayments({ bearerToken: token, environment })
  console.log(`Dodo setup — ${environment}${check ? ' (check only)' : ''}\n`)

  const brandList = await client.brands.list()
  const brands = brandList.items
  // The primary brand id is the business id (bus_…). Dodo rejects updates
  // to it, and the dashboard has no field for its support email. Checkout
  // uses a normal brand (brnd_…) instead.
  let shopBrand =
    brands.find(
      (item) =>
        item.brand_id.startsWith('brnd_') &&
        (item.support_email ?? '').toLowerCase() === SUPPORT_EMAIL.toLowerCase()
    ) ?? brands.find((item) => item.brand_id.startsWith('brnd_') && item.name === SHOP_BRAND_NAME)
  if (!shopBrand && !check) {
    shopBrand = await client.brands.create({
      name: SHOP_BRAND_NAME,
      support_email: SUPPORT_EMAIL,
      url: 'https://cribble.dev'
    })
    record('BRAND', SHOP_BRAND_NAME, 'created', `support ${SUPPORT_EMAIL}`)
  } else if (
    shopBrand &&
    (shopBrand.support_email ?? '').toLowerCase() !== SUPPORT_EMAIL.toLowerCase() &&
    !check
  ) {
    shopBrand = await client.brands.update(shopBrand.brand_id, {
      support_email: SUPPORT_EMAIL,
      url: 'https://cribble.dev'
    })
    record('BRAND', shopBrand.name ?? SHOP_BRAND_NAME, 'ok', `support ${SUPPORT_EMAIL}`)
  } else if (shopBrand) {
    record(
      'BRAND',
      shopBrand.name ?? SHOP_BRAND_NAME,
      'ok',
      `support ${shopBrand.support_email ?? SUPPORT_EMAIL}`
    )
  } else {
    record('BRAND', SHOP_BRAND_NAME, 'missing', `would create with support ${SUPPORT_EMAIL}`)
  }
  const shopBrandId = shopBrand?.brand_id ?? null

  const products = await listPaged((page) =>
    client.products.list({ page_number: page, page_size: 100 })
  )
  const envEntries: Array<[string, string]> = []

  for (const sub of SUBSCRIPTIONS) {
    const matches = products.filter(
      (item) => metaValue(item, sub.metaKey) === sub.key || item.name === sub.name
    )
    let product = matches.find((item) => priceCents(item) === sub.priceCents) ?? matches[0] ?? null
    if (!check) {
      for (const extra of matches) {
        if (extra.product_id === product?.product_id) continue
        await client.products.archive(extra.product_id)
        record('SUBSCRIPTIONS', sub.name, 'ok', `archived duplicate ${extra.product_id}`)
      }
    }
    if (!product && !check) {
      const created = await client.products.create({
        name: sub.name,
        description: sub.description,
        tax_category: 'saas',
        ...(shopBrandId ? { brand_id: shopBrandId } : {}),
        metadata: { [sub.metaKey]: sub.key },
        price: {
          type: 'recurring_price',
          currency: 'USD',
          price: sub.priceCents,
          discount: 0,
          payment_frequency_count: 1,
          payment_frequency_interval: sub.interval,
          subscription_period_count: 1,
          subscription_period_interval: sub.interval,
          purchasing_power_parity: false
        }
      })
      product = asListed(created)
      products.push(product)
      record('SUBSCRIPTIONS', sub.name, 'created', `${formatUsd(sub.priceCents)}/${sub.interval} → ${product.product_id}`)
    } else if (!product) {
      record('SUBSCRIPTIONS', sub.name, 'missing', `would create at ${formatUsd(sub.priceCents)}/${sub.interval}`)
    } else {
      const cents = priceCents(product)
      const ok = cents === sub.priceCents
      record(
        'SUBSCRIPTIONS',
        sub.name,
        ok ? 'ok' : 'drift',
        `${ok ? formatUsd(sub.priceCents) : `price drift: Dodo has ${cents === null ? 'no fixed price' : formatUsd(cents)}`} → ${product.product_id}`
      )
    }
    if (product && shopBrandId && !check) {
      await client.products.update(product.product_id, { brand_id: shopBrandId })
    }
    if (product) envEntries.push([sub.envKey, product.product_id])
  }

  const plateMap: Record<string, string> = {}
  for (const plate of PURCHASABLE_PLATES) {
    const price = Math.round(plate.priceUsd * 100)
    const productName = `${plate.name} — Leaderboard Plate`
    let product =
      products.find((item) => metaValue(item, 'plate_id') === plate.id) ??
      products.find((item) => item.name === productName) ??
      null
    if (!product && !check) {
      const created = await client.products.create({
        name: productName,
        description: plate.tagline,
        tax_category: 'digital_products',
        ...(shopBrandId ? { brand_id: shopBrandId } : {}),
        metadata: { plate_id: plate.id },
        price: {
          type: 'one_time_price',
          currency: 'USD',
          price,
          discount: 0,
          purchasing_power_parity: false
        }
      })
      product = asListed(created)
      products.push(product)
      record('PLATES', plate.id, 'created', `${formatUsd(price)} → ${product.product_id}`)
    } else if (!product) {
      record('PLATES', plate.id, 'missing', `would create at ${formatUsd(price)}`)
    } else {
      const cents = priceCents(product)
      const ok = cents === price
      record(
        'PLATES',
        plate.id,
        ok ? 'ok' : 'drift',
        `${ok ? formatUsd(price) : `price drift: Dodo has ${cents === null ? 'no fixed price' : formatUsd(cents)}`} → ${product.product_id}`
      )
    }
    if (product && shopBrandId && !check) {
      await client.products.update(product.product_id, { brand_id: shopBrandId })
    }
    if (product) plateMap[plate.id] = product.product_id
  }

  if (Object.keys(plateMap).length === PURCHASABLE_PLATES.length) {
    envEntries.push(['DODO_PLATE_PRODUCT_MAP', JSON.stringify(plateMap)])
  }

  const plateIds = Object.values(plateMap)
  const discounts = await listPaged((page) =>
    client.discounts.list({ page_number: page, page_size: 100 })
  )
  let discount: Discount | null =
    discounts.find((item) => String(item.metadata?.['cribble_key'] ?? '') === 'pro_plate_perk') ??
    discounts.find((item) => item.code === DISCOUNT_CODE) ??
    null
  if (!discount && !check && plateIds.length > 0) {
    discount = await client.discounts.create({
      name: 'Pro Plate Perk',
      code: DISCOUNT_CODE,
      type: 'percentage',
      amount: DISCOUNT_BPS,
      restricted_to: plateIds,
      subscription_cycles: 1,
      metadata: { cribble_key: 'pro_plate_perk' }
    })
    record('DISCOUNT', DISCOUNT_CODE, 'created', `25% off ${plateIds.length} plates`)
  } else if (!discount) {
    record('DISCOUNT', DISCOUNT_CODE, 'missing', 'would create a 25% plate discount')
  } else {
    const covered = new Set(discount.restricted_to ?? [])
    const missing = plateIds.filter((id) => !covered.has(id))
    const percentOk = discount.amount === DISCOUNT_BPS
    if ((missing.length > 0 || !percentOk) && !check) {
      discount = await client.discounts.update(discount.discount_id, {
        restricted_to: plateIds,
        amount: DISCOUNT_BPS
      })
      record('DISCOUNT', DISCOUNT_CODE, 'ok', `updated coverage (${plateIds.length} plates)`)
    } else {
      record('DISCOUNT', DISCOUNT_CODE, missing.length === 0 && percentOk ? 'ok' : 'drift', discount.code)
    }
  }
  if (discount) envEntries.push(['DODO_DISCOUNT_PRO_PLATES', discount.code])

  const baseUrl = resolveWebhookBaseUrl()
  if (baseUrl) {
    const webhookUrl = `${baseUrl}/api/webhooks/dodo`
    const hooks = await listIterated(client.webhooks.list())
    const matches = hooks.filter((item) => item.url === webhookUrl)
    let hook: WebhookDetails | null = matches[0] ?? null
    if (!check) {
      for (const extra of matches.slice(1)) {
        await client.webhooks.delete(extra.id)
        record('WEBHOOK', webhookUrl, 'ok', `deleted duplicate ${extra.id}`)
      }
    }
    if (!hook && !check) {
      hook = await client.webhooks.create({
        url: webhookUrl,
        description: 'Cribble shop',
        filter_types: WEBHOOK_EVENTS,
        metadata: { cribble_key: 'shop' }
      })
      record('WEBHOOK', webhookUrl, 'created', `${WEBHOOK_EVENTS.length} events → ${hook.id}`)
    } else if (!hook) {
      record('WEBHOOK', webhookUrl, 'missing', 'would create')
    } else {
      const existing = new Set(hook.filter_types ?? [])
      const missing = WEBHOOK_EVENTS.filter((event) => !existing.has(event))
      if (missing.length > 0 && !check) {
        hook = await client.webhooks.update(hook.id, { filter_types: WEBHOOK_EVENTS })
        record('WEBHOOK', webhookUrl, 'ok', `added ${missing.length} event(s)`)
      } else {
        record('WEBHOOK', webhookUrl, missing.length === 0 ? 'ok' : 'drift', hook.id)
      }
    }
    if (hook && writeEnv && !check) {
      const secret = await client.webhooks.retrieveSecret(hook.id)
      envEntries.push(['DODO_PAYMENTS_WEBHOOK_KEY', secret.secret])
      record('WEBHOOK', 'DODO_PAYMENTS_WEBHOOK_KEY', 'ok', 'signing secret stored in env file')
    } else if (hook && !process.env.DODO_PAYMENTS_WEBHOOK_KEY) {
      record('WEBHOOK', 'DODO_PAYMENTS_WEBHOOK_KEY', 'missing', 'pass --write-env to store the signing secret')
    }
  }

  let section = ''
  for (const row of report) {
    if (row.section !== section) {
      section = row.section
      console.log(section)
    }
    console.log(`  [${row.status.padEnd(7)}] ${row.label.padEnd(36)} ${row.detail}`)
  }

  if (writeEnv && !check && envEntries.length > 0) {
    upsertEnvLocal(envEntries)
    console.log(`\nWrote ${envEntries.length} var(s) to ${ENV_FILE}`)
  } else if (envEntries.length > 0) {
    console.log('\nEnv keys ready (values omitted). Re-run with --write-env to store them.')
  }

  if (check && driftCount > 0) process.exit(1)
}

main().catch((error: unknown) => {
  console.error('\nSetup failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
