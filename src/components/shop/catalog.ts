// Shop catalog slices — pure data + helpers, no React. These are the
// storefront's views over the plate catalog (src/lib/cosmetics/plates.ts),
// shared by shop/page.tsx and the shop section components (marquee fan,
// grids, Pro cards, gold row).

import { PLATES, type PlateDef, type PlateRarity } from '@/lib/cosmetics/plates'

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

/** The marquee fan's curated featured five, in visual left-to-right order —
 * prime-anomaly is the center card. */
export const MARQUEE_PLATE_IDS: string[] = [
  'founder',
  'event-horizon',
  'prime-anomaly',
  'koi-pond',
  'season-01-ignition'
]

/** MARQUEE_PLATE_IDS resolved against the catalog, order preserved. Ids
 * missing from the catalog are dropped, so a catalog edit can thin the fan
 * but never crash it. */
export const MARQUEE_PLATES: PlateDef[] = MARQUEE_PLATE_IDS.map((id) =>
  PLATES.find((plate) => plate.id === id)
).filter((plate): plate is PlateDef => plate !== undefined)

/** Cross-component anchor contract: shelf/gold cards set
 * `id={plateAnchorId(plate.id)}` on their card root; the marquee fan
 * scrolls to those anchors. */
export const plateAnchorId = (plateId: string) => `plate-${plateId}`
