import { describe, expect, it } from 'vitest'

import {
  computeDailyAggregates,
  isValidRollupDate,
  median,
  previousUtcDate,
  resolveCohortCountry,
  resolveCohortOptOut,
  resolveCohortRole,
  sessionsToUsageRows,
  type UserCohort
} from './insightsRollup'
import type { ScoreSession } from './scoring'

// The rollup is the only writer of daily_tool_aggregates, the only surface
// aggregate insights will ever be computed from — so the privacy-relevant
// behaviors are pinned here: opt-outs never reach an aggregate row, cohort
// fallbacks are 'unknown' (never a guess), and medians are real medians.

function session(overrides: Partial<ScoreSession> = {}): ScoreSession {
  return {
    domain: 'claude.ai',
    startMs: Date.parse('2026-08-03T10:00:00.000Z'),
    endMs: Date.parse('2026-08-03T10:10:00.000Z'),
    activeMs: 600_000,
    visits: 1,
    wallMs: 600_000,
    eventCount: 12,
    ...overrides
  }
}

describe('isValidRollupDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidRollupDate('2026-08-03')).toBe(true)
    expect(isValidRollupDate('2026-02-31')).toBe(false)
    expect(isValidRollupDate('2026-8-3')).toBe(false)
    expect(isValidRollupDate('yesterday')).toBe(false)
  })
})

describe('previousUtcDate', () => {
  it('returns the prior UTC day regardless of time of day', () => {
    expect(previousUtcDate(Date.parse('2026-08-04T00:05:00.000Z'))).toBe('2026-08-03')
    expect(previousUtcDate(Date.parse('2026-08-04T23:55:00.000Z'))).toBe('2026-08-03')
    expect(previousUtcDate(Date.parse('2026-01-01T12:00:00.000Z'))).toBe('2025-12-31')
  })
})

