import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS, type AchievementUnit } from '@/lib/achievements'
import { PLATES, getPlate, type PlateDef } from '@/lib/cosmetics/plates'
import {
  NEUTRAL_BADGES,
  NEUTRAL_COSMETICS,
  STATUS_META,
  acquisitionLine,
  badgeSerial,
  countUnlocked,
  countUsable,
  defaultBadgeSelection,
  defaultPlateSelection,
  filterBadges,
  filterPlates,
  formatProgressValue,
  plateSerial,
  revStamp,
  statusFor,
  usableIdsFor,
  type AchievementRow,
  type CosmeticsData
} from './bagModel'

const plate = (id: string): PlateDef => {
  const found = getPlate(id)
  if (!found) throw new Error(`Unknown plate: ${id}`)
  return found
}

const cosmetics = (overrides: Partial<CosmeticsData>): CosmeticsData => ({
  ...NEUTRAL_COSMETICS,
  ...overrides
})

const PRO_PLATE_IDS = PLATES.filter((p) => p.proExclusive).map((p) => p.id)

const ids = (plates: readonly PlateDef[]) => plates.map((p) => p.id)

/** NEUTRAL_BADGES rows with the given ids unlocked. */
const rowsUnlocking = (unlockedIds: string[]): AchievementRow[] =>
  NEUTRAL_BADGES.map((row) =>
    unlockedIds.includes(row.id)
      ? { ...row, current: row.target, unlockedAt: '2026-08-14T12:00:00.000Z' }
      : row
  )

describe('catalog fixtures the bag relies on', () => {
  it('ships fifteen plates with three Pro exclusives and thirty-two badges', () => {
    expect(PLATES).toHaveLength(15)
    expect(PRO_PLATE_IDS).toEqual(['pro-circuit', 'aurora-drift', 'midnight-ops'])
    expect(NEUTRAL_BADGES).toHaveLength(32)
    expect(NEUTRAL_BADGES.every((row) => row.unlockedAt === null && row.current === 0)).toBe(true)
  })
})

describe('usableIdsFor', () => {
  it('returns the owned set as-is without Pro', () => {
    const usable = usableIdsFor(cosmetics({ owned: new Set(['deep-space', 'koi-pond']) }))
    expect([...usable].sort()).toEqual(['deep-space', 'koi-pond'])
  })

  it('adds only the Pro-exclusive plates while Pro is active', () => {
    const usable = usableIdsFor(cosmetics({ isPro: true, owned: new Set(['deep-space']) }))
    expect([...usable].sort()).toEqual(['deep-space', ...PRO_PLATE_IDS].sort())
    expect(usable.has('founder')).toBe(false)
    expect(usable.has('champions-gold')).toBe(false)
  })

  it('does not mutate the owned set', () => {
    const owned = new Set(['deep-space'])
    usableIdsFor(cosmetics({ isPro: true, owned }))
    expect([...owned]).toEqual(['deep-space'])
  })
})

describe('statusFor', () => {
  const usable = new Set(['deep-space', 'koi-pond'])

  it('resolves equipped, usable and locked', () => {
    expect(statusFor('koi-pond', 'koi-pond', usable)).toBe('equipped')
    expect(statusFor('deep-space', 'koi-pond', usable)).toBe('usable')
    expect(statusFor('founder', 'koi-pond', usable)).toBe('locked')
  })

  it('equipped wins even when the id is not in the usable set', () => {
    expect(statusFor('founder', 'founder', usable)).toBe('equipped')
  })

  it('treats a null equip as nothing equipped', () => {
    expect(statusFor('koi-pond', null, usable)).toBe('usable')
  })

  it('has a label, glyph and tone for every status', () => {
    expect(STATUS_META.equipped).toEqual({ label: 'EQUIPPED', glyph: '■', tone: 'signal' })
    expect(STATUS_META.usable).toEqual({ label: 'STOWED', glyph: '▣', tone: 'ink' })
    expect(STATUS_META.locked).toEqual({ label: 'LOCKED', glyph: '□', tone: 'mute' })
  })
})

