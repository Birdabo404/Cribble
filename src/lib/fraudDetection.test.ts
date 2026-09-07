import { describe, expect, it } from 'vitest'
import type { ScoreEventWithTimestamp } from './scoring'
import {
  ACTIVITY_DAILY_ACTIVE_MS_CEILING,
  ACTIVITY_DAILY_VISIT_CEILING,
  DEFAULT_FRAUD_POLICY,
  assessUserFraud,
  bucketActivityByDay,
  evaluateFraudSignals,
  fraudFingerprint,
  type FraudAssessmentInput,
  type FraudSignal,
  type TokenDay
} from './fraudDetection'

// Helpers to synthesise events_raw-shaped rows without repeating boilerplate.

function heartbeat(day: string, hour: number, activeMs: number, domain = 'chatgpt.com'): ScoreEventWithTimestamp {
  const stamp = `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`
  return { timestamp: stamp, domain, active_ms: activeMs, total_ms: activeMs, visits: 0 }
}

function heartbeatAt(iso: string, activeMs: number, domain = 'chatgpt.com'): ScoreEventWithTimestamp {
  return { timestamp: iso, domain, active_ms: activeMs, total_ms: activeMs, visits: 0 }
}

function visit(day: string, index: number, domain = 'chatgpt.com'): ScoreEventWithTimestamp {
  const minute = index % 60
  const hour = Math.floor(index / 60) % 24
  const stamp = `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`
  return { timestamp: stamp, domain, active_ms: 0, total_ms: 500, visits: 1 }
}

