import { describe, expect, it } from 'vitest'
import { COUNTRY_POINTS, countryPoint } from './countryCentroids'
import {
  jitterPosition,
  joinPinCandidates,
  MAX_PINS,
  MAX_PINS_PER_COUNTRY,
  seasonLabel,
  selectGlobePins,
  type GlobePinCandidate
} from './landingLive'

const candidate = (
  rank: number,
  country: string | null,
  overrides: Partial<GlobePinCandidate> = {}
): GlobePinCandidate => ({
  userId: 1000 + rank,
  rank,
  handle: `pilot_${rank}`,
  status: 'active',
  metadata: null,
  devices: country
    ? [{ country_code: country, last_sync_at: '2026-09-01T00:00:00.000Z' }]
    : [],
  ...overrides
})

/** A country codes cycle so many eligible rows spread across the table. */
const COUNTRY_CYCLE = ['PH', 'JP', 'DE', 'GB', 'BR', 'NG', 'SG', 'FR', 'IN', 'MX', 'KR', 'ZA']

describe('countryPoint', () => {
  it('returns capital coordinates for known codes in any casing', () => {
    expect(countryPoint('US')).toEqual({ name: 'United States', lat: 38.9072, lng: -77.0369 })
    expect(countryPoint(' ph ')).toEqual(COUNTRY_POINTS.PH)
  })

  it('returns null for unknown or malformed codes', () => {
    expect(countryPoint('XX')).toBeNull()
    expect(countryPoint('unknown')).toBeNull()
    expect(countryPoint('')).toBeNull()
    // Prototype keys must not leak through the record lookup.
    expect(countryPoint('constructor')).toBeNull()
  })

  it('covers every country seen on the board today', () => {
    const seen =
      'US IN BR GB PH SG ES BD JP EG AT AU CZ LK BE CA ID CO NG PL KW NZ AE NL VN MY HK NP GH CH PK TW UZ FR MX EE GR PA UA DE TR'
    for (const code of seen.split(' ')) {
      expect(countryPoint(code), code).not.toBeNull()
    }
  })

  it('keeps every table entry inside real-world bounds', () => {
    for (const [code, point] of Object.entries(COUNTRY_POINTS)) {
      expect(code).toMatch(/^[A-Z]{2}$/)
      expect(Math.abs(point.lat), code).toBeLessThanOrEqual(90)
      expect(Math.abs(point.lng), code).toBeLessThanOrEqual(180)
      expect(point.name.length, code).toBeGreaterThan(0)
    }
  })
})

describe('selectGlobePins', () => {
  it('walks candidates in rank order regardless of input order', () => {
    const rows = [candidate(3, 'DE'), candidate(1, 'PH'), candidate(2, 'JP')]
    const pins = selectGlobePins(rows)
    expect(pins.map((p) => p.handle)).toEqual(['pilot_1', 'pilot_2', 'pilot_3'])
  })

  it('caps pins per country at six by default, keeping the best-ranked', () => {
    const rows = Array.from({ length: 10 }, (_, i) => candidate(i + 1, 'US'))
    const pins = selectGlobePins(rows)
    expect(pins).toHaveLength(MAX_PINS_PER_COUNTRY)
    expect(pins.map((p) => p.handle)).toEqual(
      Array.from({ length: 6 }, (_, i) => `pilot_${i + 1}`)
    )
  })

  it('caps the total at sixty by default', () => {
    // 12 countries × 8 candidates each = 96 eligible rows, 72 after the
    // per-country cap, then the total cap bites.
    const rows = Array.from({ length: 96 }, (_, i) =>
      candidate(i + 1, COUNTRY_CYCLE[i % COUNTRY_CYCLE.length])
    )
    const pins = selectGlobePins(rows)
    expect(pins).toHaveLength(MAX_PINS)
    for (const code of COUNTRY_CYCLE) {
      expect(pins.filter((p) => p.country === code).length).toBeLessThanOrEqual(
        MAX_PINS_PER_COUNTRY
      )
    }
  })

  it('honours explicit caps', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      candidate(i + 1, i % 2 === 0 ? 'US' : 'IN')
    )
    const pins = selectGlobePins(rows, { maxPerCountry: 2, maxTotal: 3 })
    expect(pins.map((p) => `${p.country}:${p.handle}`)).toEqual([
      'US:pilot_1',
      'IN:pilot_2',
      'US:pilot_3'
    ])
  })

  it('skips private, opted-out and non-active accounts', () => {
    const rows = [
      candidate(1, 'PH', { metadata: { is_private: true } }),
      candidate(2, 'PH', { metadata: { insights_opt_out: true } }),
      candidate(3, 'PH', { status: 'banned' }),
      candidate(4, 'PH', { status: 'suspended' }),
      // Anything other than literal true reads as public / included.
      candidate(5, 'PH', { metadata: { is_private: 'true', insights_opt_out: 1 } }),
      candidate(6, 'PH', { status: null })
    ]
    expect(selectGlobePins(rows).map((p) => p.handle)).toEqual(['pilot_5', 'pilot_6'])
  })

  it('skips accounts without a presentable handle and strips a leading @', () => {
    const rows = [
      candidate(1, 'PH', { handle: null }),
      candidate(2, 'PH', { handle: '   ' }),
      candidate(3, 'PH', { handle: '@' }),
      candidate(4, 'PH', { handle: '@null_ptr' })
    ]
    expect(selectGlobePins(rows).map((p) => p.handle)).toEqual(['null_ptr'])
  })

  it('skips accounts with no device country or one the table does not know', () => {
    const rows = [
      candidate(1, null),
      candidate(2, 'XX'),
      candidate(3, 'T1'),
      candidate(4, 'PH', {
        devices: [{ country_code: null, last_sync_at: '2026-09-01T00:00:00.000Z' }]
      }),
      candidate(5, 'JP')
    ]
    const pins = selectGlobePins(rows)
    expect(pins.map((p) => p.handle)).toEqual(['pilot_5'])
    expect(pins[0]).toMatchObject({ country: 'JP', countryName: 'Japan' })
  })

  it('takes the country from the most recently synced device', () => {
    const rows = [
      candidate(1, null, {
        devices: [
          { country_code: 'US', last_sync_at: '2026-08-01T00:00:00.000Z' },
          { country_code: 'PH', last_sync_at: '2026-09-01T00:00:00.000Z' },
          { country_code: 'DE', last_sync_at: null }
        ]
      })
    ]
    expect(selectGlobePins(rows)[0]).toMatchObject({ country: 'PH' })
  })

  it('positions pins deterministically per user, apart within a country', () => {
    const rows = [candidate(1, 'US'), candidate(2, 'US'), candidate(3, 'US')]
    const first = selectGlobePins(rows)
    const second = selectGlobePins(rows.slice().reverse())
    expect(second).toEqual(first)

    const positions = new Set(first.map((p) => `${p.lat},${p.lng}`))
    expect(positions.size).toBe(3)
    // Every pin still lands in the country's scatter, not on the capital.
    for (const pin of first) {
      expect(pin.lat).not.toBe(COUNTRY_POINTS.US.lat)
      expect(Math.abs(pin.lat - COUNTRY_POINTS.US.lat)).toBeLessThanOrEqual(5)
      expect(Math.abs(pin.lng - COUNTRY_POINTS.US.lng)).toBeLessThanOrEqual(8)
    }
  })

  it('keeps every pin within the globe bounds', () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      candidate(i + 1, COUNTRY_CYCLE[i % COUNTRY_CYCLE.length], { userId: i * 7919 + 13 })
    )
    for (const pin of selectGlobePins(rows, { maxPerCountry: 200, maxTotal: 200 })) {
      expect(Math.abs(pin.lat)).toBeLessThanOrEqual(80)
      expect(pin.lng).toBeGreaterThan(-180)
      expect(pin.lng).toBeLessThanOrEqual(180)
    }
  })
})

