import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The waitlist queue mints account-creating codes from a table of
// signup PII, so the failure modes under test are the unpleasant ones:
// a non-owner listing emails, ip_address/user_agent escaping through
// the entry contract, a send reaching the DB with no provider config,
// a duplicate email after the RPC refused the claim, and retries that
// drift off the originally minted code (which would break the Resend
// idempotency key and could double-deliver).

const {
  getStaffUserMock,
  checkRateLimitMock,
  fromMock,
  rpcMock,
  configuredMock,
  sendEmailMock
} = vi.hoisted(() => ({
  getStaffUserMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  configuredMock: vi.fn(),
  sendEmailMock: vi.fn()
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: { admin: { windowMs: 60_000, maxRequests: 30 } },
  checkRateLimit: checkRateLimitMock,
  createRateLimitResponse: () => new Headers()
}))

vi.mock('@/lib/staffAuth', () => ({ getStaffUser: getStaffUserMock }))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({ from: fromMock, rpc: rpcMock })
}))

vi.mock('@/lib/inviteEmail', () => ({
  isInviteEmailConfigured: configuredMock,
  sendWaitlistInviteEmail: sendEmailMock
}))

// The route's local candidate — the RPC mock returns a DIFFERENT code,
// so these tests catch a route that emails its own candidate instead of
// the code the RPC actually minted (or reused on retry).
vi.mock('@/lib/inviteCodes', () => ({
  generateInviteCode: () => 'CRIB-CAND-2345'
}))

vi.mock('@/lib/appUrl', () => ({
  resolveAppUrl: () => 'https://cribble.test'
}))

import { GET } from './route'
import { POST } from './[id]/invite/route'

const WAITLIST_ID = '7d3f2a15-4c0b-4e8a-9f6d-1b2c3d4e5f60'
const MINTED_CODE = 'CRIB-QRST-2345'

// The full public Entry contract — nothing else may appear.
const ENTRY_KEYS = [
  'id',
  'email',
  'createdAt',
  'status',
  'attemptCount',
  'lastAttemptAt',
  'sentAt',
  'lastError',
  'code',
  'redeemedBy',
  'redeemedAt'
].sort()

const owner = {
  ok: true as const,
  staff: { userId: 7, username: 'owner', role: 'owner' as const }
}

const rateLimitOk = () => ({
  success: true,
  limit: 30,
  remaining: 29,
  resetTime: Date.now() + 60_000
})

const rateLimitExceeded = () => ({
  success: false,
  limit: 30,
  remaining: 0,
  resetTime: Date.now() + 60_000
})

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    waitlist_id: WAITLIST_ID,
    email: 'first@waitlist.dev',
    created_at: '2026-08-01T00:00:00.000Z',
    attempt_count: null,
    last_attempt_at: null,
    sent_at: null,
    last_error: null,
    code: null,
    redeemed_at: null,
    redeemed_by_username: null,
    queue_status: 'pending',
    ...overrides
  }
}

const state = {
  list: { data: [] as unknown[], count: 0 as number | null, error: null as unknown },
  entryRow: null as Record<string, unknown> | null,
  signup: null as Record<string, unknown> | null,
  trackingUpdates: [] as Record<string, unknown>[]
}

interface BuilderResult {
  data: unknown
  count: number | null
  error: unknown
}

interface FakeBuilder {
  eq: () => FakeBuilder
  ilike: () => FakeBuilder
  order: () => FakeBuilder
  range: () => FakeBuilder
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>
  then: (
    onFulfilled?: (value: BuilderResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise<unknown>
}

// Chainable, awaitable stand-in for the supabase query builder.
function builderFor(result: BuilderResult): FakeBuilder {
  const builder: FakeBuilder = {
    eq: () => builder,
    ilike: () => builder,
    order: () => builder,
    range: () => builder,
    maybeSingle: () => Promise.resolve({ data: result.data, error: result.error }),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
  }
  return builder
}

function fakeFrom(table: string) {
  if (table === 'waitlist_invite_queue') {
    return {
      select: (_columns: string, options?: { count?: 'exact'; head?: boolean }) => {
        if (options?.head) {
          return builderFor({ data: null, count: state.list.count, error: null })
        }
        if (options?.count === 'exact') return builderFor(state.list)
        // POST reloads a single entry after recording the send result.
        return builderFor({ data: state.entryRow, count: null, error: null })
      }
    }
  }
  if (table === 'waitlist') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: state.signup, error: null })
        })
      })
    }
  }
  if (table === 'waitlist_invites') {
    return {
      update: (values: Record<string, unknown>) => {
        state.trackingUpdates.push(values)
        return { eq: () => Promise.resolve({ error: null }) }
      }
    }
  }
  throw new Error(`Unexpected table: ${table}`)
}