/** A modest, obviously-human day: ~1h of active time, a handful of visits. */
function normalDay(day: string): ScoreEventWithTimestamp[] {
  const events: ScoreEventWithTimestamp[] = []
  for (let hour = 9; hour < 10; hour++) {
    events.push(heartbeatAt(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`, 5 * 60_000))
    events.push(heartbeatAt(`${day}T${String(hour).padStart(2, '0')}:20:00.000Z`, 4 * 60_000))
    events.push(heartbeatAt(`${day}T${String(hour).padStart(2, '0')}:40:00.000Z`, 6 * 60_000))
  }
  events.push(visit(day, 0))
  events.push(visit(day, 1))
  return events
}

const emptyInput: FraudAssessmentInput = { activity: [], tokenDays: [] }

function findSignal(signals: FraudSignal[], code: FraudSignal['code']): FraudSignal | undefined {
  return signals.find((signal) => signal.code === code)
}

describe('bucketActivityByDay', () => {
  it('groups heartbeats and visits into UTC day buckets, ignoring visit-row active time', () => {
    const events = [
      heartbeatAt('2026-02-01T10:00:00.000Z', 60_000),
      heartbeatAt('2026-02-01T23:59:00.000Z', 30_000),
      // visit rows carry unverified wall time; active_ms must not count.
      { timestamp: '2026-02-01T12:00:00.000Z', domain: 'x', active_ms: 999_999, total_ms: 999_999, visits: 1 },
      heartbeatAt('2026-02-02T00:01:00.000Z', 45_000)
    ]
    const days = bucketActivityByDay(events)
    expect(days).toHaveLength(2)
    expect(days[0]).toMatchObject({ key: '2026-02-01', activeMs: 90_000, visits: 1 })
    expect(days[1]).toMatchObject({ key: '2026-02-02', activeMs: 45_000, visits: 0 })
  })

  it('drops rows without a parseable timestamp', () => {
    const days = bucketActivityByDay([
      { timestamp: 'not-a-date', domain: 'x', active_ms: 1000, total_ms: 1000, visits: 0 }
    ])
    expect(days).toHaveLength(0)
  })
})

describe('clean users produce no signals', () => {
  it('returns nothing for an empty history', () => {
    expect(evaluateFraudSignals(emptyInput)).toEqual([])
    expect(assessUserFraud(emptyInput).categories).toEqual([])
  })

  it('returns nothing for a normal multi-day human history', () => {
    const activity = [
      ...normalDay('2026-02-01'),
      ...normalDay('2026-02-02'),
      ...normalDay('2026-02-03'),
      ...normalDay('2026-02-04')
    ]
    const tokenDays: TokenDay[] = [
      { date: '2026-02-01', totalTokens: 1_200_000, costUsd: 3.5 },
      { date: '2026-02-02', totalTokens: 900_000, costUsd: 2.7 },
      { date: '2026-02-03', totalTokens: 1_500_000, costUsd: 4.2 }
    ]
    const assessment = assessUserFraud({ activity, tokenDays })
    expect(assessment.signals).toEqual([])
    expect(assessment.categories).toEqual([])
  })
})

describe('activity_ceiling_pinning', () => {
  it('fires when the daily active ceiling is pinned on enough days', () => {
    // 4 days, each a single heartbeat at 95% of the 16h ceiling.
    const perDay = Math.round(0.95 * ACTIVITY_DAILY_ACTIVE_MS_CEILING)
    const activity: ScoreEventWithTimestamp[] = []
    for (const day of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']) {
      // split across two rows so wall span > 0 and concurrency stays clean
      activity.push(heartbeatAt(`${day}T00:00:00.000Z`, perDay / 2))
      activity.push(heartbeatAt(`${day}T20:00:00.000Z`, perDay / 2))
    }
    const signal = findSignal(evaluateFraudSignals({ ...emptyInput, activity }), 'activity_ceiling_pinning')
    expect(signal).toBeDefined()
    expect(signal?.category).toBe('activity')
    expect(signal?.details.pinnedDays).toBe(4)
  })

  it('does not fire below the minimum pinned-day count', () => {
    const perDay = Math.round(0.95 * ACTIVITY_DAILY_ACTIVE_MS_CEILING)
    const activity: ScoreEventWithTimestamp[] = []
    for (const day of ['2026-03-01', '2026-03-02']) {
      activity.push(heartbeatAt(`${day}T00:00:00.000Z`, perDay / 2))
      activity.push(heartbeatAt(`${day}T20:00:00.000Z`, perDay / 2))
    }
    expect(findSignal(evaluateFraudSignals({ ...emptyInput, activity }), 'activity_ceiling_pinning')).toBeUndefined()
  })
})

describe('impossible_concurrency', () => {
  it('fires when active time far exceeds the wall-clock window', () => {
    // 12h of active time compressed into a 4h wall window (ratio 3x).
    const activity = [
      heartbeatAt('2026-04-01T10:00:00.000Z', 6 * 60 * 60 * 1000, 'chatgpt.com'),
      heartbeatAt('2026-04-01T14:00:00.000Z', 6 * 60 * 60 * 1000, 'claude.ai')
    ]
    const signal = findSignal(evaluateFraudSignals({ ...emptyInput, activity }), 'impossible_concurrency')
    expect(signal).toBeDefined()
    expect(Number(signal?.details.ratio)).toBeGreaterThanOrEqual(DEFAULT_FRAUD_POLICY.concurrencyRatio)
  })

  it('does not fire for sequential single-stream activity', () => {
    const activity = [
      heartbeatAt('2026-04-01T09:00:00.000Z', 60 * 60 * 1000),
      heartbeatAt('2026-04-01T12:00:00.000Z', 60 * 60 * 1000),
      heartbeatAt('2026-04-01T15:00:00.000Z', 60 * 60 * 1000)
    ]
    expect(findSignal(evaluateFraudSignals({ ...emptyInput, activity }), 'impossible_concurrency')).toBeUndefined()
  })
})

describe('visit_flooding', () => {
  it('fires on days near the visit ceiling with negligible active time', () => {
    const activity: ScoreEventWithTimestamp[] = []
    const floodCount = Math.round(0.9 * ACTIVITY_DAILY_VISIT_CEILING)
    for (const day of ['2026-05-01', '2026-05-02']) {
      for (let i = 0; i < floodCount; i++) activity.push(visit(day, i))
    }
    const signal = findSignal(evaluateFraudSignals({ ...emptyInput, activity }), 'visit_flooding')
    expect(signal).toBeDefined()
    expect(signal?.details.floodedDays).toBe(2)
  })

  it('does not fire when visits are backed by real active time', () => {
    const activity: ScoreEventWithTimestamp[] = []
    const floodCount = Math.round(0.9 * ACTIVITY_DAILY_VISIT_CEILING)
    for (const day of ['2026-05-01', '2026-05-02']) {
      for (let i = 0; i < floodCount; i++) activity.push(visit(day, i))
      // plenty of active time -> active_ms per visit above the padding threshold
      activity.push(heartbeatAt(`${day}T08:00:00.000Z`, 3 * 60 * 60 * 1000))
    }
    expect(findSignal(evaluateFraudSignals({ ...emptyInput, activity }), 'visit_flooding')).toBeUndefined()
  })
})

describe('uniform_duration_padding', () => {
  it('fires when one large duration dominates a big sample', () => {
    const activity: ScoreEventWithTimestamp[] = []
    for (let i = 0; i < 50; i++) {
      // spread across days/hours so ceiling + concurrency stay out of it
      const day = `2026-06-${String((i % 28) + 1).padStart(2, '0')}`
      activity.push(heartbeat(day, i % 24, 90_000))
    }
    const signal = findSignal(evaluateFraudSignals({ ...emptyInput, activity }), 'uniform_duration_padding')
    expect(signal).toBeDefined()
    expect(Number(signal?.details.dominantRatio)).toBeGreaterThanOrEqual(DEFAULT_FRAUD_POLICY.uniformDominantRatio)
  })

  it('does not fire on varied durations', () => {
    const activity: ScoreEventWithTimestamp[] = []
    for (let i = 0; i < 50; i++) {
      const day = `2026-06-${String((i % 28) + 1).padStart(2, '0')}`
      activity.push(heartbeat(day, i % 24, 60_000 + i * 1_000))
    }
    expect(findSignal(evaluateFraudSignals({ ...emptyInput, activity }), 'uniform_duration_padding')).toBeUndefined()
  })

  it('does not fire below the minimum event count', () => {
    const activity: ScoreEventWithTimestamp[] = []
    for (let i = 0; i < 10; i++) {
      const day = `2026-06-${String((i % 28) + 1).padStart(2, '0')}`
      activity.push(heartbeat(day, i % 24, 90_000))
    }
    expect(findSignal(evaluateFraudSignals({ ...emptyInput, activity }), 'uniform_duration_padding')).toBeUndefined()
  })
})

describe('token_impossible_rate', () => {
  it('fires when daily tokens exceed the ceiling on enough days', () => {
    const tokenDays: TokenDay[] = [
      { date: '2026-07-01', totalTokens: 3_000_000_000, costUsd: 100 },
      { date: '2026-07-02', totalTokens: 2_500_000_000, costUsd: 90 }
    ]
    const signal = findSignal(evaluateFraudSignals({ activity: [], tokenDays }), 'token_impossible_rate')
    expect(signal).toBeDefined()
    expect(signal?.category).toBe('token')
    expect(signal?.details.days).toBe(2)
  })

  it('does not fire on a single over-ceiling day', () => {
    const tokenDays: TokenDay[] = [{ date: '2026-07-01', totalTokens: 3_000_000_000, costUsd: 100 }]
    expect(findSignal(evaluateFraudSignals({ activity: [], tokenDays }), 'token_impossible_rate')).toBeUndefined()
  })
})

describe('token_spike', () => {
  it('fires when one day dwarfs the median day', () => {
    const tokenDays: TokenDay[] = [
      { date: '2026-08-01', totalTokens: 1_000_000, costUsd: 3 },
      { date: '2026-08-02', totalTokens: 1_100_000, costUsd: 3 },
      { date: '2026-08-03', totalTokens: 900_000, costUsd: 3 },
      { date: '2026-08-04', totalTokens: 1_050_000, costUsd: 3 },
      { date: '2026-08-05', totalTokens: 200_000_000, costUsd: 3 }
    ]
    const signal = findSignal(evaluateFraudSignals({ activity: [], tokenDays }), 'token_spike')
    expect(signal).toBeDefined()
    expect(signal?.details.day).toBe('2026-08-05')
  })

  it('does not fire without enough history to establish a baseline', () => {
    const tokenDays: TokenDay[] = [
      { date: '2026-08-04', totalTokens: 1_000_000, costUsd: 3 },
      { date: '2026-08-05', totalTokens: 200_000_000, costUsd: 3 }
    ]
    expect(findSignal(evaluateFraudSignals({ activity: [], tokenDays }), 'token_spike')).toBeUndefined()
  })
})

describe('token_cost_mismatch', () => {
  it('fires on huge token totals with near-zero cost', () => {
    const tokenDays: TokenDay[] = [
      { date: '2026-09-01', totalTokens: 400_000_000, costUsd: 0 },
      { date: '2026-09-02', totalTokens: 400_000_000, costUsd: 0 }
    ]
    const signal = findSignal(evaluateFraudSignals({ activity: [], tokenDays }), 'token_cost_mismatch')
    expect(signal).toBeDefined()
    expect(Number(signal?.details.costPerMillion)).toBeLessThan(DEFAULT_FRAUD_POLICY.tokenMinCostPerMillion)
  })

  it('does not fire when cost is proportional to tokens', () => {
    const tokenDays: TokenDay[] = [
      { date: '2026-09-01', totalTokens: 400_000_000, costUsd: 1_200 },
      { date: '2026-09-02', totalTokens: 400_000_000, costUsd: 1_200 }
    ]
    expect(findSignal(evaluateFraudSignals({ activity: [], tokenDays }), 'token_cost_mismatch')).toBeUndefined()
  })
})

describe('fraudFingerprint', () => {
  it('is stable regardless of signal order and category-scoped', () => {
    const a: FraudSignal = {
      code: 'token_spike',
      category: 'token',
      severity: 'low',
      score: 1,
      message: '',
      details: {}
    }
    const b: FraudSignal = {
      code: 'token_impossible_rate',
      category: 'token',
      severity: 'low',
      score: 1,
      message: '',
      details: {}
    }
    expect(fraudFingerprint('token', [a, b])).toBe(fraudFingerprint('token', [b, a]))
    expect(fraudFingerprint('token', [a])).not.toBe(fraudFingerprint('token', [a, b]))
    expect(fraudFingerprint('token', [a])).not.toBe(fraudFingerprint('activity', [a]))
    expect(fraudFingerprint('token', [a])).toMatch(/^fraud_token_[0-9a-f]{16}$/)
  })
})

describe('assessUserFraud roll-up', () => {
  it('splits signals into per-category assessments with capped scores and levels', () => {
    const perDay = Math.round(0.95 * ACTIVITY_DAILY_ACTIVE_MS_CEILING)
    const activity: ScoreEventWithTimestamp[] = []
    for (const day of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']) {
      activity.push(heartbeatAt(`${day}T00:00:00.000Z`, perDay / 2))
      activity.push(heartbeatAt(`${day}T20:00:00.000Z`, perDay / 2))
    }
    const tokenDays: TokenDay[] = [
      { date: '2026-07-01', totalTokens: 3_000_000_000, costUsd: 0 },
      { date: '2026-07-02', totalTokens: 3_000_000_000, costUsd: 0 }
    ]
    const assessment = assessUserFraud({ activity, tokenDays })

    const activityCat = assessment.categories.find((c) => c.category === 'activity')
    const tokenCat = assessment.categories.find((c) => c.category === 'token')
    expect(activityCat).toBeDefined()
    expect(tokenCat).toBeDefined()
    expect(activityCat!.riskScore).toBeGreaterThan(0)
    expect(activityCat!.riskScore).toBeLessThanOrEqual(100)
    expect(activityCat!.signals.every((s) => s.category === 'activity')).toBe(true)
    expect(tokenCat!.signals.every((s) => s.category === 'token')).toBe(true)
    expect(['low', 'medium', 'high', 'critical']).toContain(tokenCat!.level)
    expect(tokenCat!.fingerprint).toMatch(/^fraud_token_[0-9a-f]{16}$/)
  })

  it('caps the category risk score at 100 when many signals stack', () => {
    const perDay = Math.round(0.99 * ACTIVITY_DAILY_ACTIVE_MS_CEILING)
    const activity: ScoreEventWithTimestamp[] = []
    // Many pinned + concurrent + uniform days to stack activity signals high.
    for (let i = 1; i <= 12; i++) {
      const day = `2026-03-${String(i).padStart(2, '0')}`
      for (let j = 0; j < 6; j++) activity.push(heartbeat(day, j, perDay / 6))
    }
    const activityCat = assessUserFraud({ activity, tokenDays: [] }).categories.find(
      (c) => c.category === 'activity'
    )
    expect(activityCat).toBeDefined()
    expect(activityCat!.riskScore).toBeLessThanOrEqual(100)
  })
})
