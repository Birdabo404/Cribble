import { describe, expect, it } from 'vitest'

import {
  HIRING_BAR_MAX_BURN_USD,
  HIRING_BAR_MAX_SCORE,
  HIRING_BAR_MAX_TOKENS,
  HIRING_BAR_MIN,
  evaluateHiringBar,
  formatHiringScore,
  formatHiringTokens,
  formatHiringUsd,
  hasBar,
  hiringBarChips,
  hiringBarFromColumns,
  hiringBarSchema,
  type HiringBar,
  type HiringBarColumns,
  type PilotHiringFacts
} from './teamHiring'
import { TEAM_OWNER_LIMIT } from './teams'

// evaluateHiringBar is the one verdict every stamping surface renders
// (apply modal, directory cards, applicant queue), so its ladder is
// pinned here: a metric that is off stamps null and never weighs in;
// score is always known (met/missed); burn metrics key off burnVerified
// and stamp 'unverified' for unconsented pilots — never 'missed'.
// Overall: no-bar < below (any miss) < partial (no miss, some unknown)
// < clears (every enabled metric met), with boundary equality as met.

/** Every metric on, at chip-friendly values. */
function bar(overrides: Partial<HiringBar> = {}): HiringBar {
  return { minScore: 50_000, minTokens: 100_000_000, minBurnUsd: 1_000, ...overrides }
}

const noBar: HiringBar = { minScore: null, minTokens: null, minBurnUsd: null }

/** A consented pilot sitting exactly on every default threshold —
 *  boundary equality must read MET everywhere. */
function facts(overrides: Partial<PilotHiringFacts> = {}): PilotHiringFacts {
  return {
    totalScore: 50_000,
    burnVerified: true,
    totalTokens: 100_000_000,
    burnUsd: 1_000,
    ...overrides
  }
}

/** The unconsented shape fetchPilotHiringFacts produces: burn unknowable. */
const unverified = (overrides: Partial<PilotHiringFacts> = {}) =>
  facts({ burnVerified: false, totalTokens: null, burnUsd: null, ...overrides })

describe('hasBar', () => {
  it('is false only when every metric is off', () => {
    expect(hasBar(noBar)).toBe(false)
    expect(hasBar({ ...noBar, minScore: 1 })).toBe(true)
    expect(hasBar({ ...noBar, minTokens: 1 })).toBe(true)
    expect(hasBar({ ...noBar, minBurnUsd: 1 })).toBe(true)
  })
})

// hiringBarFromColumns is the ONE stored-columns → HiringBar coercion,
// shared by the dashboard deck, the apply target and the public
// directory. Before it existed each route coerced differently (bare
// Number() vs finite-and-positive), so a junk column value could read
// as three different bars. Everything hiringBarSchema would never
// write — null, zero, negatives, non-numeric garbage — must uniformly
// read "metric off".
describe('hiringBarFromColumns', () => {
  const columns = (overrides: Partial<HiringBarColumns> = {}): HiringBarColumns => ({
    team_req_min_score: null,
    team_req_min_tokens: null,
    team_req_min_burn_usd: null,
    ...overrides
  })

  it('carries numeric thresholds through unchanged', () => {
    expect(
      hiringBarFromColumns(
        columns({
          team_req_min_score: 50_000,
          team_req_min_tokens: 100_000_000,
          team_req_min_burn_usd: 1_000
        })
      )
    ).toEqual({ minScore: 50_000, minTokens: 100_000_000, minBurnUsd: 1_000 })
  })

  it('converts BIGINT/NUMERIC string values exactly, up to the 1e15 clamp', () => {
    expect(
      hiringBarFromColumns(
        columns({
          team_req_min_score: '50000',
          team_req_min_tokens: '1000000000000000',
          team_req_min_burn_usd: '1000'
        })
      )
    ).toEqual({ minScore: 50_000, minTokens: 1e15, minBurnUsd: 1_000 })
  })

  it('reads null and undefined columns as metric off', () => {
    expect(hiringBarFromColumns(columns())).toEqual(noBar)
    expect(
      hiringBarFromColumns(
        columns({ team_req_min_score: undefined, team_req_min_tokens: undefined })
      )
    ).toEqual(noBar)
  })

  it('reads zero and negatives as metric off — "at least 0" gates nothing', () => {
    expect(
      hiringBarFromColumns(
        columns({ team_req_min_score: 0, team_req_min_burn_usd: '0' })
      )
    ).toEqual(noBar)
    expect(
      hiringBarFromColumns(
        columns({ team_req_min_tokens: -1, team_req_min_burn_usd: '-500' })
      )
    ).toEqual(noBar)
  })

  it('reads NaN and non-finite values as metric off, never a broken bar', () => {
    expect(
      hiringBarFromColumns(
        columns({
          team_req_min_score: 'not-a-number',
          team_req_min_tokens: Number.NaN,
          team_req_min_burn_usd: Number.POSITIVE_INFINITY
        })
      )
    ).toEqual(noBar)
    expect(hiringBarFromColumns(columns({ team_req_min_score: 'Infinity' }))).toEqual(noBar)
  })

  it('turns junk in one column off without disturbing its neighbors', () => {
    expect(
      hiringBarFromColumns(
        columns({ team_req_min_score: 50_000, team_req_min_tokens: 0 })
      )
    ).toEqual({ minScore: 50_000, minTokens: null, minBurnUsd: null })
  })
})

