import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_TOKEN_HEADER, hashDeviceSyncToken } from '@/lib/deviceToken'
import { refreshLeaderboardSnapshot } from '@/lib/leaderboardSnapshot'
import { maybeGrantReferralReward } from '@/lib/referrals'
import { recalculateUserScore } from '@/lib/scoring'

// ── Mock plumbing ─────────────────────────────────────────────────────────
// The route builds its Supabase client at module load, so the fake client
// must exist before the import. State is mutable per test; the query stub
// routes every from()/rpc() call through `state` and records writes.

interface DeviceRow {
  user_id: number
  is_active: boolean
  sync_token_hash: string | null
}

interface MockState {
  deviceUuid: string
  device: DeviceRow | null
  deviceUpdates: Array<Record<string, unknown>>
  userUpdates: Array<Record<string, unknown>>
  /** Injected transient failure for the user_devices select. */
  deviceLookupError: { code?: string; message: string } | null
  /** Rows the pre-insert dedupe select reports as already stored. */
  existingEventRows: Array<{ domain: string; timestamp: string }>
  /** Injected failure for the events_raw upsert. */
  eventsUpsertError: { message: string } | null
  /** Row returned by the user_scores select after recalculation. */
  userScoresRow: { total_score: number; today_score: number } | null
}

const { state, rpcMock, sessionMock, supabaseMock } = vi.hoisted(() => {
  const state: MockState = {
    deviceUuid: '',
    device: null,
    deviceUpdates: [],
    userUpdates: [],
    deviceLookupError: null,
    existingEventRows: [],
    eventsUpsertError: null,
    userScoresRow: null
  }

  interface QueryContext {
    table: string
    op: 'select' | 'update' | 'insert' | 'upsert'
    filters: Array<[string, unknown]>
    values?: unknown
    usedIn?: boolean
  }

  function resolveQuery(ctx: QueryContext): { data: unknown; error: unknown } {
    if (ctx.table === 'user_devices' && ctx.op === 'select') {
      if (state.deviceLookupError) {
        return { data: null, error: state.deviceLookupError }
      }
      const device = state.device
      if (!device) return { data: null, error: { code: 'PGRST116' } }
      const filters = Object.fromEntries(ctx.filters)
      if ('device_uuid' in filters && filters.device_uuid !== state.deviceUuid) {
        return { data: null, error: { code: 'PGRST116' } }
      }
      if ('user_id' in filters && Number(filters.user_id) !== device.user_id) {
        return { data: null, error: { code: 'PGRST116' } }
      }
      if ('is_active' in filters && filters.is_active !== device.is_active) {
        return { data: null, error: { code: 'PGRST116' } }
      }
      return { data: { id: 1, ...device }, error: null }
    }

    if (ctx.table === 'user_devices' && ctx.op === 'update') {
      const values = ctx.values as Record<string, unknown>
      state.deviceUpdates.push(values)
      if (state.device && typeof values.sync_token_hash === 'string') {
        state.device.sync_token_hash = values.sync_token_hash
      }
      return { data: null, error: null }
    }

    if (ctx.table === 'users' && ctx.op === 'update') {
      state.userUpdates.push(ctx.values as Record<string, unknown>)
      return { data: null, error: null }
    }

    if (ctx.table === 'events_raw' && ctx.op === 'select') {
      // The dedupe query filters .in('timestamp', …); the 24h usage query
      // does not. Only the former sees "already stored" rows.
      if (ctx.usedIn) return { data: state.existingEventRows, error: null }
      return { data: [], error: null }
    }

    if (ctx.table === 'events_raw' && ctx.op === 'upsert') {
      if (state.eventsUpsertError) {
        return { data: null, error: state.eventsUpsertError }
      }
      return { data: ctx.values, error: null }
    }

    if (ctx.table === 'user_scores' && ctx.op === 'select') {
      return { data: state.userScoresRow, error: null }
    }

    return { data: null, error: null }
  }

  function from(table: string) {
    const ctx: QueryContext = { table, op: 'select', filters: [] }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      select: () => builder,
      update: (values: unknown) => {
        ctx.op = 'update'
        ctx.values = values
        return builder
      },
      insert: (values: unknown) => {
        ctx.op = 'insert'
        ctx.values = values
        return builder
      },
      upsert: (values: unknown) => {
        ctx.op = 'upsert'
        ctx.values = values
        return builder
      },
      eq: (column: string, value: unknown) => {
        ctx.filters.push([column, value])
        return builder
      },
      gt: () => builder,
      gte: () => builder,
      in: () => {
        ctx.usedIn = true
        return builder
      },
      limit: () => builder,
      maybeSingle: async () => {
        const result = resolveQuery(ctx)
        // maybeSingle treats "no row" (the stub's synthetic PGRST116) as
        // data:null without error; real query failures pass through.
        const code = (result.error as { code?: string } | null)?.code
        if (code === 'PGRST116') return { data: result.data, error: null }
        return result
      },
      single: async () => resolveQuery(ctx),
      then: (resolve: any, reject: any) =>
        Promise.resolve(resolveQuery(ctx)).then(resolve, reject)
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return builder
  }

  const rpcMock = vi.fn()
  const sessionMock = vi.fn()
  const supabaseMock = { from, rpc: rpcMock }

  return { state, rpcMock, sessionMock, supabaseMock }
})

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => supabaseMock
}))