const rpcReady = (overrides: Record<string, unknown> = {}) => ({
  data: [
    { outcome: 'ready', invite_code: MINTED_CODE, invite_code_id: 55, attempt: 1, ...overrides }
  ],
  error: null
})

const rpcRefusal = (outcome: string) => ({
  data: [{ outcome, invite_code: null, invite_code_id: null, attempt: null }],
  error: null
})

const rpcCollision = () => ({
  data: null,
  error: { code: '23505', message: 'duplicate key value violates unique constraint' }
})

const getRequest = () => new NextRequest('https://cribble.dev/api/admin/waitlist')
const postRequest = () =>
  new NextRequest(`https://cribble.dev/api/admin/waitlist/${WAITLIST_ID}/invite`, {
    method: 'POST'
  })
const postParams = () => ({ params: Promise.resolve({ id: WAITLIST_ID }) })

beforeEach(() => {
  getStaffUserMock.mockReset()
  getStaffUserMock.mockResolvedValue(owner)
  checkRateLimitMock.mockReset()
  checkRateLimitMock.mockImplementation(rateLimitOk)
  fromMock.mockReset()
  fromMock.mockImplementation(fakeFrom)
  rpcMock.mockReset()
  configuredMock.mockReset()
  configuredMock.mockReturnValue(true)
  sendEmailMock.mockReset()
  sendEmailMock.mockResolvedValue({ ok: true, messageId: 'msg_123' })
  state.list = { data: [queueRow()], count: 1, error: null }
  state.entryRow = queueRow()
  state.signup = { email: 'first@waitlist.dev' }
  state.trackingUpdates = []
})

