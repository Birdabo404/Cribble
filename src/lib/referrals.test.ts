import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureReferralCode,
  maybeGrantReferralReward,
  REFERRAL_CAP,
  REFERRAL_POINTS
} from './referrals'

// maybeGrantReferralReward fans out to the notification helper and the
// events_raw schema-compat layer; both are unit-mocked so these tests
// exercise only the referral decision logic.
const { applyEventsUserEqMock, insertMissingNotificationsMock } = vi.hoisted(() => ({
  applyEventsUserEqMock: vi.fn(),
  insertMissingNotificationsMock: vi.fn()
}))

vi.mock('./eventsIdentity', () => ({
  applyEventsUserEq: applyEventsUserEqMock
}))

vi.mock('./notifications', () => ({
  insertMissingNotifications: insertMissingNotificationsMock
}))

// The referral route counts stats.joined from living invite_redemptions
// rows and only falls back to invite_codes.use_count (atomically bumped by
// redeem_invite_code, migration 008) when that count fails. These tests
// pin that every return path still selects use_count and maps it to
// useCount so the fallback keeps working.

type Row = { id: number; code: string; use_count: number }
type QueryResult = { data: Row | null; error: { code?: string; message?: string } | null }

function makeDb(opts: { lookups: QueryResult[]; insert?: QueryResult }) {
  const lookupSelects: string[] = []
  const insertSelects: string[] = []
  const insertedValues: Record<string, unknown>[] = []
  let lookupCall = 0

  const supabase = {
    from: (table: string) => {
      if (table !== 'invite_codes') throw new Error(`Unexpected table: ${table}`)
      return {
        select: (cols: string) => {
          lookupSelects.push(cols)
          return {
            eq: () => ({
              eq: () => ({
                maybeSingle: () => {
                  const result = opts.lookups[lookupCall] ?? { data: null, error: null }
                  lookupCall += 1
                  return Promise.resolve(result)
                }
              })
            })
          }
        },
        insert: (values: Record<string, unknown>) => {
          insertedValues.push(values)
          return {
            select: (cols: string) => {
              insertSelects.push(cols)
              return {
                maybeSingle: () => Promise.resolve(opts.insert ?? { data: null, error: null })
              }
            }
          }
        }
      }
    }
  } as unknown as SupabaseClient

  return { supabase, lookupSelects, insertSelects, insertedValues }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ensureReferralCode', () => {
  it('returns the existing code with its use_count as useCount', async () => {
    const db = makeDb({
      lookups: [{ data: { id: 12, code: 'CRIB-AAAA-BBBB', use_count: 7 }, error: null }]
    })

    const referral = await ensureReferralCode(db.supabase, 42)

    expect(referral).toEqual({ id: 12, code: 'CRIB-AAAA-BBBB', useCount: 7 })
    expect(db.lookupSelects[0]).toContain('use_count')
    expect(db.insertedValues).toHaveLength(0)
  })

  it('mints a fresh code with useCount 0 when none exists', async () => {
    const db = makeDb({
      lookups: [{ data: null, error: null }],
      insert: { data: { id: 3, code: 'CRIB-CCCC-DDDD', use_count: 0 }, error: null }
    })

    const referral = await ensureReferralCode(db.supabase, 42)

    expect(referral).toEqual({ id: 3, code: 'CRIB-CCCC-DDDD', useCount: 0 })
    expect(db.insertSelects[0]).toContain('use_count')
    expect(db.insertedValues[0]).toMatchObject({ created_by: 42, kind: 'referral' })
  })

  it('resolves a lost mint race by re-selecting the winner row', async () => {
    const db = makeDb({
      lookups: [
        { data: null, error: null },
        { data: { id: 9, code: 'CRIB-EEEE-FFFF', use_count: 2 }, error: null }
      ],
      insert: { data: null, error: { code: '23505', message: 'duplicate key' } }
    })

    const referral = await ensureReferralCode(db.supabase, 42)

    expect(referral).toEqual({ id: 9, code: 'CRIB-EEEE-FFFF', useCount: 2 })
    expect(db.lookupSelects[1]).toContain('use_count')
  })

  it('returns null when the lookup errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeDb({
      lookups: [{ data: null, error: { message: 'connection reset' } }]
    })

    expect(await ensureReferralCode(db.supabase, 42)).toBeNull()
  })
})