vi.mock('@/lib/sessionAuth', () => ({
  getSessionUserId: sessionMock
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: { ingestion: { windowMs: 60_000, maxRequests: 100 } },
  checkRateLimit: () => ({
    success: true,
    limit: 100,
    remaining: 99,
    resetTime: Date.now() + 60_000
  }),
  createRateLimitResponse: () => new Headers()
}))

vi.mock('@/lib/scoring', () => ({
  recalculateUserScore: vi.fn(async () => ({ scoresStale: false }))
}))

vi.mock('@/lib/achievementsServer', () => ({
  evaluateAchievements: vi.fn(async () => undefined)
}))

vi.mock('@/lib/leaderboardSnapshot', () => ({
  refreshLeaderboardSnapshot: vi.fn(async () => undefined)
}))

vi.mock('@/lib/notifications', () => ({
  evaluateScoreNotifications: vi.fn(async () => undefined)
}))

vi.mock('@/lib/referrals', () => ({
  // Resolves null = "nothing newly granted"; individual tests override with
  // mockResolvedValueOnce to simulate a fresh grant.
  maybeGrantReferralReward: vi.fn(async () => null)
}))

vi.mock('@/lib/eventsIdentity', () => ({
  applyEventsUserEq: vi.fn(async (_supabase: unknown, query: unknown) => ({
    query,
    column: 'user_id'
  })),
  buildEventsUserInsertFields: vi.fn(async (_supabase: unknown, userId: number) => ({
    user_id: userId
  }))
}))

vi.mock('@/lib/aiDomains', () => ({
  resolveTrackedAiDomain: (domain: string) => domain
}))

// The route defers post-ingest side work via after(), which requires a Next
// request scope vitest doesn't provide (the real one throws without it).
// Run the task immediately instead; NextRequest/NextResponse stay real.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (task: Promise<unknown> | (() => unknown)) => {
      if (typeof task === 'function') void task()
    }
  }
})

import { POST } from './route'

const DEVICE_UUID = '5b0d4a52-7f6e-4c2a-9a1c-3f9e8d7c6b5a'
const OLD_USER = 1
const NEW_USER = 2

function makeSyncRequest(options: {
  userId?: number
  token?: string
  events?: unknown[]
}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token) headers[DEVICE_TOKEN_HEADER] = options.token
  return new NextRequest('https://cribble.dev/api/extension/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      deviceUuid: DEVICE_UUID,
      ...(options.userId ? { userId: options.userId } : {}),
      events: options.events ?? [],
      batchId: 'batch-1'
    })
  })
}