describe('GET /api/admin/waitlist', () => {
  it('rejects unauthenticated requests before touching the queue', async () => {
    getStaffUserMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await GET(getRequest())

    expect(response.status).toBe(401)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('rejects non-owner staff before touching the queue', async () => {
    getStaffUserMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Owner access required'
    })

    const response = await GET(getRequest())

    expect(response.status).toBe(403)
    expect(getStaffUserMock).toHaveBeenCalledWith(expect.any(NextRequest), 'invite.manage')
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('respects the admin rate limit before auth or data access', async () => {
    checkRateLimitMock.mockImplementation(rateLimitExceeded)

    const response = await GET(getRequest())

    expect(response.status).toBe(429)
    expect(checkRateLimitMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      windowMs: 60_000,
      maxRequests: 30
    })
    expect(getStaffUserMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('returns exactly the entry contract even if the view row carries PII', async () => {
    // A hostile or regressed view could re-expose the waitlist PII
    // columns; the route must still map rows onto the fixed contract.
    state.list = {
      data: [
        queueRow({
          ip_address: '203.0.113.7',
          user_agent: 'Mozilla/5.0 (X11; Linux x86_64)'
        })
      ],
      count: 1,
      error: null
    }

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.entries).toHaveLength(1)
    expect(Object.keys(body.entries[0]).sort()).toEqual(ENTRY_KEYS)
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('203.0.113.7')
    expect(raw).not.toContain('Mozilla')
    expect(body.entries[0]).toMatchObject({
      id: WAITLIST_ID,
      email: 'first@waitlist.dev',
      status: 'pending',
      attemptCount: 0
    })
  })
})

describe('POST /api/admin/waitlist/[id]/invite — access control', () => {
  it('rejects unauthenticated requests before any DB access', async () => {
    getStaffUserMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await POST(postRequest(), postParams())

    expect(response.status).toBe(401)
    expect(fromMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('rejects non-owner staff before any DB access', async () => {
    getStaffUserMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Owner access required'
    })

    const response = await POST(postRequest(), postParams())

    expect(response.status).toBe(403)
    expect(getStaffUserMock).toHaveBeenCalledWith(expect.any(NextRequest), 'invite.manage')
    expect(fromMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('respects the admin rate limit', async () => {
    checkRateLimitMock.mockImplementation(rateLimitExceeded)

    const response = await POST(postRequest(), postParams())

    expect(response.status).toBe(429)
    expect(getStaffUserMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('fails closed with 503 before any DB access when email is unconfigured', async () => {
    configuredMock.mockReturnValue(false)

    const response = await POST(postRequest(), postParams())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Email delivery is not configured'
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/waitlist/[id]/invite — delivery', () => {
  it('sends exactly one email with the RPC-minted code and stable idempotency inputs', async () => {
    rpcMock.mockResolvedValue(rpcReady())
    state.entryRow = queueRow({
      queue_status: 'sent',
      attempt_count: 1,
      code: MINTED_CODE,
      last_attempt_at: '2026-08-09T12:00:00.000Z',
      sent_at: '2026-08-09T12:00:01.000Z'
    })

    const response = await POST(postRequest(), postParams())

    expect(response.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('prepare_waitlist_invite', {
      p_admin_user_id: 7,
      p_waitlist_id: WAITLIST_ID,
      p_code: 'CRIB-CAND-2345'
    })
    // One recipient, the RPC's code (not the local candidate), the join
    // link for that exact code, and the waitlist id that keys Resend
    // idempotency.
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: 'first@waitlist.dev',
      code: MINTED_CODE,
      joinUrl: `https://cribble.test/join/${MINTED_CODE}`,
      waitlistId: WAITLIST_ID
    })
    expect(state.trackingUpdates).toEqual([
      expect.objectContaining({ status: 'sent', provider_message_id: 'msg_123' })
    ])
    const body = await response.json()
    expect(Object.keys(body)).toEqual(['entry'])
    expect(Object.keys(body.entry).sort()).toEqual(ENTRY_KEYS)
    expect(body.entry).toMatchObject({ id: WAITLIST_ID, status: 'sent', code: MINTED_CODE })
  })

  it.each(['already_sent', 'redeemed', 'in_progress'] as const)(
    'answers 409 and never emails after a %s refusal',
    async (outcome) => {
      rpcMock.mockResolvedValue(rpcRefusal(outcome))

      const response = await POST(postRequest(), postParams())

      expect(response.status).toBe(409)
      expect(sendEmailMock).not.toHaveBeenCalled()
      expect(state.trackingUpdates).toHaveLength(0)
    }
  )

  it('answers 404 without emailing when the entry vanished under the RPC', async () => {
    rpcMock.mockResolvedValue(rpcRefusal('not_found'))

    const response = await POST(postRequest(), postParams())

    expect(response.status).toBe(404)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('records a failed provider send and returns 502 with the reloaded entry', async () => {
    rpcMock.mockResolvedValue(rpcReady())
    sendEmailMock.mockResolvedValue({
      ok: false,
      error: 'validation_error: The from address is not verified'
    })
    state.entryRow = queueRow({
      queue_status: 'failed',
      attempt_count: 1,
      code: MINTED_CODE,
      last_error: 'validation_error: The from address is not verified'
    })

    const response = await POST(postRequest(), postParams())

    expect(response.status).toBe(502)
    expect(state.trackingUpdates).toEqual([
      expect.objectContaining({
        status: 'failed',
        last_error: 'validation_error: The from address is not verified'
      })
    ])
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['entry', 'error'])
    expect(body.error).toBe('Email send failed')
    expect(Object.keys(body.entry).sort()).toEqual(ENTRY_KEYS)
    expect(body.entry).toMatchObject({
      status: 'failed',
      lastError: 'validation_error: The from address is not verified'
    })
  })

  it('retries a failed send with the same code and idempotency inputs', async () => {
    // First attempt: claim succeeds, provider fails.
    rpcMock.mockResolvedValueOnce(rpcReady({ attempt: 1 }))
    sendEmailMock.mockResolvedValueOnce({
      ok: false,
      error: 'application_error: upstream hiccup'
    })
    state.entryRow = queueRow({ queue_status: 'failed', attempt_count: 1, code: MINTED_CODE })
    const failed = await POST(postRequest(), postParams())
    expect(failed.status).toBe(502)

    // Retry: the RPC reuses the already-minted code and bumps attempt.
    rpcMock.mockResolvedValueOnce(rpcReady({ attempt: 2 }))
    sendEmailMock.mockResolvedValueOnce({ ok: true, messageId: 'msg_retry' })
    state.entryRow = queueRow({ queue_status: 'sent', attempt_count: 2, code: MINTED_CODE })
    const retried = await POST(postRequest(), postParams())
    expect(retried.status).toBe(200)

    expect(sendEmailMock).toHaveBeenCalledTimes(2)
    const [firstSend] = sendEmailMock.mock.calls[0]
    const [retrySend] = sendEmailMock.mock.calls[1]
    // Identical to/code/joinUrl/waitlistId — the provider idempotency key
    // derived from waitlistId cannot drift between attempts.
    expect(retrySend).toEqual(firstSend)
    expect(retrySend).toMatchObject({ code: MINTED_CODE, waitlistId: WAITLIST_ID })
  })

  it('retries code collisions and still sends exactly one email', async () => {
    rpcMock
      .mockResolvedValueOnce(rpcCollision())
      .mockResolvedValueOnce(rpcCollision())
      .mockResolvedValueOnce(rpcReady())
    state.entryRow = queueRow({ queue_status: 'sent', attempt_count: 1, code: MINTED_CODE })

    const response = await POST(postRequest(), postParams())

    expect(response.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledTimes(3)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })
})