describe('evaluateHiringBar', () => {
  it('stamps no-bar with all-null metrics when nothing is on, whoever the pilot is', () => {
    const expected = { score: null, tokens: null, burnUsd: null, overall: 'no-bar' }
    expect(evaluateHiringBar(noBar, facts())).toEqual(expected)
    expect(evaluateHiringBar(noBar, unverified({ totalScore: 0 }))).toEqual(expected)
  })

  it('clears on boundary equality — meeting the bar exactly is met', () => {
    expect(evaluateHiringBar(bar(), facts())).toEqual({
      score: 'met',
      tokens: 'met',
      burnUsd: 'met',
      overall: 'clears'
    })
  })

  it('stamps null for a metric that is off while still judging the rest', () => {
    expect(evaluateHiringBar(bar({ minTokens: null }), facts())).toEqual({
      score: 'met',
      tokens: null,
      burnUsd: 'met',
      overall: 'clears'
    })
  })

  it('goes below when any single enabled metric is missed', () => {
    expect(evaluateHiringBar(bar(), facts({ totalScore: 49_999 })).overall).toBe('below')
    expect(evaluateHiringBar(bar(), facts({ totalTokens: 99_999_999 })).overall).toBe('below')
    expect(evaluateHiringBar(bar(), facts({ burnUsd: 999 })).overall).toBe('below')
  })

  it('stamps an unconsented pilot unverified on burn metrics, never missed', () => {
    expect(evaluateHiringBar(bar(), unverified())).toEqual({
      score: 'met',
      tokens: 'unverified',
      burnUsd: 'unverified',
      overall: 'partial'
    })
  })

  it('keys burn stamps off burnVerified, not the nullable values', () => {
    // A stray number on an unconsented pilot must not sneak in as met.
    const stamp = evaluateHiringBar(
      bar(),
      facts({ burnVerified: false, totalTokens: 999_999_999_999, burnUsd: 99_999 })
    )
    expect(stamp.tokens).toBe('unverified')
    expect(stamp.burnUsd).toBe('unverified')
  })

  it('never stamps score unverified — score is always known', () => {
    expect(evaluateHiringBar(bar(), unverified()).score).toBe('met')
    expect(evaluateHiringBar(bar(), unverified({ totalScore: 0 })).score).toBe('missed')
  })

  it('lets a missed metric outrank unverified ones: below beats partial', () => {
    expect(evaluateHiringBar(bar(), unverified({ totalScore: 0 }))).toEqual({
      score: 'missed',
      tokens: 'unverified',
      burnUsd: 'unverified',
      overall: 'below'
    })
  })

  it('clears a score-only bar for an unconsented pilot — nothing unknown is on', () => {
    expect(
      evaluateHiringBar(bar({ minTokens: null, minBurnUsd: null }), unverified())
    ).toEqual({ score: 'met', tokens: null, burnUsd: null, overall: 'clears' })
  })

  it('treats a consented pilot absent from the burn board as zero usage: missed', () => {
    // fetchPilotHiringFacts hands these through as verified zeros.
    expect(
      evaluateHiringBar(bar(), facts({ totalTokens: 0, burnUsd: 0 }))
    ).toEqual({ score: 'met', tokens: 'missed', burnUsd: 'missed', overall: 'below' })
  })
})

