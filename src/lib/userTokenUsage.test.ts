import { describe, expect, it } from 'vitest'
import {
  buildUserTokenUsage,
  parseTokenUsageRange,
  type AgentUsageDailyRow,
  type TokenUsageRange
} from './userTokenUsage'

const RANGE: TokenUsageRange = {
  from: '2026-08-20',
  to: '2026-08-23',
  timezone: 'Asia/Manila',
  inclusiveDays: 4,
  dayBasis: 'source'
}

function usage(
  date: string,
  clientId: string,
  overrides: Partial<AgentUsageDailyRow> = {}
): AgentUsageDailyRow {
  return {
    date,
    client_id: clientId,
    input_tokens: '1',
    output_tokens: '2',
    cache_creation_tokens: '3',
    cache_read_tokens: '4',
    total_tokens: '10',
    cost_usd: '0.100001',
    agents: ['codex'],
    models: ['gpt-5'],
    cli_version: '1.2.0',
    ingested_at: `${date}T12:00:00.000Z`,
    ...overrides
  }
}

describe('parseTokenUsageRange', () => {
  it('defaults to 30 inclusive source days in the validated display timezone', () => {
    const result = parseTokenUsageRange(
      new URLSearchParams({ timezone: 'Asia/Manila' }),
      Date.parse('2026-08-22T18:30:00.000Z')
    )

    expect(result).toEqual({
      ok: true,
      range: {
        from: '2026-07-25',
        to: '2026-08-23',
        timezone: 'Asia/Manila',
        inclusiveDays: 30,
        dayBasis: 'source'
      }
    })
  })

  it('accepts 366 inclusive days and rejects larger, reversed, or invalid ranges', () => {
    const allowed = parseTokenUsageRange(
      new URLSearchParams({ from: '2024-01-01', to: '2024-12-31', timezone: 'UTC' })
    )
    expect(allowed.ok && allowed.range.inclusiveDays).toBe(366)

    expect(
      parseTokenUsageRange(
        new URLSearchParams({ from: '2024-01-01', to: '2025-01-01', timezone: 'UTC' })
      ).ok
    ).toBe(false)
    expect(
      parseTokenUsageRange(
        new URLSearchParams({ from: '2026-08-23', to: '2026-08-20', timezone: 'UTC' })
      ).ok
    ).toBe(false)
    expect(
      parseTokenUsageRange(
        new URLSearchParams({ from: '2026-02-30', to: '2026-03-01', timezone: 'UTC' })
      ).ok
    ).toBe(false)
    expect(
      parseTokenUsageRange(new URLSearchParams({ timezone: 'Mars/Olympus_Mons' })).ok
    ).toBe(false)
  })

  it('accepts since/until aliases but rejects conflicting aliases', () => {
    const alias = parseTokenUsageRange(
      new URLSearchParams({ since: '2026-08-01', until: '2026-08-23' })
    )
    expect(alias.ok && alias.range.from).toBe('2026-08-01')

    expect(
      parseTokenUsageRange(
        new URLSearchParams({
          from: '2026-08-02',
          since: '2026-08-01',
          to: '2026-08-23'
        })
      ).ok
    ).toBe(false)
  })
})