describe('jitterPosition', () => {
  it('is a pure function of the user id', () => {
    const a = jitterPosition(42, 'PH', COUNTRY_POINTS.PH)
    const b = jitterPosition(42, 'PH', COUNTRY_POINTS.PH)
    expect(a).toEqual(b)
    expect(jitterPosition(43, 'PH', COUNTRY_POINTS.PH)).not.toEqual(a)
  })

  it('scatters compact countries tighter than continental ones', () => {
    const compact = jitterPosition(7, 'PH', COUNTRY_POINTS.PH)
    expect(Math.abs(compact.lat - COUNTRY_POINTS.PH.lat)).toBeLessThanOrEqual(1.6)
    expect(Math.abs(compact.lng - COUNTRY_POINTS.PH.lng)).toBeLessThanOrEqual(2.4)

    const wide = jitterPosition(7, 'RU', COUNTRY_POINTS.RU)
    expect(Math.abs(wide.lat - COUNTRY_POINTS.RU.lat)).toBeLessThanOrEqual(5)
    expect(Math.abs(wide.lng - COUNTRY_POINTS.RU.lng)).toBeLessThanOrEqual(8)
  })

  it('clamps latitude to ±80 and wraps longitude past the antimeridian', () => {
    for (let userId = 1; userId <= 50; userId++) {
      const polar = jitterPosition(userId, 'US', { lat: 79.5, lng: 0 })
      expect(polar.lat).toBeLessThanOrEqual(80)
      const east = jitterPosition(userId, 'FJ', { lat: -18, lng: 179.9 })
      expect(east.lng).toBeGreaterThan(-180)
      expect(east.lng).toBeLessThanOrEqual(180)
    }
  })
})

describe('joinPinCandidates', () => {
  it('joins ranks to users and groups their located devices', () => {
    const candidates = joinPinCandidates(
      [
        { user_id: '8', rank: '1' },
        { user_id: 9, rank: 2 },
        { user_id: 10, rank: 3 }
      ],
      [
        { id: 8, twitter_username: 'eight', metadata: { is_private: false }, status: 'active' },
        { id: '9', twitter_username: null, metadata: null, status: null }
      ],
      [
        { user_id: 8, country_code: 'US', last_sync_at: '2026-09-01T00:00:00.000Z' },
        { user_id: '8', country_code: 'PH', last_sync_at: '2026-08-01T00:00:00.000Z' }
      ]
    )
    expect(candidates).toEqual([
      {
        userId: 8,
        rank: 1,
        handle: 'eight',
        status: 'active',
        metadata: { is_private: false },
        devices: [
          { country_code: 'US', last_sync_at: '2026-09-01T00:00:00.000Z' },
          { country_code: 'PH', last_sync_at: '2026-08-01T00:00:00.000Z' }
        ]
      },
      { userId: 9, rank: 2, handle: null, status: null, metadata: null, devices: [] }
    ])
  })
})

describe('seasonLabel', () => {
  it('keeps the seeded ordinal name as-is', () => {
    expect(seasonLabel({ number: 1, name: 'SEASON 01' })).toBe('SEASON 01')
    expect(seasonLabel({ number: 2, name: 'season 2' })).toBe('SEASON 2')
  })

  it('prefixes a codename with the ordinal', () => {
    expect(seasonLabel({ number: 1, name: 'Ignition' })).toBe('SEASON 01 · IGNITION')
  })

  it('falls back to the ordinal for a blank name', () => {
    expect(seasonLabel({ number: 12, name: '   ' })).toBe('SEASON 12')
  })
})