// ── maybeGrantReferralReward ────────────────────────────────────────────────

interface GrantDbOptions {
  /** Row returned by the invite_redemptions embed lookup. */
  redemption?: unknown
  /** Existing referral_rewards row for this recruit, when present. */
  existingReward?: { id: number } | null
  /** Stored events_raw rows the no-ingest retry probe should find. */
  eventsRows?: Array<{ id: number }>
  /** grant_referral_reward RPC result. */
  rpcAward?: number | null
  rpcError?: { message: string } | null
  /** users.twitter_username for the notification handle. */
  username?: string | null
}

function makeGrantDb(opts: GrantDbOptions) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const probeFilters: Array<[string, unknown]> = []
  const tablesQueried: string[] = []

  const supabase = {
    from: (table: string) => {
      tablesQueried.push(table)
      if (table === 'invite_redemptions') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: opts.redemption ?? null, error: null })
              })
            })
          })
        }
      }
      if (table === 'referral_rewards') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: opts.existingReward ?? null, error: null })
            })
          })
        }
      }
      if (table === 'events_raw') {
        // The probe is a thenable builder: .select('id').limit(1), then the
        // schema-compat layer adds .eq(column, userId), then it is awaited.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const builder: any = {
          select: () => builder,
          limit: () => builder,
          eq: (column: string, value: unknown) => {
            probeFilters.push([column, value])
            return builder
          },
          then: (resolve: any, reject: any) =>
            Promise.resolve({ data: opts.eventsRows ?? [], error: null }).then(resolve, reject)
        }
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return builder
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: opts.username === undefined ? null : { twitter_username: opts.username },
                  error: null
                })
            })
          })
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: opts.rpcAward ?? null, error: opts.rpcError ?? null })
    }
  } as unknown as SupabaseClient

  return { supabase, rpcCalls, probeFilters, tablesQueried }
}

const referralEmbed = { kind: 'referral', created_by: 7 }

