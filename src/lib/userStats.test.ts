import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoreEventWithTimestamp } from './scoring'

// The activity_days rollup (migration 069) rides the 036 rollup: same
// event normalization, same write path. These pin the per-day
// accumulation, the 91-day window, ordering, the tolerant read side, and
// the backfill trigger so the profile grid can trust the column shape.

const fetchAllUserEventsMock = vi.fn()

vi.mock('./scoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scoring')>()
  return {
    ...actual,
    fetchAllUserEvents: (...args: unknown[]) => fetchAllUserEventsMock(...args)
  }
})

import {
  ACTIVITY_WINDOW_DAYS,
  buildRollupWriteColumns,
  computeUserStatsRollup,
  ensureUserStatsRollup,
  parseStoredActivityDays,
  type ActivityDay,
  type UserStatsRollupColumns
} from './userStats'

const NOW = new Date('2026-09-03T10:00:00.000Z')
const DAY_MS = 86_400_000

const heartbeat = (
  timestamp: string,
  activeMs: number,
  domain = 'cursor.com'
): ScoreEventWithTimestamp => ({
  timestamp,
  active_ms: activeMs,
  total_ms: activeMs,
  visits: 0,
  domain
})

const visit = (timestamp: string, domain = 'cursor.com'): ScoreEventWithTimestamp => ({
  timestamp,
  active_ms: 120_000,
  total_ms: 120_000,
  visits: 1,
  domain
})

const daysAgo = (n: number, hour = 12) => {
  const d = new Date(NOW.getTime() - n * DAY_MS)
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour)
  ).toISOString()
}

const keyOf = (iso: string) => iso.split('T')[0]