describe('buildUserTokenUsage', () => {
  it('keeps very large token totals and stored costs exact while zero-filling days', () => {
    const result = buildUserTokenUsage({
      rows: [
        usage('2026-08-20', 'client-a', {
          input_tokens: '90071992547409931234567890',
          output_tokens: '10',
          cache_creation_tokens: '20',
          cache_read_tokens: '30',
          total_tokens: '90071992547409931234567950',
          cost_usd: '999999999999999999.123456'
        }),
        usage('2026-08-22', 'client-b', {
          input_tokens: '11111111111111111111111111',
          output_tokens: '90',
          cache_creation_tokens: '80',
          cache_read_tokens: '70',
          total_tokens: '11111111111111111111111351',
          cost_usd: '0.876544'
        })
      ],
      keys: [{ revoked_at: null }],
      range: RANGE,
      availableBounds: { from: '2026-01-01', to: '2026-08-23' },
      freshestSuccessfulIngestAt: '2026-08-23T01:00:00.000Z',
      nowMs: Date.parse('2026-08-23T02:00:00.000Z')
    })

    expect(result.totals).toEqual({
      inputTokens: '101183103658521042345679001',
      outputTokens: '100',
      cacheCreationTokens: '100',
      cacheReadTokens: '100',
      totalTokens: '101183103658521042345679301',
      storedCostUsd: '1000000000000000000'
    })
    expect(result.dailyTrend).toHaveLength(4)
    expect(result.dailyTrend[1]).toMatchObject({
      date: '2026-08-21',
      totalTokens: '0',
      storedCostUsd: '0'
    })
    expect(result.dailyTrend[2].totalTokens).toBe('11111111111111111111111351')
    expect(result.activeDays).toBe(2)
    expect(result.sync).toEqual({
      lastSyncedAt: '2026-08-23T01:00:00.000Z',
      freshness: 'healthy',
      staleAfterHours: 24
    })
  })

  it('reports agent/model active days and v1.2+ primary-model days without token shares', () => {
    const result = buildUserTokenUsage({
      rows: [
        usage('2026-08-20', 'client-a', {
          agents: ['Codex', 'Cursor'],
          models: ['GPT-5', 'Claude Sonnet'],
          cli_version: '1.2.0'
        }),
        usage('2026-08-20', 'client-b', {
          agents: ['codex'],
          models: [],
          cli_version: '1.1.9'
        }),
        usage('2026-08-22', 'client-a', {
          agents: [],
          models: ['Claude Sonnet'],
          cli_version: '1.3.0'
        })
      ],
      keys: [{ revoked_at: null }],
      range: RANGE,
      availableBounds: { from: RANGE.from, to: RANGE.to },
      freshestSuccessfulIngestAt: '2026-08-22T12:00:00.000Z',
      nowMs: Date.parse('2026-08-23T13:00:00.000Z')
    })

    expect(result.breakdowns.agents).toMatchObject({
      reportedActiveDays: 1,
      complete: false,
      items: [
        { name: 'Codex', reportedActiveDays: 1 },
        { name: 'Cursor', reportedActiveDays: 1 }
      ]
    })
    expect(result.breakdowns.models).toMatchObject({
      reportedActiveDays: 2,
      complete: false,
      items: [
        { name: 'Claude Sonnet', reportedActiveDays: 2, primaryModelDays: 1 },
        { name: 'GPT-5', reportedActiveDays: 1, primaryModelDays: 1 }
      ]
    })
    expect(result.breakdowns.primaryModelEligibleActiveDays).toBe(2)
  })

  it('never exposes raw client ids and distinguishes revoked/stale historical data', () => {
    const rawClient = '5b0d4a52-7f6e-4c2a-9a1c-3f9e8d7c6b5a'
    const result = buildUserTokenUsage({
      rows: [usage('2026-08-20', rawClient)],
      keys: [
        { revoked_at: '2026-08-21T00:00:00.000Z' },
        { revoked_at: '2026-08-22T00:00:00.000Z' }
      ],
      range: RANGE,
      availableBounds: { from: RANGE.from, to: RANGE.to },
      freshestSuccessfulIngestAt: '2026-08-20T12:00:00.000Z',
      nowMs: Date.parse('2026-08-23T13:00:00.000Z')
    })

    expect(result.keys.status).toBe('all-revoked')
    expect(result.sync.freshness).toBe('stale')
    expect(result.clients.items[0].label).toBe('Client 01')
    expect(JSON.stringify(result)).not.toContain(rawClient)
  })

  it('treats unrevoked expired keys as expired rather than active', () => {
    const result = buildUserTokenUsage({
      rows: [usage('2026-08-22', 'client-a')],
      keys: [{ revoked_at: null, expires_at: '2026-08-01T00:00:00.000Z' }],
      range: RANGE,
      availableBounds: { from: RANGE.from, to: RANGE.to },
      freshestSuccessfulIngestAt: '2026-08-22T12:00:00.000Z',
      nowMs: Date.parse('2026-08-23T13:00:00.000Z')
    })

    expect(result.keys).toMatchObject({
      status: 'expired',
      total: 1,
      active: 0,
      revoked: 0,
      expired: 1
    })
  })

  it('shapes the no-key/no-data state with an exact zero trend', () => {
    const result = buildUserTokenUsage({
      rows: [],
      keys: [],
      range: RANGE,
      availableBounds: null,
      freshestSuccessfulIngestAt: null,
      nowMs: Date.parse('2026-08-23T00:00:00.000Z')
    })

    expect(result.keys.status).toBe('none')
    expect(result.hasData).toBe(false)
    expect(result.activeDays).toBe(0)
    expect(result.dailyTrend).toHaveLength(4)
    expect(result.dailyTrend.every((day) => day.totalTokens === '0')).toBe(true)
    expect(result.sync.freshness).toBe('never')
  })
})