describe('filterPlates', () => {
  const none = new Set<string>()
  const base = { query: '', ownFilter: 'all', rarityFilter: 'all', usableIds: none } as const

  it('returns the whole catalog with no filters and nothing usable, rarity-desc', () => {
    const result = ids(filterPlates({ ...base }))
    expect(result).toHaveLength(PLATES.length)
    expect(result.slice(0, 3)).toEqual(['koi-pond', 'event-horizon', 'prime-anomaly'])
    expect(result.at(-1)).toBe('keyboard-cat')
  })

  it('matches the query against the name, case-insensitively', () => {
    expect(ids(filterPlates({ ...base, query: 'SPACE' }))).toEqual(['deep-space'])
    expect(ids(filterPlates({ ...base, query: '  rain ' }))).toEqual(['terminal-rain'])
    expect(filterPlates({ ...base, query: 'nothing-here' })).toEqual([])
  })

  it('splits the catalog on ownership', () => {
    const usableIds = new Set(['deep-space', 'koi-pond'])
    expect(ids(filterPlates({ ...base, ownFilter: 'owned', usableIds }))).toEqual([
      'koi-pond',
      'deep-space'
    ])
    const missing = ids(filterPlates({ ...base, ownFilter: 'missing', usableIds }))
    expect(missing).toHaveLength(PLATES.length - 2)
    expect(missing).not.toContain('deep-space')
    expect(missing).not.toContain('koi-pond')
  })

  it('filters on rarity and keeps catalog order inside a shelf', () => {
    expect(ids(filterPlates({ ...base, rarityFilter: 'mythic' }))).toEqual([
      'koi-pond',
      'event-horizon',
      'prime-anomaly'
    ])
    expect(ids(filterPlates({ ...base, rarityFilter: 'common' }))).toEqual([
      'deep-space',
      'keyboard-cat'
    ])
  })

  it('sorts usable first, then mythic → common, stable within ties', () => {
    const usableIds = new Set(['deep-space', 'midnight-ops'])
    const result = ids(filterPlates({ ...base, usableIds }))
    // usable shelf: epic before common
    expect(result.slice(0, 2)).toEqual(['midnight-ops', 'deep-space'])
    // locked shelf, rarity descending with catalog order in ties
    expect(result.slice(2)).toEqual([
      'koi-pond',
      'event-horizon',
      'prime-anomaly',
      'champions-gold',
      'season-01-ignition',
      'founder',
      'cherry-blossom',
      'pro-circuit',
      'aurora-drift',
      'beta-tester',
      'synthwave-grid',
      'terminal-rain',
      'keyboard-cat'
    ])
  })

  it('never reorders the catalog itself', () => {
    const before = ids(PLATES)
    filterPlates({ ...base, usableIds: new Set(['keyboard-cat']) })
    expect(ids(PLATES)).toEqual(before)
  })
})

describe('filterBadges', () => {
  const rows = rowsUnlocking(['score_1k', 'streak_3'])

  it('splits rows on unlock state', () => {
    expect(filterBadges(rows, { query: '', filter: 'unlocked' }).map((r) => r.id)).toEqual([
      'score_1k',
      'streak_3'
    ])
    expect(filterBadges(rows, { query: '', filter: 'locked' })).toHaveLength(rows.length - 2)
    expect(filterBadges(rows, { query: '', filter: 'all' })).toHaveLength(rows.length)
  })

  it('matches the query against the name, case-insensitively', () => {
    expect(filterBadges(rows, { query: 'ignition', filter: 'all' }).map((r) => r.id)).toEqual([
      'score_1k'
    ])
    expect(filterBadges(rows, { query: 'ignition', filter: 'locked' })).toEqual([])
  })
})

describe('defaultPlateSelection', () => {
  it('opens on the equipped plate when the catalog knows it', () => {
    expect(
      defaultPlateSelection(cosmetics({ equipped: 'koi-pond', owned: new Set(['deep-space']) }))
    ).toBe('koi-pond')
  })

  it('falls back to the first usable plate in catalog order when the equip is unknown', () => {
    expect(
      defaultPlateSelection(
        cosmetics({ equipped: 'retired-plate', owned: new Set(['founder', 'terminal-rain']) })
      )
    ).toBe('terminal-rain')
    // Pro collection counts as usable: first Pro plate in catalog order
    expect(defaultPlateSelection(cosmetics({ isPro: true }))).toBe('pro-circuit')
  })

  it('falls back to the catalog front when nothing is usable', () => {
    expect(defaultPlateSelection(NEUTRAL_COSMETICS)).toBe(PLATES[0].id)
    expect(defaultPlateSelection(cosmetics({ equipped: 'retired-plate' }))).toBe(PLATES[0].id)
  })
})