describe('computeUserStatsRollup activityDays', () => {
  it('sums verified active ms per UTC day and keeps the normalized total', () => {
    const rollup = computeUserStatsRollup(
      [
        heartbeat('2026-09-02T08:00:00.000Z', 5_000),
        heartbeat('2026-09-02T22:30:00.000Z', 7_000),
        heartbeat('2026-09-03T01:00:00.000Z', 1_000)
      ],
      NOW
    )
    expect(rollup.activityDays).toEqual<ActivityDay[]>([
      { date: '2026-09-02', activeMs: 12_000 },
      { date: '2026-09-03', activeMs: 1_000 }
    ])
    expect(rollup.totalActiveMs).toBe(13_000)
    expect(rollup.activeDays).toBe(2)
  })

  it('buckets by UTC date, not local — 23:59Z and 00:01Z are different days', () => {
    const rollup = computeUserStatsRollup(
      [
        heartbeat('2026-09-01T23:59:00.000Z', 1_000),
        heartbeat('2026-09-02T00:01:00.000Z', 2_000)
      ],
      NOW
    )
    expect(rollup.activityDays.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02'])
  })

  it('drops days that only had visit rows (no verified activity)', () => {
    const rollup = computeUserStatsRollup(
      [visit('2026-09-01T10:00:00.000Z'), heartbeat('2026-09-02T10:00:00.000Z', 3_000)],
      NOW
    )
    // The visit day still counts toward activeDays (unchanged 036 rule) …
    expect(rollup.activeDays).toBe(2)
    // … but carries no per-day active ms, so it is not a grid day.
    expect(rollup.activityDays).toEqual([{ date: '2026-09-02', activeMs: 3_000 }])
  })

  it('keeps exactly the last 91 UTC days, today inclusive', () => {
    const events = [
      heartbeat(daysAgo(0), 100),
      heartbeat(daysAgo(ACTIVITY_WINDOW_DAYS - 1), 200), // oldest day inside
      heartbeat(daysAgo(ACTIVITY_WINDOW_DAYS), 300), // first day outside
      heartbeat(daysAgo(400), 400)
    ]
    const rollup = computeUserStatsRollup(events, NOW)
    expect(rollup.activityDays).toEqual([
      { date: keyOf(daysAgo(ACTIVITY_WINDOW_DAYS - 1)), activeMs: 200 },
      { date: keyOf(daysAgo(0)), activeMs: 100 }
    ])
    // The window never changes the lifetime aggregates.
    expect(rollup.totalActiveMs).toBe(1_000)
    expect(rollup.activeDays).toBe(4)
  })

  it('drops days dated after now', () => {
    const rollup = computeUserStatsRollup(
      [heartbeat('2026-09-04T00:00:00.000Z', 500), heartbeat(daysAgo(1), 50)],
      NOW
    )
    expect(rollup.activityDays).toEqual([{ date: keyOf(daysAgo(1)), activeMs: 50 }])
  })

  it('sorts ascending regardless of event order', () => {
    const rollup = computeUserStatsRollup(
      [
        heartbeat(daysAgo(1), 10),
        heartbeat(daysAgo(30), 10),
        heartbeat(daysAgo(7), 10),
        heartbeat(daysAgo(0), 10)
      ],
      NOW
    )
    const dates = rollup.activityDays.map((d) => d.date)
    expect(dates).toEqual([...dates].sort())
    expect(dates).toHaveLength(4)
  })

  it('ignores events without a parseable timestamp', () => {
    const rollup = computeUserStatsRollup(
      [
        { active_ms: 1_000, visits: 0, domain: 'cursor.com', timestamp: null },
        { active_ms: 1_000, visits: 0, domain: 'cursor.com', timestamp: 'not a date' },
        heartbeat(daysAgo(0), 1_000)
      ],
      NOW
    )
    expect(rollup.activityDays).toEqual([{ date: keyOf(daysAgo(0)), activeMs: 1_000 }])
    // Unparseable rows still count toward the lifetime total (036 rule).
    expect(rollup.totalActiveMs).toBe(3_000)
  })

  it('yields an empty list (not null) for an idle account', () => {
    expect(computeUserStatsRollup([], NOW).activityDays).toEqual([])
  })
})

describe('buildRollupWriteColumns', () => {
  it('writes activity_days next to the 036 columns', () => {
    const rollup = computeUserStatsRollup([heartbeat(daysAgo(0), 60_000)], NOW)
    const columns = buildRollupWriteColumns(rollup, NOW.toISOString())
    expect(Object.keys(columns).sort()).toEqual([
      'active_days',
      'activity_days',
      'longest_streak',
      'stats_updated_at',
      'top_tools',
      'total_active_ms'
    ])
    expect(columns.activity_days).toEqual([{ date: keyOf(daysAgo(0)), activeMs: 60_000 }])
    expect(columns.stats_updated_at).toBe(NOW.toISOString())
  })

  it('persists an empty array so an idle row never re-triggers the backfill', () => {
    const columns = buildRollupWriteColumns(computeUserStatsRollup([], NOW), NOW.toISOString())
    expect(columns.activity_days).toEqual([])
  })
})

describe('parseStoredActivityDays', () => {
  it('round-trips what buildRollupWriteColumns wrote', () => {
    const rollup = computeUserStatsRollup(
      [heartbeat(daysAgo(3), 1_000), heartbeat(daysAgo(0), 2_000)],
      NOW
    )
    const columns = buildRollupWriteColumns(rollup, NOW.toISOString())
    expect(parseStoredActivityDays(JSON.parse(JSON.stringify(columns.activity_days)))).toEqual(
      rollup.activityDays
    )
  })

  it.each<[string, unknown]>([
    ['null (not backfilled)', null],
    ['undefined (column absent)', undefined],
    ['an object', { date: '2026-09-01', activeMs: 5 }],
    ['a string', '[]'],
    ['a number', 42]
  ])('reads %s as an empty list', (_name, value) => {
    expect(parseStoredActivityDays(value)).toEqual([])
  })

  it('skips malformed entries and coerces numeric strings', () => {
    expect(
      parseStoredActivityDays([
        null,
        'x',
        7,
        { date: '2026-09-01' },
        { activeMs: 10 },
        { date: 'Sep 1 2026', activeMs: 10 },
        { date: '2026-09-01', activeMs: 'abc' },
        { date: '2026-09-02', activeMs: '1500' },
        { date: '2026-09-03', activeMs: 2500.4 }
      ])
    ).toEqual([
      { date: '2026-09-02', activeMs: 1_500 },
      { date: '2026-09-03', activeMs: 2_500 }
    ])
  })

  it('drops zero and negative days', () => {
    expect(
      parseStoredActivityDays([
        { date: '2026-09-01', activeMs: 0 },
        { date: '2026-09-02', activeMs: -5 },
        { date: '2026-09-03', activeMs: 5 }
      ])
    ).toEqual([{ date: '2026-09-03', activeMs: 5 }])
  })

  it('re-sorts a hand-edited column ascending', () => {
    expect(
      parseStoredActivityDays([
        { date: '2026-09-03', activeMs: 3 },
        { date: '2026-09-01', activeMs: 1 },
        { date: '2026-09-02', activeMs: 2 }
      ]).map((d) => d.date)
    ).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })
})

describe('ensureUserStatsRollup backfill gate', () => {
  const upserts: Array<Record<string, unknown>> = []
  const client = {
    from: (table: string) => {
      expect(table).toBe('user_scores')
      return {
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row)
          return { error: null }
        }
      }
    }
  } as unknown as SupabaseClient

  const backfilled: UserStatsRollupColumns = {
    top_tools: [],
    active_days: 3,
    longest_streak: 2,
    total_active_ms: 9_000,
    stats_updated_at: '2026-09-01T00:00:00.000Z'
  }

  beforeEach(() => {
    upserts.length = 0
    fetchAllUserEventsMock.mockReset()
    fetchAllUserEventsMock.mockResolvedValue({
      events: [heartbeat('2026-09-02T10:00:00.000Z', 4_000)],
      column: 'user_id'
    })
  })

  it('returns stored columns untouched when activity_days is present', async () => {
    const rollup = await ensureUserStatsRollup(client, 7, {
      ...backfilled,
      activity_days: [{ date: '2026-09-02', activeMs: 4_000 }]
    })
    expect(fetchAllUserEventsMock).not.toHaveBeenCalled()
    expect(upserts).toEqual([])
    expect(rollup?.activityDays).toEqual([{ date: '2026-09-02', activeMs: 4_000 }])
    expect(rollup?.activeDays).toBe(3)
  })

  it('treats an empty stored array as backfilled (idle accounts do not loop)', async () => {
    const rollup = await ensureUserStatsRollup(client, 7, { ...backfilled, activity_days: [] })
    expect(fetchAllUserEventsMock).not.toHaveBeenCalled()
    expect(rollup?.activityDays).toEqual([])
  })

  it.each<[string, UserStatsRollupColumns]>([
    ['activity_days null (pre-069 row)', { ...backfilled, activity_days: null }],
    ['activity_days absent', backfilled],
    ['stats_updated_at null (pre-036 row)', { stats_updated_at: null, activity_days: [] }]
  ])('replays events once and persists when %s', async (_name, row) => {
    const rollup = await ensureUserStatsRollup(client, 7, row)
    expect(fetchAllUserEventsMock).toHaveBeenCalledTimes(1)
    expect(rollup?.activityDays).toEqual([{ date: '2026-09-02', activeMs: 4_000 }])
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      user_id: 7,
      activity_days: [{ date: '2026-09-02', activeMs: 4_000 }],
      total_active_ms: 4_000
    })
    expect(typeof upserts[0].stats_updated_at).toBe('string')
  })

  it('backfills a missing row too', async () => {
    const rollup = await ensureUserStatsRollup(client, 7, null)
    expect(fetchAllUserEventsMock).toHaveBeenCalledTimes(1)
    expect(rollup?.activityDays).toHaveLength(1)
    expect(upserts).toHaveLength(1)
  })

  it('returns null without persisting when the events read fails', async () => {
    fetchAllUserEventsMock.mockResolvedValue({ events: null, column: 'user_id' })
    const rollup = await ensureUserStatsRollup(client, 7, { ...backfilled, activity_days: null })
    expect(rollup).toBeNull()
    expect(upserts).toEqual([])
  })
})
