import { describe, expect, it } from 'vitest'
import { fetchAllEventPages } from './eventsFetch'
import {
  SCORE_POLICY,
  calculateScoreBuckets,
  normalizeLegacyEventValues,
  scoreFromEvents,
  sessionMultiplier,
  sessionizeEvents,
  visitsFromEvents,
  type ScoreEventWithTimestamp
} from './scoring'

const T0 = Date.parse('2026-07-02T10:00:00.000Z')

const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

/** A 5s activity heartbeat, the row shape the extension actually produces. */
const heartbeat = (
  offsetMs: number,
  domain = 'claude.ai',
  activeMs = 5_000
): ScoreEventWithTimestamp => ({
  timestamp: iso(offsetMs),
  domain,
  active_ms: activeMs,
  total_ms: activeMs,
  visits: 0
})

/** A visit marker; active/total hold unverified wall-clock page time. */
const visit = (
  offsetMs: number,
  domain = 'claude.ai',
  wallMs = 2_000
): ScoreEventWithTimestamp => ({
  timestamp: iso(offsetMs),
  domain,
  active_ms: wallMs,
  total_ms: wallMs,
  visits: 1
})

/** n heartbeats every 5s starting at offsetMs. */
const heartbeatRun = (offsetMs: number, n: number, domain = 'claude.ai') =>
  Array.from({ length: n }, (_, i) => heartbeat(offsetMs + i * 5_000, domain))

describe('normalizeLegacyEventValues', () => {
  it('passes heartbeat rows through', () => {
    expect(normalizeLegacyEventValues({ active_ms: 5_000, visits: 0 })).toEqual({
      activeMs: 5_000,
      visits: 0
    })
  })

  it('strips unverified wall-clock time from visit rows', () => {
    // Real production case: a visit row banked 28.6 minutes of "active" time
    // from a throttled background tab. Visits pay visitPoints, nothing more.
    expect(normalizeLegacyEventValues({ active_ms: 1_716_000, visits: 1 })).toEqual({
      activeMs: 0,
      visits: 1
    })
  })

  it('collapses legacy merged rows to a single visit', () => {
    expect(normalizeLegacyEventValues({ active_ms: 15_000, visits: 3 })).toEqual({
      activeMs: 0,
      visits: 1
    })
  })

  it('clamps negative values', () => {
    expect(normalizeLegacyEventValues({ active_ms: -100, visits: 0 })).toEqual({
      activeMs: 0,
      visits: 0
    })
  })
})

describe('sessionizeEvents', () => {
  it('merges contiguous same-domain heartbeats into one session', () => {
    const sessions = sessionizeEvents(heartbeatRun(0, 12))
    expect(sessions).toHaveLength(1)
    expect(sessions[0].activeMs).toBe(60_000)
    expect(sessions[0].visits).toBe(0)
    // 11 gaps x 5s span + the last tick's own 5s = fully active
    expect(sessions[0].wallMs).toBe(60_000)
  })

  it('splits sessions when the gap exceeds sessionGapMs', () => {
    const events = [
      ...heartbeatRun(0, 2),
      ...heartbeatRun(5_000 + SCORE_POLICY.sessionGapMs + 1, 2)
    ]
    const sessions = sessionizeEvents(events)
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.activeMs)).toEqual([10_000, 10_000])
  })

  it('keeps domains in separate sessions', () => {
    const sessions = sessionizeEvents([
      heartbeat(0, 'claude.ai'),
      heartbeat(0, 'chatgpt.com')
    ])
    expect(sessions).toHaveLength(2)
  })

  it('attaches visits to the surrounding session and tracks idle wall time', () => {
    // visit at 2s, heartbeats at 5s..30s, then a 2min idle pause, more ticks
    const events = [
      visit(2_000),
      ...heartbeatRun(5_000, 6),
      ...heartbeatRun(30_000 + 120_000, 6)
    ]
    const sessions = sessionizeEvents(events)
    expect(sessions).toHaveLength(1)
    const [session] = sessions
    expect(session.visits).toBe(1)
    expect(session.activeMs).toBe(60_000)
    // span: 2s -> 175s plus the final tick's 5s
    expect(session.wallMs).toBe(178_000)
  })

  it('scores rows with unparseable timestamps as standalone sessions', () => {
    const sessions = sessionizeEvents([
      { timestamp: 'not-a-date', domain: 'claude.ai', active_ms: 5_000, visits: 0 }
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].activeMs).toBe(5_000)
  })

  it('drops empty rows', () => {
    expect(
      sessionizeEvents([{ timestamp: iso(0), domain: 'claude.ai', active_ms: 0, visits: 0 }])
    ).toHaveLength(0)
  })

  it('handles unsorted input', () => {
    const run = heartbeatRun(0, 4)
    const sessions = sessionizeEvents([run[2], run[0], run[3], run[1]])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].activeMs).toBe(20_000)
  })
})

