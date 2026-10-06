import { describe, expect, it } from 'vitest'
import { countryName, countryOptions, parseLeaderboardCountry } from './leaderboardCountry'

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

describe('countryOptions', () => {
  it('lists every known country by name', () => {
    const options = countryOptions()
    expect(options.length).toBeGreaterThan(50)
    const names = options.map((option) => option.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(countryName('US')).toBe('United States')
  })
})
