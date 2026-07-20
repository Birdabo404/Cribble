import { describe, expect, it } from 'vitest'
import {
  countdownTo,
  daysUntil,
  deriveSeasonState,
  seasonProgress,
  toApiSeason,
  type SeasonRow
} from './season'

const row = (
  number: number,
  status: string,
  startsAt: string,
  endsAt: string
): SeasonRow => ({
  id: number,
  number,
  name: `SEASON ${String(number).padStart(2, '0')}`,
  starts_at: startsAt,
  ends_at: endsAt,
  status
})

const S1 = row(1, 'active', '2026-04-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')

describe('toApiSeason', () => {
  it('normalizes fields and coerces unknown status to upcoming', () => {
    const api = toApiSeason(row(3, 'bogus', '2027-01-04T00:00:00.000Z', '2027-04-01T00:00:00.000Z'))
    expect(api.status).toBe('upcoming')
    expect(api.startsAt).toBe('2027-01-04T00:00:00.000Z')
    expect(api.name).toBe('SEASON 03')
  })
})

describe('deriveSeasonState', () => {
  it('reports the active phase with the live season and the next one', () => {
    const next = row(2, 'upcoming', '2026-10-04T00:00:00.000Z', '2027-01-01T00:00:00.000Z')
    const state = deriveSeasonState([next, S1])
    expect(state.phase).toBe('active')
    expect(state.current?.number).toBe(1)
    expect(state.next?.number).toBe(2)
  })

  it('reports intermission fronted by the latest completed season', () => {
    const done1 = row(1, 'complete', '2026-04-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')
    const done2 = row(2, 'complete', '2026-07-04T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
    const next = row(3, 'upcoming', '2026-10-04T00:00:00.000Z', '2027-01-01T00:00:00.000Z')
    const state = deriveSeasonState([done1, next, done2])
    expect(state.phase).toBe('intermission')
    expect(state.current?.number).toBe(2)
    expect(state.next?.number).toBe(3)
  })

  it('prefers the lowest-numbered season when several are active or upcoming', () => {
    const a2 = row(2, 'active', '2026-10-04T00:00:00.000Z', '2027-01-01T00:00:00.000Z')
    const a1 = row(1, 'active', '2026-04-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
    const u4 = row(4, 'upcoming', '2027-04-04T00:00:00.000Z', '2027-07-01T00:00:00.000Z')
    const u3 = row(3, 'upcoming', '2027-01-04T00:00:00.000Z', '2027-04-01T00:00:00.000Z')
    const state = deriveSeasonState([u4, a2, u3, a1])
    expect(state.current?.number).toBe(1)
    expect(state.next?.number).toBe(3)
  })

  it('handles an empty calendar', () => {
    const state = deriveSeasonState([])
    expect(state).toEqual({ phase: 'intermission', current: null, next: null })
  })
})

describe('seasonProgress', () => {
  const start = '2026-04-01T00:00:00.000Z'
  const end = '2026-10-01T00:00:00.000Z'

  it('is 0% with the full season left on day one', () => {
    const p = seasonProgress(start, end, Date.parse(start))
    expect(p.pct).toBe(0)
    expect(p.daysLeft).toBe(183)
  })

  it('rounds mid-season progress', () => {
    const halfway = (Date.parse(start) + Date.parse(end)) / 2
    const p = seasonProgress(start, end, halfway)
    expect(p.pct).toBe(50)
  })

  it('clamps after the end', () => {
    const p = seasonProgress(start, end, Date.parse(end) + 86_400_000)
    expect(p.pct).toBe(100)
    expect(p.daysLeft).toBe(0)
  })

  it('counts a partial final day as a full day left', () => {
    const p = seasonProgress(start, end, Date.parse(end) - 60_000)
    expect(p.daysLeft).toBe(1)
  })
})

describe('countdownTo', () => {
  const target = '2026-10-01T00:00:00.000Z'

  it('splits the remaining time into d/h/m/s', () => {
    const now = Date.parse(target) - (2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000)
    expect(countdownTo(target, now)).toEqual({ d: 2, h: 3, m: 4, s: 5, ended: false })
  })

  it('marks the exact instant and anything after as ended', () => {
    expect(countdownTo(target, Date.parse(target)).ended).toBe(true)
    expect(countdownTo(target, Date.parse(target) + 1).ended).toBe(true)
  })

  it('treats malformed timestamps as ended instead of NaN digits', () => {
    expect(countdownTo('not-a-date').ended).toBe(true)
  })
})

describe('daysUntil', () => {
  const target = '2026-10-04T00:00:00.000Z'

  it('rounds partial days up', () => {
    expect(daysUntil(target, Date.parse(target) - 1)).toBe(1)
    expect(daysUntil(target, Date.parse(target) - 3 * 86_400_000)).toBe(3)
  })

  it('never goes negative', () => {
    expect(daysUntil(target, Date.parse(target) + 86_400_000)).toBe(0)
  })
})
