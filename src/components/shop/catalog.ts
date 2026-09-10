// Shop catalog slices — pure data + helpers, no React. These are the
// storefront's views over the plate catalog (src/lib/cosmetics/plates.ts),
// shared by shop/page.tsx and the shop section components (featured stage,
// catalog index, ticker, grids, Pro cards, gold row, spec drawer). Every
// word of chrome copy (section names, the Japanese glossary, the ticker)
// lives here too, so the components never invent filler.

import { PLATES, PLATE_RARITY_META, type PlateDef, type PlateRarity } from '@/lib/cosmetics/plates'

/** A catalog plate narrowed to "actually purchasable": priceUsd is set. */
export type ShopPlate = PlateDef & { priceUsd: number }

/** Storefront order: the seasonal drop leads, then rarity descending —
 * most premium at the top of the rack, catalog order within ties. */
export const RARITY_ORDER: Record<PlateRarity, number> = {
  mythic: 0,
  legendary: 1,
  epic: 2,
  rare: 3,
  common: 4
}

/** The one-run vault drop. Sold from its own gold band, never the grid —
 * and only while the catalog prices it (retiring the run = priceUsd back
 * to null, which also makes the checkout route refuse it). */
export const FOUNDER_PLATE_ID = 'founder'

export const SHOP_PLATES: ShopPlate[] = PLATES.filter(
  (plate): plate is ShopPlate =>
    plate.priceUsd !== null && plate.id !== FOUNDER_PLATE_ID && plate.rarity !== 'mythic'
).sort(
  (a, b) =>
    Number(Boolean(b.seasonal)) - Number(Boolean(a.seasonal)) ||
    RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]
)

/** The Reserve — the mythic class, sold from its own shelf above the grid,
 * cheapest first so the shelf reads as a ladder up to the flagship. */
export const RESERVE_PLATES: ShopPlate[] = PLATES.filter(
  (plate): plate is ShopPlate => plate.rarity === 'mythic' && plate.priceUsd !== null
).sort((a, b) => a.priceUsd - b.priceUsd)

/** Mythic specimen copy: a short kicker on the card, plus parked "what's
 * alive" lines for a future detail surface. */
export const RESERVE_NOTES: Record<string, { kicker: string; alive: string[] }> = {
  'koi-pond': {
    kicker: 'WATER, CHOREOGRAPHED',
    alive: [
      'Three koi swim their own laps — the Kohaku rises to kiss the surface, rings and all',
      'An unseen fourth tugs the lily pad from below; petals cast off the lotus, a dragonfly visits',
      'Hover blooms the sunlight — caustic webs, breathing shafts and the swell sheen lift as one'
    ]
  },
  'event-horizon': {
    kicker: 'A LIVING SCENE',
    alive: [
      'The disk shears at three speeds and light orbits the photon ring every 3.5s',
      'Every 45 seconds a star wanders too close, stretches into a filament and sets the disk flaring',
      'The approaching limb flashes white-hot each pass; hover feeds the disk and pulls the well closer'
    ]
  },
  'prime-anomaly': {
    kicker: 'THE FLAGSHIP',
    alive: [
      'Every 45 seconds the crack gives and blinding light floods through the sky',
      'The fracture glows from inside at rest; RGB-split ticks warn right before it goes',
      'Hover tears it open and holds it — the light churns, dust escapes, it knows you are looking'
    ]
  }
}

export const PRO_PLATES: PlateDef[] = PLATES.filter((plate) => plate.proExclusive)

export const FOUNDER_PLATE: ShopPlate | null =
  PLATES.find(
    (plate): plate is ShopPlate => plate.id === FOUNDER_PLATE_ID && plate.priceUsd !== null
  ) ?? null

export const CHAMPION_PLATE: PlateDef | null =
  PLATES.find((plate) => plate.championExclusive) ?? null

/** Pro shop discount: 25% off in cents-math so $X.99 stays a tidy .49/.99. */
export const proPrice = (priceUsd: number) => Math.round(priceUsd * 100 * 0.75) / 100
export const usd = (n: number) => `$${n.toFixed(2)}`

/** The featured stage's curated five, in thumb-rail order — prime-anomaly
 * leads so it is the plate on the stage before anyone clicks. */
export const FEATURED_PLATE_IDS: string[] = [
  'prime-anomaly',
  'event-horizon',
  'koi-pond',
  'season-01-ignition',
  'founder'
]

/** FEATURED_PLATE_IDS resolved against the catalog, order preserved. Ids
 * missing from the catalog are dropped, so a catalog edit can thin the rail
 * but never crash it. */
export const FEATURED_PLATES: PlateDef[] = FEATURED_PLATE_IDS.map((id) =>
  PLATES.find((plate) => plate.id === id)
).filter((plate): plate is PlateDef => plate !== undefined)