describe('sessionMultiplier', () => {
  it('gives a visit-only session no modifiers', () => {
    expect(sessionMultiplier({ activeMs: 0, wallMs: 0 })).toBe(1)
  })

  it('halves drive-by sessions and rewards focus', () => {
    // < 15s active, fully focused: 0.5 * 1.1
    expect(sessionMultiplier({ activeMs: 10_000, wallMs: 10_000 })).toBeCloseTo(0.55)
  })

  it('rewards deep focused sessions', () => {
    // >= 10min active, fully focused: 1.15 * 1.1
    expect(sessionMultiplier({ activeMs: 600_000, wallMs: 600_000 })).toBeCloseTo(1.265)
  })

  it('penalizes mostly-idle sessions', () => {
    // 20% focus, mid-length: 0.85
    expect(sessionMultiplier({ activeMs: 60_000, wallMs: 300_000 })).toBeCloseTo(0.85)
  })

  it('applies no focus modifier in the neutral band', () => {
    expect(sessionMultiplier({ activeMs: 60_000, wallMs: 100_000 })).toBe(1)
  })

  it('never leaves the clamp range', () => {
    expect(sessionMultiplier({ activeMs: 1, wallMs: 1_000_000 })).toBeGreaterThanOrEqual(0.25)
    expect(sessionMultiplier({ activeMs: 10_000_000, wallMs: 10_000_000 })).toBeLessThanOrEqual(2)
  })
})

describe('scoreFromEvents', () => {
  it('pays a visit exactly visitPoints, regardless of its wall duration', () => {
    expect(scoreFromEvents([visit(0)])).toBe(SCORE_POLICY.visitPoints)
    // the pathological 28.6-minute background-tab visit from production
    expect(scoreFromEvents([visit(0, 'claude.ai', 1_716_000)])).toBe(
      SCORE_POLICY.visitPoints
    )
  })

  it('pays ~1 point per active second with the focus bonus on an engaged session', () => {
    // 5 minutes of continuous activity: (300 pts) * 1.1 focus = 330
    expect(scoreFromEvents(heartbeatRun(0, 60))).toBe(330)
  })

  it('does not double-count a visit alongside its heartbeats', () => {
    // visit (40) + 5 min active (300) = 340 base, x1.1 focus = 374
    const events = [visit(2_000), ...heartbeatRun(5_000, 60)]
    expect(scoreFromEvents(events)).toBe(374)
  })

  it('reaches the deep-session bonus through accumulated heartbeats', () => {
    // 10 minutes of 5s ticks: 600 pts * 1.15 deep * 1.1 focus = 759
    expect(scoreFromEvents(heartbeatRun(0, 120))).toBe(759)
  })

  it('applies the drive-by penalty to short sessions', () => {
    // 10s active: 10 * 0.5 * 1.1 = 5.5 -> 6
    expect(scoreFromEvents(heartbeatRun(0, 2))).toBe(6)
  })

  it('scores an empty history as 0', () => {
    expect(scoreFromEvents([])).toBe(0)
  })

  it('replaces the broken per-event math (flat 0.55x on every heartbeat)', () => {
    // Under v2, sixty 5s heartbeats each got the short-session x0.5 and
    // high-focus x1.1 modifiers: 60 * 5 * 0.55 = 165. As one session the
    // same activity is worth 330.
    const events = heartbeatRun(0, 60)
    expect(scoreFromEvents(events)).toBeGreaterThan(165)
  })
})

describe('visitsFromEvents', () => {
  it('counts visit rows and ignores heartbeats', () => {
    const events = [visit(0), visit(10_000), ...heartbeatRun(0, 10)]
    expect(visitsFromEvents(events)).toBe(2)
  })

  it('counts legacy merged rows once', () => {
    expect(visitsFromEvents([{ visits: 5 }])).toBe(1)
  })
})

