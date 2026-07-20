import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_TOKEN_HEADER, hashDeviceSyncToken } from '@/lib/deviceToken'

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
}

const { state, rpcMock, sessionMock, supabaseMock } = vi.hoisted(() => {
  const state: MockState = {
    deviceUuid: '',
    device: null,
    deviceUpdates: [],
    userUpdates: []
  }

  interface QueryContext {
    table: string
    op: 'select' | 'update' | 'insert' | 'upsert'
    filters: Array<[string, unknown]>
    values?: unknown
  }

  function resolveQuery(ctx: QueryContext): { data: unknown; error: unknown } {
    if (ctx.table === 'user_devices' && ctx.op === 'select') {
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
      in: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        const result = resolveQuery(ctx)
        // maybeSingle treats "no row" as data:null without error
        return { data: result.data, error: null }
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

vi.mock('@/lib/notifications', () => ({
  evaluateScoreNotifications: vi.fn(async () => undefined)
}))

vi.mock('@/lib/referrals', () => ({
  maybeGrantReferralReward: vi.fn(async () => undefined)
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
  rpcMock.mockReset()
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
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