/** Cross-component anchor contract: shelf/gold cards set
 * `id={plateAnchorId(plate.id)}` on their card root; the featured stage
 * and the catalog index scroll to those anchors. */
export const plateAnchorId = (plateId: string) => `plate-${plateId}`

/* ---- storefront chrome copy ---- */

/** The five indexed sections, in page order. `index` is the printed `NN`,
 * `anchor` the section element id the sticky catalog index scrolls to. */
export type ShopSectionId = 'featured' | 'pro' | 'mythic' | 'plates' | 'vault'

export interface ShopSection {
  id: ShopSectionId
  index: string
  label: string
  jp: string
  anchor: string
}

export const SHOP_SECTIONS: readonly ShopSection[] = [
  { id: 'featured', index: '01', label: 'FEATURED', jp: '特集', anchor: 'shop-featured' },
  { id: 'pro', index: '02', label: 'PRO', jp: 'プロ', anchor: 'shop-pro' },
  { id: 'mythic', index: '03', label: 'MYTHIC', jp: '神話級', anchor: 'shop-mythic' },
  { id: 'plates', index: '04', label: 'PLATES', jp: 'プレート', anchor: 'shop-plates' },
  { id: 'vault', index: '05', label: 'VAULT', jp: '保管庫', anchor: 'shop-vault' }
]

/** The Japanese glossary — every katakana/kanji kicker on the floor comes
 * from here and is always printed beside its English word. */
export const JP = {
  shop: 'ショップ',
  plate: 'プレート',
  featured: '特集',
  pro: 'プロ',
  mythic: '神話級',
  legendary: '伝説',
  limited: '限定',
  owned: '所持済',
  equip: '装備',
  buy: '購入',
  spec: '仕様',
  vault: '保管庫',
  season01: 'シーズン01',
  rankEarned: '順位は実力で',
  champion: '王者',
  founder: '創設者'
} as const

/** Ticker strip segments, in loop order — English and Japanese interleaved.
 * The track renders them twice for a seamless loop; the strip itself is
 * aria-hidden and TICKER_SENTENCE stands in for readers. */
export const TICKER_SEGMENTS: readonly string[] = [
  'SEASON 01 · IGNITION',
  'シーズン01',
  'PLATES FOR THE BOARD',
  'プレート',
  'RANK STAYS EARNED',
  '順位は実力で',
  'COSMETIC ONLY',
  'USD · POLAR',
  'ショップ'
]

export const TICKER_SENTENCE =
  'Season 01 Ignition: plates for the board, rank stays earned, cosmetic only, priced in USD through Polar.'

/** Rarity in Japanese — the kicker beside every English rarity label. */
export function rarityJp(rarity: PlateRarity): string {
  switch (rarity) {
    case 'common':
      return '一般'
    case 'rare':
      return '希少'
    case 'epic':
      return '上級'
    case 'legendary':
      return '伝説'
    case 'mythic':
      return '神話級'
    default: {
      const exhaustive: never = rarity
      return exhaustive
    }
  }
}

/** 'WATER, CHOREOGRAPHED' → 'Water, Choreographed'. */
const titleCase = (text: string) =>
  text.toLowerCase().replace(/(^|[\s(])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase())

/** The kicker pair printed above a plate name on cards, the stage and the
 * spec drawer: mythics carry their RESERVE_NOTES kicker, everything else
 * its rarity; the Japanese side is the rarity, with `· 限定` appended for
 * seasonal drops. */
export function plateKicker(plate: PlateDef): { en: string; jp: string } {
  const note = plate.rarity === 'mythic' ? RESERVE_NOTES[plate.id] : undefined
  const en = note ? titleCase(note.kicker) : PLATE_RARITY_META[plate.rarity].label
  const jp = plate.seasonal ? `${rarityJp(plate.rarity)} · ${JP.limited}` : rarityJp(plate.rarity)
  return { en, jp }
}

/** Every purchasable plate in storefront order: the Reserve shelf, then the
 * grid, then the vault's founder drop. This is what the printed `/NN`
 * index on every card counts through. */
const STOREFRONT_ORDER: ShopPlate[] = [
  ...RESERVE_PLATES,
  ...SHOP_PLATES,
  ...(FOUNDER_PLATE ? [FOUNDER_PLATE] : [])
]

/** Zero-padded two-digit catalog position (`'01'`…), or `'--'` for plates
 * that are not for sale (Pro / champion / beta exclusives). */
export function plateIndex(plateId: string): string {
  const at = STOREFRONT_ORDER.findIndex((plate) => plate.id === plateId)
  return at === -1 ? '--' : String(at + 1).padStart(2, '0')
}
