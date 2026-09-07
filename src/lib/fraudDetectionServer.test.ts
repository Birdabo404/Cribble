import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { insertMissingMock } = vi.hoisted(() => ({
  insertMissingMock: vi.fn()
}))

vi.mock('./notifications', () => ({
  insertMissingNotifications: insertMissingMock
}))

import {
  alertStaffOfFraudFlags,
  mapTokenDayRows,
  persistFraudAssessment
} from './fraudDetectionServer'
import type { FraudAssessment, FraudCategoryAssessment } from './fraudDetection'

function categoryAssessment(
  overrides: Partial<FraudCategoryAssessment> = {}
): FraudCategoryAssessment {
  return {
    category: 'activity',
    riskScore: 55,
    level: 'high',
    signals: [
      {
        code: 'activity_ceiling_pinning',
        category: 'activity',
        severity: 'high',
        score: 55,
        message: 'pinned',
        details: {}
      }
    ],
    fingerprint: 'fraud_activity_abc123',
    ...overrides
  }
}

/**
 * Minimal fraud_flags Supabase double. Records inserts/updates and replays a
 * programmed lookup + write outcome so persist decisions can be asserted
 * without a database. Supports the exact chains persistFraudAssessment uses:
 *   .select().eq().eq().maybeSingle()
 *   .update().eq()
 *   .insert()
 */
function makeFlagsClient(scenario: {
  lookup: { data: unknown; error: unknown }
  update?: { error: unknown }
  insert?: { error: unknown }
}) {
  const calls = { inserts: [] as unknown[], updates: [] as unknown[] }

  const builder = {
    _mode: 'idle' as 'idle' | 'select' | 'update',
    select() {
      this._mode = 'select'
      return this
    },
    update(payload: unknown) {
      calls.updates.push(payload)
      this._mode = 'update'
      return this
    },
    insert(payload: unknown) {
      calls.inserts.push(payload)
      return Promise.resolve(scenario.insert ?? { error: null })
    },
    eq() {
      // In update mode .eq() is terminal (awaited); in select mode it chains.
      if (this._mode === 'update') {
        return Promise.resolve(scenario.update ?? { error: null })
      }
      return this
    },
    maybeSingle() {
      return Promise.resolve(scenario.lookup)
    }
  }

  const supabase = {
    from: () => builder
  } as unknown as SupabaseClient

  return { supabase, calls }
}

const assessment = (category: FraudCategoryAssessment): FraudAssessment => ({
  signals: category.signals,
  categories: [category]
})

beforeEach(() => {
  insertMissingMock.mockReset()
  insertMissingMock.mockResolvedValue(undefined)
})

describe('mapTokenDayRows', () => {
  it('coerces and floors numeric fields and drops rows without a date', () => {
    const rows = [
      { date: '2026-01-01', total_tokens: '5000', cost_usd: '2.5' },
      { date: null, total_tokens: 10, cost_usd: 1 },
      { date: '2026-01-02', total_tokens: -5, cost_usd: -1 }
    ]
    expect(mapTokenDayRows(rows)).toEqual([
      { date: '2026-01-01', totalTokens: 5000, costUsd: 2.5 },
      { date: '2026-01-02', totalTokens: 0, costUsd: 0 }
    ])
  })

  it('handles null/undefined input', () => {
    expect(mapTokenDayRows(null)).toEqual([])
    expect(mapTokenDayRows(undefined)).toEqual([])
  })
})

describe('persistFraudAssessment', () => {
  it('opens a new flag when none exists for the fingerprint', async () => {
    const category = categoryAssessment()
    const { supabase, calls } = makeFlagsClient({ lookup: { data: null, error: null } })

    const result = await persistFraudAssessment(supabase, 42, assessment(category), new Date('2026-02-01T00:00:00Z'))

    expect(result.opened).toHaveLength(1)
    expect(result.updated).toHaveLength(0)
    expect(calls.inserts).toHaveLength(1)
    expect(calls.inserts[0]).toMatchObject({
      user_id: 42,
      category: 'activity',
      fingerprint: 'fraud_activity_abc123',
      status: 'open',
      detection_count: 1,
      risk_score: 55,
      level: 'high'
    })
  })

  it('refreshes an existing flag and bumps detection_count without touching status', async () => {
    const category = categoryAssessment()
    const { supabase, calls } = makeFlagsClient({
      lookup: { data: { id: 7, detection_count: 3 }, error: null }
    })

    const result = await persistFraudAssessment(supabase, 42, assessment(category), new Date('2026-02-01T00:00:00Z'))

    expect(result.opened).toHaveLength(0)
    expect(result.updated).toHaveLength(1)
    expect(calls.inserts).toHaveLength(0)
    expect(calls.updates).toHaveLength(1)
    expect(calls.updates[0]).toMatchObject({ detection_count: 4, risk_score: 55, level: 'high' })
    expect(calls.updates[0]).not.toHaveProperty('status')
  })

  it('treats a unique-violation insert race as an update, not an open', async () => {
    const category = categoryAssessment()
    const { supabase } = makeFlagsClient({
      lookup: { data: null, error: null },
      insert: { error: { code: '23505', message: 'duplicate key' } }
    })

    const result = await persistFraudAssessment(supabase, 42, assessment(category), new Date())

    expect(result.opened).toHaveLength(0)
    expect(result.updated).toHaveLength(1)
  })

  it('skips a category when the lookup errors', async () => {
    const category = categoryAssessment()
    const { supabase, calls } = makeFlagsClient({
      lookup: { data: null, error: { message: 'db down' } }
    })

    const result = await persistFraudAssessment(supabase, 42, assessment(category), new Date())

    expect(result.opened).toHaveLength(0)
    expect(result.updated).toHaveLength(0)
    expect(calls.inserts).toHaveLength(0)
  })
})

describe('alertStaffOfFraudFlags', () => {
  function usersClient(staff: { data: unknown; error: unknown }) {
    const supabase = {
      from: () => ({
        select: () => ({
          not: () => Promise.resolve(staff)
        })
      })
    } as unknown as SupabaseClient
    return supabase
  }

  it('notifies every staff member once per opened flag, keyed on the fingerprint', async () => {
    const supabase = usersClient({ data: [{ id: 1 }, { id: 2 }], error: null })
    await alertStaffOfFraudFlags(supabase, 42, [categoryAssessment()], new Date())

    expect(insertMissingMock).toHaveBeenCalledTimes(2)
    expect(insertMissingMock).toHaveBeenCalledWith(
      supabase,
      1,
      expect.arrayContaining([
        expect.objectContaining({ type: 'system', dedupeKey: 'fraud_activity_abc123' })
      ])
    )
  })

  it('does nothing when there are no opened flags', async () => {
    const supabase = usersClient({ data: [{ id: 1 }], error: null })
    await alertStaffOfFraudFlags(supabase, 42, [], new Date())
    expect(insertMissingMock).not.toHaveBeenCalled()
  })

  it('does nothing when there are no staff to alert', async () => {
    const supabase = usersClient({ data: [], error: null })
    await alertStaffOfFraudFlags(supabase, 42, [categoryAssessment()], new Date())
    expect(insertMissingMock).not.toHaveBeenCalled()
  })
})