describe('maybeGrantReferralReward', () => {
  beforeEach(() => {
    // Reset + reinstall (instead of relying on restoreAllMocks semantics)
    // so implementations and call history are fresh for every test.
    applyEventsUserEqMock.mockReset()
    insertMissingNotificationsMock.mockReset()
    applyEventsUserEqMock.mockImplementation(
      async (_supabase: unknown, query: unknown, userId: number) => ({
        query: (query as { eq: (column: string, value: unknown) => unknown }).eq(
          'user_id',
          userId
        ),
        column: 'user_id'
      })
    )
    insertMissingNotificationsMock.mockImplementation(async () => undefined)
  })

  it('grants without probing events_raw when this sync ingested new events', async () => {
    const db = makeGrantDb({
      redemption: { invite_codes: referralEmbed },
      rpcAward: REFERRAL_POINTS,
      username: 'recruit'
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: true
    })

    expect(awarded).toBe(REFERRAL_POINTS)
    expect(db.rpcCalls).toEqual([
      {
        fn: 'grant_referral_reward',
        args: { p_referrer: 7, p_referred: 42, p_points: REFERRAL_POINTS, p_cap: REFERRAL_CAP }
      }
    ])
    // Fresh ingest IS the activity proof — the stored-events probe is skipped.
    expect(applyEventsUserEqMock).not.toHaveBeenCalled()
    expect(insertMissingNotificationsMock).toHaveBeenCalledWith(db.supabase, 7, [
      expect.objectContaining({
        title: `+${REFERRAL_POINTS} PTS — RECRUIT ACTIVATED`,
        dedupeKey: 'referral_reward_42'
      })
    ])
  })

  it('does not grant on a bare handshake (no ingest, no stored events)', async () => {
    const db = makeGrantDb({
      redemption: { invite_codes: referralEmbed },
      eventsRows: []
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: false
    })

    expect(awarded).toBeNull()
    expect(db.rpcCalls).toHaveLength(0)
    // The probe ran and was scoped through the schema-compat layer.
    expect(db.probeFilters).toEqual([['user_id', 42]])
  })

  it('recovers a previously missed grant when a no-ingest sync finds stored events', async () => {
    const db = makeGrantDb({
      redemption: { invite_codes: referralEmbed },
      eventsRows: [{ id: 991 }],
      rpcAward: REFERRAL_POINTS,
      username: 'recruit'
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: false
    })

    expect(awarded).toBe(REFERRAL_POINTS)
    expect(db.rpcCalls).toHaveLength(1)
  })

  it('treats a missing events identity column as no stored events', async () => {
    applyEventsUserEqMock.mockImplementation(async (_supabase: unknown, query: unknown) => ({
      query,
      column: null
    }))
    const db = makeGrantDb({
      redemption: { invite_codes: referralEmbed },
      eventsRows: [{ id: 1 }]
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: false
    })

    expect(awarded).toBeNull()
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('is a single-query no-op for users who never redeemed an invite', async () => {
    const db = makeGrantDb({})

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: true
    })

    expect(awarded).toBeNull()
    expect(db.rpcCalls).toHaveLength(0)
    // Cost guard: this runs on every sync, so the bail must stay one query.
    expect(db.tablesQueried).toEqual(['invite_redemptions'])
  })

  it('bails after the redemption lookup for non-referral invite kinds', async () => {
    const db = makeGrantDb({
      redemption: { invite_codes: { kind: 'admin', created_by: 7 } }
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: true
    })

    expect(awarded).toBeNull()
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.tablesQueried).toEqual(['invite_redemptions'])
  })

  it('bails when the reward already exists, before probing events', async () => {
    const db = makeGrantDb({
      redemption: { invite_codes: referralEmbed },
      existingReward: { id: 55 }
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: false
    })

    expect(awarded).toBeNull()
    expect(db.rpcCalls).toHaveLength(0)
    expect(applyEventsUserEqMock).not.toHaveBeenCalled()
  })

  it('bails on self-referral', async () => {
    const db = makeGrantDb({
      redemption: { invite_codes: { kind: 'referral', created_by: 42 } }
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: true
    })

    expect(awarded).toBeNull()
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('unwraps the invite_codes embed when PostgREST returns a one-element array', async () => {
    const db = makeGrantDb({
      redemption: { invite_codes: [referralEmbed] },
      rpcAward: REFERRAL_POINTS,
      username: null
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: true
    })

    expect(awarded).toBe(REFERRAL_POINTS)
    expect(db.rpcCalls).toHaveLength(1)
  })

  it('returns 0 and sends the cap notification when the referrer is capped', async () => {
    const db = makeGrantDb({
      redemption: { invite_codes: referralEmbed },
      rpcAward: 0,
      username: null
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: true
    })

    expect(awarded).toBe(0)
    expect(insertMissingNotificationsMock).toHaveBeenCalledWith(db.supabase, 7, [
      expect.objectContaining({ title: 'RECRUIT ACTIVATED — CAP REACHED' })
    ])
  })

  it('returns null when the RPC reports the reward was already granted elsewhere', async () => {
    const db = makeGrantDb({
      redemption: { invite_codes: referralEmbed },
      rpcAward: null
    })

    const awarded = await maybeGrantReferralReward(db.supabase, 42, {
      ingestedNewEvents: true
    })

    expect(awarded).toBeNull()
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })
})
