import { describe, expect, it } from 'vitest'
import { STATUS_WINDOW_DAYS } from './types'
import {
  buildDays,
  impactDaySeverity,
  quietRatioOf,
  sanitizeIncidentTitle,
  severityRank,
  type IncidentInterval
} from './uptime'

// Pure day-bar math under a pinned clock. The interesting seams: UTC
// midnight straddles, unresolved incidents extending to `now`, worst-of
// when incidents overlap, and feed text landing in tooltips.

const NOW = new Date('2026-08-17T15:30:00.000Z')

const incident = (overrides: Partial<IncidentInterval>): IncidentInterval => ({
  title: 'Fixture incident',
  impact: 'minor',
  startedAt: '2026-08-10T10:00:00.000Z',
  resolvedAt: '2026-08-10T11:00:00.000Z',
  ...overrides
})

const cellOf = (days: ReturnType<typeof buildDays>, date: string) => {
  const cell = days.find((day) => day.date === date)
  expect(cell, `expected a cell for ${date}`).toBeDefined()
  return cell!
}

describe('buildDays', () => {
  it('returns exactly the window, oldest first, all quiet without incidents', () => {
    const days = buildDays([], NOW)
    expect(days).toHaveLength(STATUS_WINDOW_DAYS)
    expect(days[0].date).toBe('2026-05-20')
    expect(days[STATUS_WINDOW_DAYS - 1].date).toBe('2026-08-17')
    expect(days.every((day) => day.severity === 'operational')).toBe(true)
    expect(quietRatioOf(days)).toBe(1)
  })

  it('paints both days when an incident straddles midnight UTC', () => {
    const days = buildDays(
      [incident({ startedAt: '2026-08-10T22:00:00.000Z', resolvedAt: '2026-08-11T02:00:00.000Z' })],
      NOW
    )
    expect(cellOf(days, '2026-08-10').severity).toBe('degraded')
    expect(cellOf(days, '2026-08-11').severity).toBe('degraded')
    expect(cellOf(days, '2026-08-12').severity).toBe('operational')
  })

  it('extends unresolved incidents to now', () => {
    const days = buildDays(
      [incident({ impact: 'critical', startedAt: '2026-08-15T04:00:00.000Z', resolvedAt: null })],
      NOW
    )
    expect(cellOf(days, '2026-08-14').severity).toBe('operational')
    expect(cellOf(days, '2026-08-15').severity).toBe('outage')
    expect(cellOf(days, '2026-08-16').severity).toBe('outage')
    expect(cellOf(days, '2026-08-17').severity).toBe('outage')
  })

  it('keeps the worst incident and its title when incidents overlap a day', () => {
    const days = buildDays(
      [
        incident({ title: 'Slow queries', impact: 'minor', resolvedAt: '2026-08-10T20:00:00.000Z' }),
        incident({
          title: 'Full outage',
          impact: 'critical',
          startedAt: '2026-08-10T12:00:00.000Z',
          resolvedAt: '2026-08-10T13:00:00.000Z'
        })
      ],
      NOW
    )
    const day = cellOf(days, '2026-08-10')
    expect(day.severity).toBe('outage')
    expect(day.incident).toBe('Full outage')
  })

  it('ignores incidents outside the window and unparseable starts', () => {
    const days = buildDays(
      [
        incident({ startedAt: '2026-01-05T10:00:00.000Z', resolvedAt: '2026-01-06T10:00:00.000Z' }),
        incident({ startedAt: 'not a date', resolvedAt: null })
      ],
      NOW
    )
    expect(days.every((day) => day.severity === 'operational')).toBe(true)
  })

  it('computes quietRatio as incident-free days over the window', () => {
    const days = buildDays(
      [
        incident({ startedAt: '2026-08-10T22:00:00.000Z', resolvedAt: '2026-08-11T02:00:00.000Z' }),
        incident({ impact: 'critical', startedAt: '2026-08-15T04:00:00.000Z', resolvedAt: null })
      ],
      NOW
    )
    // 2 degraded days + 3 outage days = 5 loud days out of 90.
    expect(quietRatioOf(days)).toBeCloseTo((STATUS_WINDOW_DAYS - 5) / STATUS_WINDOW_DAYS, 10)
  })
})

describe('impactDaySeverity', () => {
  it('sends hard-outage words to ember and everything else to ice', () => {
    expect(impactDaySeverity('critical')).toBe('outage')
    expect(impactDaySeverity('major')).toBe('outage')
    expect(impactDaySeverity('full_outage')).toBe('outage')
    expect(impactDaySeverity('outage')).toBe('outage')
    expect(impactDaySeverity('minor')).toBe('degraded')
    expect(impactDaySeverity('none')).toBe('degraded')
    expect(impactDaySeverity('maintenance')).toBe('degraded')
    expect(impactDaySeverity('available')).toBe('degraded')
  })
})

describe('sanitizeIncidentTitle', () => {
  it('strips tags, decodes basic entities and removes control chars', () => {
    expect(sanitizeIncidentTitle('<b>DB &amp; API\u0007 down</b>')).toBe('DB & API down')
  })

  it('caps long titles around 140 chars with an ellipsis', () => {
    const long = 'x'.repeat(300)
    const cleaned = sanitizeIncidentTitle(long)
    expect(cleaned.length).toBeLessThanOrEqual(140)
    expect(cleaned.endsWith('…')).toBe(true)
  })
})

describe('severityRank', () => {
  it('orders operational < unknown < degraded < outage', () => {
    expect(severityRank('operational')).toBeLessThan(severityRank('unknown'))
    expect(severityRank('unknown')).toBeLessThan(severityRank('degraded'))
    expect(severityRank('degraded')).toBeLessThan(severityRank('outage'))
  })
})