describe('median', () => {
  it('handles empty, odd, and even inputs', () => {
    expect(median([])).toBeNull()
    expect(median([5])).toBe(5)
    expect(median([9, 1, 5])).toBe(5)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('ignores non-finite values', () => {
    expect(median([NaN, Infinity, 3])).toBe(3)
    expect(median([NaN])).toBeNull()
  })
})

describe('sessionsToUsageRows', () => {
  it('maps session fields onto usage_sessions columns', () => {
    const rows = sessionsToUsageRows(7, [
      session({ activeMs: 90_000, wallMs: 120_000, visits: 2 })
    ])
    expect(rows).toEqual([
      {
        user_id: 7,
        domain: 'claude.ai',
        started_at: '2026-08-03T10:00:00.000Z',
        ended_at: '2026-08-03T10:10:00.000Z',
        active_ms: 90_000,
        total_ms: 120_000,
        visits: 2,
        focus_ratio: 0.75
      }
    ])
  })

  it('stores null focus for zero-wall sessions (visit-only markers)', () => {
    const rows = sessionsToUsageRows(7, [
      session({ activeMs: 0, wallMs: 0, visits: 1 })
    ])
    expect(rows[0].focus_ratio).toBeNull()
  })

  it('drops sessions with unparseable timestamps', () => {
    expect(sessionsToUsageRows(7, [session({ startMs: NaN })])).toEqual([])
  })
})

describe('cohort resolution', () => {
  it('lowercases roles and falls back to unknown', () => {
    expect(resolveCohortRole('Developer')).toBe('developer')
    expect(resolveCohortRole('  FOUNDER  ')).toBe('founder')
    expect(resolveCohortRole('')).toBe('unknown')
    expect(resolveCohortRole(null)).toBe('unknown')
    expect(resolveCohortRole(42)).toBe('unknown')
  })

  it('treats only a literal true as opted out', () => {
    expect(resolveCohortOptOut({ insights_opt_out: true })).toBe(true)
    expect(resolveCohortOptOut({ insights_opt_out: 'true' })).toBe(false)
    expect(resolveCohortOptOut({ insights_opt_out: 1 })).toBe(false)
    expect(resolveCohortOptOut({})).toBe(false)
    expect(resolveCohortOptOut(null)).toBe(false)
    expect(resolveCohortOptOut([])).toBe(false)
  })

  it('picks the most recently synced device with a valid country', () => {
    expect(
      resolveCohortCountry([
        { country_code: 'de', last_sync_at: '2026-08-01T00:00:00Z' },
        { country_code: 'US', last_sync_at: '2026-08-03T00:00:00Z' },
        { country_code: 'USA', last_sync_at: '2026-08-04T00:00:00Z' },
        { country_code: null, last_sync_at: '2026-08-05T00:00:00Z' }
      ])
    ).toBe('US')
    expect(resolveCohortCountry([])).toBe('unknown')
    expect(
      resolveCohortCountry([{ country_code: '??', last_sync_at: null }])
    ).toBe('unknown')
  })
})

describe('computeDailyAggregates', () => {
  const date = '2026-08-03'
  const cohortOf = (
    country: string,
    role: string,
    optedOut = false
  ): UserCohort => ({ country, role, optedOut })

  it('folds same-slice users together and computes medians', () => {
    const sessionsByUser = new Map([
      [
        1,
        [
          session({ activeMs: 60_000, wallMs: 60_000, visits: 1 }),
          session({ activeMs: 120_000, wallMs: 240_000, visits: 0 })
        ]
      ],
      [2, [session({ activeMs: 300_000, wallMs: 300_000, visits: 2 })]]
    ])
    const cohorts = new Map([
      [1, cohortOf('US', 'developer')],
      [2, cohortOf('US', 'developer')]
    ])

    const rows = computeDailyAggregates(date, sessionsByUser, cohorts)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      date,
      domain: 'claude.ai',
      vendor: 'Anthropic',
      category: 'chat',
      country: 'US',
      role: 'developer',
      distinct_users: 2,
      total_active_ms: 480_000,
      total_visits: 3,
      session_count: 3,
      median_session_ms: 120_000,
      median_focus_ratio: 1
    })
  })

  it('splits slices by cohort and stamps taxonomy per domain', () => {
    const sessionsByUser = new Map([
      [1, [session({ domain: 'chatgpt.com' })]],
      [2, [session({ domain: 'chatgpt.com' })]],
      [3, [session({ domain: 'cursor.com' })]]
    ])
    const cohorts = new Map([
      [1, cohortOf('US', 'developer')],
      [2, cohortOf('DE', 'developer')],
      [3, cohortOf('US', 'designer')]
    ])

    const rows = computeDailyAggregates(date, sessionsByUser, cohorts)
    expect(
      rows.map((row) => [row.domain, row.country, row.role, row.vendor, row.category])
    ).toEqual([
      ['chatgpt.com', 'DE', 'developer', 'OpenAI', 'chat'],
      ['chatgpt.com', 'US', 'developer', 'OpenAI', 'chat'],
      ['cursor.com', 'US', 'designer', 'Anysphere', 'coding']
    ])
    expect(rows.every((row) => row.distinct_users === 1)).toBe(true)
  })

  it('excludes opted-out users entirely', () => {
    const sessionsByUser = new Map([
      [1, [session()]],
      [2, [session()]]
    ])
    const cohorts = new Map([
      [1, cohortOf('US', 'developer')],
      [2, cohortOf('US', 'developer', true)]
    ])

    const rows = computeDailyAggregates(date, sessionsByUser, cohorts)
    expect(rows).toHaveLength(1)
    expect(rows[0].distinct_users).toBe(1)
    expect(rows[0].session_count).toBe(1)
  })

  it('falls back to the unknown cohort when no cohort row exists', () => {
    const rows = computeDailyAggregates(
      date,
      new Map([[99, [session()]]]),
      new Map()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].country).toBe('unknown')
    expect(rows[0].role).toBe('unknown')
  })

  it('maps unlisted domains to the Unknown/other taxonomy', () => {
    const rows = computeDailyAggregates(
      date,
      new Map([[1, [session({ domain: 'retired-tool.example' })]]]),
      new Map([[1, cohortOf('US', 'developer')]])
    )
    expect(rows[0].vendor).toBe('Unknown')
    expect(rows[0].category).toBe('other')
  })
})
