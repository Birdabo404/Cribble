import { describe, expect, it } from 'vitest'
import {
  countryBoardEnabled,
  countryName,
  countryOptions,
  latestDeviceCountry,
  parseLeaderboardCountry,
  publishedBoardCountry
} from './leaderboardCountry'

describe('parseLeaderboardCountry', () => {
  it('accepts a known code in any case', () => {
    expect(parseLeaderboardCountry('ph')).toBe('PH')
    expect(parseLeaderboardCountry(' JP ')).toBe('JP')
  })

  it('rejects unknown codes, prototype keys and non-strings', () => {
    expect(parseLeaderboardCountry('XX')).toBeNull()
    expect(parseLeaderboardCountry('constructor')).toBeNull()
    expect(parseLeaderboardCountry('')).toBeNull()
    expect(parseLeaderboardCountry(null)).toBeNull()
    expect(parseLeaderboardCountry(63)).toBeNull()
  })
})

describe('countryBoardEnabled', () => {
  it('is on until the player turns it off', () => {
    expect(countryBoardEnabled(null)).toBe(true)
    expect(countryBoardEnabled({})).toBe(true)
    expect(countryBoardEnabled({ leaderboardCountry: 'PH' })).toBe(true)
    expect(countryBoardEnabled({ leaderboardCountryOff: true })).toBe(false)
    expect(countryBoardEnabled({ leaderboardCountry: null })).toBe(false)
    expect(
      countryBoardEnabled({ leaderboardCountry: null, leaderboardCountryOff: false })
    ).toBe(true)
  })
})

describe('latestDeviceCountry', () => {
  it('uses the newest sync and ignores codes the board cannot name', () => {
    expect(
      latestDeviceCountry([
        { country_code: 'us', last_sync_at: '2026-08-01T00:00:00.000Z' },
        { country_code: 'ph', last_sync_at: '2026-09-01T00:00:00.000Z' },
        { country_code: 'XX', last_sync_at: '2026-10-01T00:00:00.000Z' }
      ])
    ).toBe('PH')
    expect(latestDeviceCountry([])).toBeNull()
  })
})

describe('publishedBoardCountry', () => {
  const devices = [{ country_code: 'JP', last_sync_at: '2026-09-01T00:00:00.000Z' }]

  it('publishes the device country while the board is on', () => {
    expect(publishedBoardCountry({}, devices)).toBe('JP')
    expect(publishedBoardCountry({ leaderboardCountry: 'US' }, devices)).toBe('JP')
  })

  it('publishes nothing when the player turned the board off', () => {
    expect(publishedBoardCountry({ leaderboardCountryOff: true }, devices)).toBeNull()
    expect(publishedBoardCountry({ leaderboardCountry: null }, devices)).toBeNull()
  })
})

describe('countryOptions', () => {
  it('lists every known country by name', () => {
    const options = countryOptions()
    expect(options.length).toBeGreaterThan(50)
    const names = options.map((option) => option.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(countryName('US')).toBe('United States')
  })
})
