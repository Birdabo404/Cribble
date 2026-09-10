import { describe, expect, it } from 'vitest'
import { PLATES } from '@/lib/cosmetics/plates'
import {
  FEATURED_PLATES,
  FEATURED_PLATE_IDS,
  FOUNDER_PLATE,
  JP,
  PRO_PLATES,
  RESERVE_PLATES,
  SHOP_PLATES,
  SHOP_SECTIONS,
  TICKER_SEGMENTS,
  TICKER_SENTENCE,
  plateIndex,
  plateKicker,
  proPrice,
  rarityJp,
  usd
} from './catalog'

/** Every plate the storefront prints a price for, in section order. */
const purchasable = [...RESERVE_PLATES, ...SHOP_PLATES, ...(FOUNDER_PLATE ? [FOUNDER_PLATE] : [])]

describe('FEATURED_PLATES', () => {
  it('resolves all five ids against the catalog, order preserved', () => {
    expect(FEATURED_PLATE_IDS).toEqual([
      'prime-anomaly',
      'event-horizon',
      'koi-pond',
      'season-01-ignition',
      'founder'
    ])
    expect(FEATURED_PLATES.map((plate) => plate.id)).toEqual(FEATURED_PLATE_IDS)
  })

  it('leads with the flagship so it is the default stage plate', () => {
    expect(FEATURED_PLATES[0]?.id).toBe('prime-anomaly')
  })
})

describe('proPrice', () => {
  it('takes 25% off in cents so $X.99 stays tidy', () => {
    expect(proPrice(1.99)).toBe(1.49)
    expect(proPrice(3.99)).toBe(2.99)
    expect(proPrice(30)).toBe(22.5)
  })

  it('formats through usd with two decimals', () => {
    expect(usd(proPrice(30))).toBe('$22.50')
    expect(usd(proPrice(1.99))).toBe('$1.49')
  })
})

describe('SHOP_SECTIONS', () => {
  it('is indexed 01..05 in page order', () => {
    expect(SHOP_SECTIONS.map((section) => section.index)).toEqual(['01', '02', '03', '04', '05'])
    expect(SHOP_SECTIONS.map((section) => section.id)).toEqual([
      'featured',
      'pro',
      'mythic',
      'plates',
      'vault'
    ])
  })

  it('has unique anchors and a Japanese kicker for every section', () => {
    const anchors = SHOP_SECTIONS.map((section) => section.anchor)
    expect(new Set(anchors).size).toBe(anchors.length)
    for (const section of SHOP_SECTIONS) {
      expect(section.anchor).toMatch(/^shop-[a-z]+$/)
      expect(section.label.length).toBeGreaterThan(0)
      expect(section.jp.length).toBeGreaterThan(0)
    }
  })

  it('draws its kickers from the glossary', () => {
    const byId = Object.fromEntries(SHOP_SECTIONS.map((section) => [section.id, section.jp]))
    expect(byId).toEqual({
      featured: JP.featured,
      pro: JP.pro,
      mythic: JP.mythic,
      plates: JP.plate,
      vault: JP.vault
    })
  })
})

describe('plateIndex', () => {
  it('is two digits for every purchasable plate', () => {
    for (const plate of purchasable) {
      expect(plateIndex(plate.id)).toMatch(/^\d{2}$/)
    }
  })

  it('counts the Reserve first, then the grid, then the founder drop', () => {
    expect(plateIndex(purchasable[0].id)).toBe('01')
    expect(plateIndex(purchasable[purchasable.length - 1].id)).toBe(
      String(purchasable.length).padStart(2, '0')
    )
    if (FOUNDER_PLATE) {
      expect(plateIndex(FOUNDER_PLATE.id)).toBe(String(purchasable.length).padStart(2, '0'))
    }
  })

  it('never repeats an index', () => {
    const indices = purchasable.map((plate) => plateIndex(plate.id))
    expect(new Set(indices).size).toBe(indices.length)
  })

  it('prints -- for plates that are not for sale', () => {
    for (const plate of PRO_PLATES) {
      expect(plateIndex(plate.id)).toBe('--')
    }
    expect(plateIndex('no-such-plate')).toBe('--')
  })
})

describe('plateKicker', () => {
  it('returns a non-empty en/jp pair for every catalog plate', () => {
    for (const plate of PLATES) {
      const kicker = plateKicker(plate)
      expect(kicker.en.length).toBeGreaterThan(0)
      expect(kicker.jp.length).toBeGreaterThan(0)
    }
  })

  it('title-cases the Reserve kicker for mythics', () => {
    const flagship = PLATES.find((plate) => plate.id === 'prime-anomaly')
    expect(flagship).toBeDefined()
    if (!flagship) return
    expect(plateKicker(flagship)).toEqual({ en: 'The Flagship', jp: '神話級' })
  })

  it('marks seasonal drops as limited on the Japanese side', () => {
    const seasonal = PLATES.find((plate) => plate.seasonal)
    expect(seasonal).toBeDefined()
    if (!seasonal) return
    const kicker = plateKicker(seasonal)
    expect(kicker.jp.endsWith(`· ${JP.limited}`)).toBe(true)
    expect(kicker.jp.startsWith(rarityJp(seasonal.rarity))).toBe(true)
  })
})

describe('ticker', () => {
  it('interleaves English and Japanese segments', () => {
    expect(TICKER_SEGMENTS.length).toBeGreaterThan(0)
    expect(TICKER_SEGMENTS).toContain(JP.shop)
    expect(TICKER_SEGMENTS).toContain(JP.season01)
    expect(TICKER_SENTENCE.trim().length).toBeGreaterThan(0)
  })
})
