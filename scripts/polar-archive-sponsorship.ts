// Archives the two sponsorship products in the Polar organization:
//
//   - "Leaderboard Sponsor Bid"      (metadata cribble_key = leaderboard_bid)
//   - "Billboard Slot Sponsorship"   (metadata cribble_key = billboard_slot)
//
// Polar's account review required these offerings to be removed. Archiving
// keeps the order history but makes the products unpurchasable. Products are
// matched by cribble_key metadata, with the exact name as fallback, among
// non-recurring, non-archived products only — Pro/Team subscriptions, plate
// products and discounts are never touched.
//
//   npx vite-node scripts/polar-archive-sponsorship.ts               # archive
//   npx vite-node scripts/polar-archive-sponsorship.ts --check       # read-only: list what would be archived
//   npx vite-node scripts/polar-archive-sponsorship.ts --production  # required when POLAR_SERVER=production
//
// Needs POLAR_ACCESS_TOKEN in .env.local (org token; sandbox.polar.sh while
// POLAR_SERVER=sandbox).

import fs from 'node:fs'
import path from 'node:path'
import { Polar } from '@polar-sh/sdk'
import type { Product } from '@polar-sh/sdk/models/components/product'
import { getPolarServer } from '../src/lib/polar'

// POLAR_SETUP_ENV_FILE redirects the env source (tests, .env.production)
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

// ---------------------------------------------------------------------------

interface SponsorshipProduct {
  /** `cribble_key` metadata value stamped by scripts/setup-polar.ts. */
  metaValue: string
  /** Exact catalog name, used only when the metadata is missing. */
  name: string
  /** Env var that held the product id; removed once the product is gone. */
  envKey: string
}

const SPONSORSHIP_PRODUCTS: SponsorshipProduct[] = [
  {
    metaValue: 'leaderboard_bid',
    name: 'Leaderboard Sponsor Bid',
    envKey: 'POLAR_PRODUCT_LEADERBOARD_BID'
  },
  {
    metaValue: 'billboard_slot',
    name: 'Billboard Slot Sponsorship',
    envKey: 'POLAR_PRODUCT_BILLBOARD_SLOT'
  }
]

async function listAllProducts(polar: Polar): Promise<Product[]> {
  const products: Product[] = []
  const pages = await polar.products.list({ isArchived: false, limit: 100 })
  for await (const page of pages) products.push(...page.result.items)
  return products
}

/** Non-recurring products carrying one of the sponsorship cribble_keys, or
 *  failing that, bearing the exact sponsorship name. Deduplicated by id so a
 *  product matching both ways is archived once. */
function selectSponsorshipProducts(products: Product[]): Product[] {
  const oneTime = products.filter((product) => !product.isRecurring)
  const selected = new Map<string, Product>()
  for (const target of SPONSORSHIP_PRODUCTS) {
    const byMeta = oneTime.filter(
      (product) => String(product.metadata['cribble_key'] ?? '') === target.metaValue
    )
    const matches = byMeta.length > 0 ? byMeta : oneTime.filter((product) => product.name === target.name)
    for (const product of matches) selected.set(product.id, product)
  }
  return [...selected.values()]
}

async function main() {
  loadEnvLocal()

  const check = hasFlag('--check')
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
  console.log(`Polar archive sponsorship — ${server}${check ? ' (check only, nothing will be archived)' : ''}\n`)

  const products = await listAllProducts(polar)
  const targets = selectSponsorshipProducts(products)

  if (targets.length === 0) {
    console.log('No active sponsorship products found — nothing to archive.')
  }

  for (const product of targets) {
    if (check) {
      console.log(`[would archive] ${product.name} -> ${product.id}`)
      continue
    }
    await polar.products.update({ id: product.id, productUpdate: { isArchived: true } })
    console.log(`[archived] ${product.name} -> ${product.id}`)
  }

  console.log('\nNotes')
  console.log(`  - Remove ${SPONSORSHIP_PRODUCTS.map((p) => p.envKey).join(' and ')} from .env.local and the Vercel project env.`)
}

main().catch((error: unknown) => {
  console.error('\nArchive failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