describe('formatters', () => {
  it('passes sub-thousand values through as plain digits', () => {
    expect(formatHiringScore(500)).toBe('500')
    expect(formatHiringUsd(100)).toBe('$100')
  })

  it('formats the quick-pick chip values the UI advertises', () => {
    expect(formatHiringScore(10_000)).toBe('10K')
    expect(formatHiringScore(50_000)).toBe('50K')
    expect(formatHiringTokens(10_000_000)).toBe('10M')
    expect(formatHiringTokens(100_000_000)).toBe('100M')
    expect(formatHiringTokens(1_000_000_000)).toBe('1B')
    expect(formatHiringUsd(1_000)).toBe('$1K')
    expect(formatHiringUsd(10_000)).toBe('$10K')
  })

  it('keeps at most three significant digits and truncates, never rounds up', () => {
    expect(formatHiringScore(1_500)).toBe('1.5K')
    expect(formatHiringScore(1_234_567)).toBe('1.23M')
    // 999,999 must not display as the 1M boundary it sits under.
    expect(formatHiringScore(999_999)).toBe('999K')
  })

  it('covers the whole clamped range', () => {
    expect(formatHiringTokens(1_000_000_000_000)).toBe('1T')
    expect(formatHiringTokens(HIRING_BAR_MAX_TOKENS)).toBe('1Q')
    expect(formatHiringUsd(HIRING_BAR_MAX_BURN_USD)).toBe('$1B')
  })
})

describe('hiringBarChips', () => {
  it('renders the full bar in score, tokens, burn order', () => {
    expect(hiringBarChips(bar())).toEqual(['50K GS', '100M TOKENS', '$1K BURN'])
  })

  it('skips metrics that are off without disturbing the order', () => {
    expect(hiringBarChips(bar({ minTokens: null }))).toEqual(['50K GS', '$1K BURN'])
    expect(hiringBarChips(bar({ minScore: null }))).toEqual(['100M TOKENS', '$1K BURN'])
  })

  it('renders no chips for no bar', () => {
    expect(hiringBarChips(noBar)).toEqual([])
  })
})

describe('hiringBarSchema', () => {
  it('accepts nulls and integers across the clamped range', () => {
    expect(hiringBarSchema.safeParse(noBar).success).toBe(true)
    expect(
      hiringBarSchema.safeParse({
        minScore: HIRING_BAR_MIN,
        minTokens: HIRING_BAR_MAX_TOKENS,
        minBurnUsd: HIRING_BAR_MAX_BURN_USD
      }).success
    ).toBe(true)
  })

  it('rejects zero, negatives, fractions, and over-max values', () => {
    const parse = (overrides: Partial<HiringBar>) =>
      hiringBarSchema.safeParse({ ...noBar, ...overrides }).success
    expect(parse({ minScore: 0 })).toBe(false)
    expect(parse({ minTokens: -1 })).toBe(false)
    expect(parse({ minBurnUsd: 99.5 })).toBe(false)
    expect(parse({ minScore: HIRING_BAR_MAX_SCORE + 1 })).toBe(false)
    expect(parse({ minBurnUsd: HIRING_BAR_MAX_BURN_USD + 1 })).toBe(false)
  })

  it('pins the app-side constants the routes and copy lean on', () => {
    expect(HIRING_BAR_MIN).toBe(1)
    expect(HIRING_BAR_MAX_SCORE).toBe(1e15)
    expect(HIRING_BAR_MAX_TOKENS).toBe(1e15)
    expect(HIRING_BAR_MAX_BURN_USD).toBe(1e9)
    expect(TEAM_OWNER_LIMIT).toBe(3)
  })
})