describe('defaultBadgeSelection', () => {
  const rows = rowsUnlocking(['streak_7', 'tools_3'])

  it('keeps the selected row when it is present', () => {
    expect(defaultBadgeSelection(rows, 'burn_500')?.id).toBe('burn_500')
  })

  it('falls back to the first unlocked row', () => {
    expect(defaultBadgeSelection(rows, null)?.id).toBe('streak_7')
    expect(defaultBadgeSelection(rows, 'not-a-badge')?.id).toBe('streak_7')
  })

  it('falls back to the first row when nothing is unlocked, and null for no rows', () => {
    expect(defaultBadgeSelection(NEUTRAL_BADGES, null)?.id).toBe(ACHIEVEMENTS[0].id)
    expect(defaultBadgeSelection([], 'score_1k')).toBeNull()
  })
})

describe('serials', () => {
  it('stamps plates by catalog position, zero-padded', () => {
    expect(plateSerial(PLATES[0].id)).toBe('PLT-01')
    expect(plateSerial('keyboard-cat')).toBe('PLT-05')
    expect(plateSerial('beta-tester')).toBe('PLT-15')
  })

  it('stamps badges by catalog position, zero-padded', () => {
    expect(badgeSerial('score_1k')).toBe('BDG-01')
    expect(badgeSerial('streak_3')).toBe('BDG-07')
    expect(badgeSerial('burn_500')).toBe('BDG-32')
  })

  it('stamps unknown ids with ??', () => {
    expect(plateSerial('retired-plate')).toBe('PLT-??')
    expect(badgeSerial('nope')).toBe('BDG-??')
  })
})

describe('formatProgressValue', () => {
  // Record keyed by the union: adding a unit fails to compile until it is
  // covered here too.
  const cases: Record<AchievementUnit, [value: number, expected: string]> = {
    points: [1_500, '1.5k'],
    tokens: [2_000_000, '2M'],
    duration: [4 * 3_600_000, '4h 0m'],
    usd: [499.6, '$500'],
    days: [30, '30'],
    tools: [3, '3'],
    visits: [1_000, '1,000'],
    sessions: [25, '25'],
    models: [5, '5'],
    none: [1, '']
  }

  for (const [unit, [value, expected]] of Object.entries(cases) as [
    AchievementUnit,
    [number, string]
  ][]) {
    it(`formats ${unit}`, () => {
      expect(formatProgressValue(unit, value)).toBe(expected)
    })
  }

  it('rounds fractional counts before grouping', () => {
    expect(formatProgressValue('points', 999.6)).toBe('1k')
    expect(formatProgressValue('visits', 1234.4)).toBe('1,234')
  })
})

describe('revStamp', () => {
  it('zero-pads the month', () => {
    expect(revStamp(new Date(2026, 8, 6))).toBe('REV 2026.09')
    expect(revStamp(new Date(2026, 0, 1))).toBe('REV 2026.01')
  })

  it('keeps two digits for late months', () => {
    expect(revStamp(new Date(2026, 11, 31))).toBe('REV 2026.12')
  })
})

describe('acquisitionLine', () => {
  it('quotes the shop price for purchasable plates', () => {
    expect(acquisitionLine(plate('synthwave-grid'))).toBe('SHOP · $3.99')
    expect(acquisitionLine(plate('koi-pond'))).toBe('SHOP · $15.00')
  })

  it('names the source for the never-sold plates', () => {
    expect(acquisitionLine(plate('pro-circuit'))).toBe('CRIBBLE PRO — active subscription')
    expect(acquisitionLine(plate('champions-gold'))).toBe('AWARDED TO RANK #1 (APEX)')
    expect(acquisitionLine(plate('beta-tester'))).toBe('BETA TESTER GIFT — retired')
  })

  it('falls through to NOT OBTAINABLE when no flag is set', () => {
    const orphan: PlateDef = { ...plate('founder'), id: 'orphan', priceUsd: null }
    expect(acquisitionLine(orphan)).toBe('NOT OBTAINABLE')
  })
})

describe('counts', () => {
  it('counts usable plates against the catalog only', () => {
    expect(countUsable(new Set())).toBe(0)
    expect(countUsable(new Set(['deep-space', 'koi-pond', 'retired-plate']))).toBe(2)
  })

  it('counts unlocked rows', () => {
    expect(countUnlocked(NEUTRAL_BADGES)).toBe(0)
    expect(countUnlocked(rowsUnlocking(['score_1k', 'burn_500', 'tools_3']))).toBe(3)
  })
})