describe('calculateScoreBuckets', () => {
  it('windows events by UTC day / rolling week / rolling month', () => {
    const now = new Date('2026-07-02T12:00:00.000Z')
    const events = [
      // today (UTC 2026-07-02): one visit
      visit(0),
      // 3 days ago: an engaged session
      ...heartbeatRun(-3 * 86_400_000, 60),
      // 20 days ago: another visit
      visit(-20 * 86_400_000)
    ]
    const buckets = calculateScoreBuckets(events, now)

    expect(buckets.todayScore).toBe(40)
    expect(buckets.weekScore).toBe(40 + 330)
    expect(buckets.monthScore).toBe(40 + 330 + 40)
    expect(buckets.totalScore).toBe(40 + 330 + 40)
  })

  it('exposes session aggregates with verified active time and wall time', () => {
    const now = new Date('2026-07-02T12:00:00.000Z')
    // visit's wall duration must not leak into active or wall aggregates
    const events = [visit(0, 'claude.ai', 1_716_000), ...heartbeatRun(5_000, 12)]
    const buckets = calculateScoreBuckets(events, now)

    expect(buckets.aggregates.total.visits).toBe(1)
    expect(buckets.aggregates.total.activeMs).toBe(60_000)
    // 5s..60s ticks + trailing tick span, anchored at the visit's 0s mark
    expect(buckets.aggregates.total.wallMs).toBe(65_000)
    expect(buckets.aggregates.today.score).toBe(buckets.totalScore)
  })

  it('keeps events with timestamps outside every window in the total', () => {
    const now = new Date('2026-07-02T12:00:00.000Z')
    const buckets = calculateScoreBuckets(
      [visit(-60 * 86_400_000)],
      now
    )
    expect(buckets.totalScore).toBe(40)
    expect(buckets.monthScore).toBe(0)
    expect(buckets.todayScore).toBe(0)
  })

  it('scores the season bucket from the bounded [start, end) window', () => {
    const now = new Date('2026-07-02T12:00:00.000Z')
    const seasonWindow = {
      startMs: T0 - 86_400_000,
      endMs: T0 + 86_400_000
    }
    const events = [
      // before the season started — lifetime only
      visit(-2 * 86_400_000),
      // inside the window
      visit(0),
      // exactly at the end boundary — a post-close sync must not move
      // the archived standings, so this stays out of the season bucket
      visit(86_400_000)
    ]
    const buckets = calculateScoreBuckets(events, now, seasonWindow)
    expect(buckets.seasonScore).toBe(40)
    expect(buckets.totalScore).toBe(120)
  })

  it('scores the season bucket as 0 when no window is supplied (intermission)', () => {
    const now = new Date('2026-07-02T12:00:00.000Z')
    const buckets = calculateScoreBuckets([visit(0)], now)
    expect(buckets.seasonScore).toBe(0)
    expect(buckets.aggregates.season.sessions).toBe(0)
  })
})

describe('fetchAllEventPages', () => {
  const makePages = (total: number) => {
    const calls: Array<[number, number]> = []
    const build = (from: number, to: number) => {
      calls.push([from, to])
      const rows = Array.from(
        { length: Math.max(0, Math.min(total - from, to - from + 1)) },
        (_, i) => ({ id: from + i })
      )
      return Promise.resolve({ data: rows, error: null })
    }
    return { build, calls }
  }

  it('returns a single short page directly', async () => {
    const { build, calls } = makePages(10)
    const result = await fetchAllEventPages(build, { pageSize: 1000 })
    expect(result.rows).toHaveLength(10)
    expect(result.error).toBeNull()
    expect(result.truncated).toBe(false)
    expect(calls).toEqual([[0, 999]])
  })

  it('pages past the PostgREST cap until a short page', async () => {
    const { build, calls } = makePages(2500)
    const result = await fetchAllEventPages(build, { pageSize: 1000 })
    expect(result.rows).toHaveLength(2500)
    expect(result.rows[2499]).toEqual({ id: 2499 })
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999]
    ])
  })

  it('flags truncation when the page budget is exhausted', async () => {
    const { build } = makePages(5000)
    const result = await fetchAllEventPages(build, { pageSize: 1000, maxPages: 2 })
    expect(result.rows).toHaveLength(2000)
    expect(result.truncated).toBe(true)
  })

  it('surfaces query errors with rows collected so far', async () => {
    let call = 0
    const result = await fetchAllEventPages<{ id: number }>((from, to) => {
      call += 1
      if (call === 2) return Promise.resolve({ data: null, error: { message: 'boom' } })
      return Promise.resolve({
        data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })),
        error: null
      })
    })
    expect(result.error).toBe('boom')
    expect(result.rows).toHaveLength(1000)
  })
})