// Mirrors migration 027: rebind to the claiming user, revoke the previous
// account's sync token in the same statement.
function rpcBehavesLikeMigration027() {
  rpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'register_user_device') return { data: null, error: { message: 'unknown rpc' } }
    const claimingUser = Number(args.p_user_id)
    if (state.device && state.device.user_id !== claimingUser) {
      state.device = { user_id: claimingUser, is_active: true, sync_token_hash: null }
    } else {
      state.device = {
        user_id: claimingUser,
        is_active: true,
        sync_token_hash: state.device?.sync_token_hash ?? null
      }
    }
    return { data: true, error: null }
  })
}

beforeEach(() => {
  state.deviceUuid = DEVICE_UUID
  state.device = null
  state.deviceUpdates = []
  state.userUpdates = []
  state.deviceLookupError = null
  state.existingEventRows = []
  state.eventsUpsertError = null
  state.userScoresRow = null
  rpcMock.mockReset()
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
  // Deferred-work mocks accumulate calls across tests; clear the history
  // (implementations from the factories stay) so per-test call assertions
  // see only their own sync.
  vi.mocked(maybeGrantReferralReward).mockClear()
  vi.mocked(refreshLeaderboardSnapshot).mockClear()
})

describe('POST /api/extension/sync — relink / account switch', () => {
  it('transfers a device actively linked to another account to the session user', async () => {
    // Device linked to the GitHub user; a different X user is now signed in.
    state.device = {
      user_id: OLD_USER,
      is_active: true,
      sync_token_hash: hashDeviceSyncToken('old-account-token')
    }
    sessionMock.mockResolvedValue({ ok: true, userId: NEW_USER })
    rpcBehavesLikeMigration027()

    const response = await POST(makeSyncRequest({ userId: NEW_USER }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    // A fresh sync token is issued to the new owner…
    expect(typeof body.syncToken).toBe('string')
    expect(body.syncToken.length).toBeGreaterThan(0)
    // …and the binding now belongs to the new user.
    expect(rpcMock).toHaveBeenCalledWith(
      'register_user_device',
      expect.objectContaining({ p_user_id: NEW_USER, p_device_uuid: DEVICE_UUID })
    )
    expect(state.device?.user_id).toBe(NEW_USER)
    // The old account's token no longer verifies: the stored hash is the
    // NEW token's hash.
    expect(state.device?.sync_token_hash).toBe(hashDeviceSyncToken(body.syncToken))
    expect(state.device?.sync_token_hash).not.toBe(hashDeviceSyncToken('old-account-token'))
  })

  it('re-registration by the current owner is an idempotent success', async () => {
    state.device = {
      user_id: NEW_USER,
      is_active: true,
      sync_token_hash: hashDeviceSyncToken('current-token')
    }
    sessionMock.mockResolvedValue({ ok: true, userId: NEW_USER })
    rpcBehavesLikeMigration027()

    const response = await POST(makeSyncRequest({ userId: NEW_USER }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(typeof body.syncToken).toBe('string')
    expect(state.device?.user_id).toBe(NEW_USER)
  })

  it('returns 409 DEVICE_TRANSFER_BLOCKED while the pre-027 RPC is still deployed', async () => {
    state.device = {
      user_id: OLD_USER,
      is_active: true,
      sync_token_hash: hashDeviceSyncToken('old-account-token')
    }
    sessionMock.mockResolvedValue({ ok: true, userId: NEW_USER })
    // Legacy RPC raises check_violation instead of transferring.
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: '23514',
        message: `device ${DEVICE_UUID} is already linked to another active account`
      }
    })

    const response = await POST(makeSyncRequest({ userId: NEW_USER }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.code).toBe('DEVICE_TRANSFER_BLOCKED')
  })

  it('rejects the old extension state with 401 after a transfer (revoked token, stale claim)', async () => {
    // Device was transferred to NEW_USER; the extension still holds the old
    // account's token and claims the old userId. No dashboard session on
    // background sync requests.
    state.device = {
      user_id: NEW_USER,
      is_active: true,
      sync_token_hash: hashDeviceSyncToken('new-account-token')
    }

    const response = await POST(
      makeSyncRequest({ userId: OLD_USER, token: 'old-account-token' })
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.code).toBe('REGISTRATION_REQUIRED')
    // No writes happened for the stale identity.
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('accepts ingestion for the currently bound user without rotating the token', async () => {
    state.device = {
      user_id: NEW_USER,
      is_active: true,
      sync_token_hash: hashDeviceSyncToken('new-account-token')
    }

    const response = await POST(
      makeSyncRequest({ userId: NEW_USER, token: 'new-account-token' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.syncToken).toBeUndefined()
    expect(rpcMock).not.toHaveBeenCalled()
    // Attribution comes from the device binding: last_extension_sync is
    // written for the bound user, not the claimed one.
    expect(state.userUpdates.length).toBeGreaterThan(0)
  })

  it('rejects a claim that does not match the session user with 403 USER_MISMATCH', async () => {
    state.device = {
      user_id: OLD_USER,
      is_active: true,
      sync_token_hash: hashDeviceSyncToken('old-account-token')
    }
    sessionMock.mockResolvedValue({ ok: true, userId: NEW_USER })

    const response = await POST(makeSyncRequest({ userId: OLD_USER }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('USER_MISMATCH')
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

// A registered, active device syncing with its valid token (path 1).
function bindActiveDevice() {
  state.device = {
    user_id: NEW_USER,
    is_active: true,
    sync_token_hash: hashDeviceSyncToken('new-account-token')
  }
}

function makeVisitEvent(timestamp: number) {
  return { type: 'visit', domain: 'chatgpt.com', timestamp }
}

describe('POST /api/extension/sync — transient failures and serverScore', () => {
  it('returns 503 DEVICE_LOOKUP_FAILED when the device lookup errors (NOT 401)', async () => {
    // A transient DB failure must not read as "unknown device": a 401 would
    // make the extension discard its perfectly valid sync token.
    bindActiveDevice()
    state.deviceLookupError = { message: 'connection timeout' }

    const response = await POST(
      makeSyncRequest({ userId: NEW_USER, token: 'new-account-token' })
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.success).toBe(false)
    expect(body.code).toBe('DEVICE_LOOKUP_FAILED')
    // The request never fell through to registration or ingestion.
    expect(rpcMock).not.toHaveBeenCalled()
    expect(state.userUpdates.length).toBe(0)
  })

  it('returns 500 EVENT_INSERT_FAILED when the events upsert errors', async () => {
    // The batch was NOT stored; success:true would make the extension
    // delete it from its local queue (silent data loss).
    bindActiveDevice()
    state.eventsUpsertError = { message: 'insert exploded' }

    const response = await POST(
      makeSyncRequest({
        userId: NEW_USER,
        token: 'new-account-token',
        events: [makeVisitEvent(Date.now() - 60_000)]
      })
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.code).toBe('EVENT_INSERT_FAILED')
    // Sync markers must not advance on a failed ingest.
    expect(state.deviceUpdates.length).toBe(0)
    expect(state.userUpdates.length).toBe(0)
  })

  it('includes serverScore with the recalculated user_scores totals on successful ingest', async () => {
    bindActiveDevice()
    // Fractional totals prove the response rounds to integers.
    state.userScoresRow = { total_score: 1234.6, today_score: 88.2 }

    const response = await POST(
      makeSyncRequest({
        userId: NEW_USER,
        token: 'new-account-token',
        events: [makeVisitEvent(Date.now() - 60_000)]
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.processed).toBe(1)
    expect(body.serverScore).toEqual({ totalScore: 1235, todayScore: 88 })
  })

  it('omits serverScore when the user_scores read returns no row', async () => {
    bindActiveDevice()
    state.userScoresRow = null

    const response = await POST(
      makeSyncRequest({
        userId: NEW_USER,
        token: 'new-account-token',
        events: [makeVisitEvent(Date.now() - 60_000)]
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.processed).toBe(1)
    expect(body.serverScore).toBeUndefined()
  })

  it('keeps success:true when every event already exists in the database', async () => {
    // Benign outcome: the rows are stored (from an earlier attempt), so the
    // extension may safely drop the batch. No insertFailed, no serverScore
    // (processed === 0 skips the recalculation).
    bindActiveDevice()
    const timestamp = Date.now() - 60_000
    state.existingEventRows = [
      { domain: 'chatgpt.com', timestamp: new Date(timestamp).toISOString() }
    ]

    const response = await POST(
      makeSyncRequest({
        userId: NEW_USER,
        token: 'new-account-token',
        events: [makeVisitEvent(timestamp)]
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.processed).toBe(0)
    expect(body.errors).toEqual(['All events already exist in database'])
    expect(body.serverScore).toBeUndefined()
    // The benign path still advances the device/user sync markers.
    expect(state.deviceUpdates.length).toBeGreaterThan(0)
    expect(state.userUpdates.length).toBeGreaterThan(0)
  })
})

// The referral reward credits the REFERRER, so it must not hide behind this
// user's processed>0 / fresh-score gates: a duplicate batch (processed 0)
// or a stale recalculation is exactly when a previously missed grant gets
// its retry. These pin that the deferred grant runs on those paths too.
describe('POST /api/extension/sync — deferred referral grant', () => {
  it('evaluates the grant with ingestedNewEvents=false when every event is a duplicate', async () => {
    bindActiveDevice()
    const timestamp = Date.now() - 60_000
    state.existingEventRows = [
      { domain: 'chatgpt.com', timestamp: new Date(timestamp).toISOString() }
    ]

    const response = await POST(
      makeSyncRequest({
        userId: NEW_USER,
        token: 'new-account-token',
        events: [makeVisitEvent(timestamp)]
      })
    )
    const body = await response.json()

    expect(body.success).toBe(true)
    expect(body.processed).toBe(0)
    expect(maybeGrantReferralReward).toHaveBeenCalledWith(supabaseMock, NEW_USER, {
      ingestedNewEvents: false
    })
    // Nothing recalculated and nothing granted: no reason to re-diff ranks.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(refreshLeaderboardSnapshot).not.toHaveBeenCalled()
  })

  it('evaluates the grant even when the score recalculation is stale', async () => {
    bindActiveDevice()
    vi.mocked(recalculateUserScore).mockResolvedValueOnce({ scoresStale: true })

    const response = await POST(
      makeSyncRequest({
        userId: NEW_USER,
        token: 'new-account-token',
        events: [makeVisitEvent(Date.now() - 60_000)]
      })
    )
    const body = await response.json()

    expect(body.success).toBe(true)
    // Stale recalc omits serverScore but must not starve the grant; this
    // sync DID ingest rows, so the helper is told so.
    expect(body.serverScore).toBeUndefined()
    expect(maybeGrantReferralReward).toHaveBeenCalledWith(supabaseMock, NEW_USER, {
      ingestedNewEvents: true
    })
  })

  it('refreshes the leaderboard snapshot when a no-ingest sync newly grants points', async () => {
    bindActiveDevice()
    // Retry path succeeds: the referrer's total_score just moved, so the
    // board snapshot must be re-diffed even though processed === 0.
    vi.mocked(maybeGrantReferralReward).mockResolvedValueOnce(1500)

    const response = await POST(
      makeSyncRequest({ userId: NEW_USER, token: 'new-account-token', events: [] })
    )
    const body = await response.json()

    expect(body.success).toBe(true)
    expect(body.processed).toBe(0)
    expect(maybeGrantReferralReward).toHaveBeenCalledWith(supabaseMock, NEW_USER, {
      ingestedNewEvents: false
    })
    await vi.waitFor(() => expect(refreshLeaderboardSnapshot).toHaveBeenCalledTimes(1))
  })
})
