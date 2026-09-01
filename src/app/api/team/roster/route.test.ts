import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Roster gate semantics. GET answers for TEAM-tier callers (any review
// state), for rejected teams whose tier already reverted to FREE — that
// payload is what renders the REVIEW REJECTED banner on /team instead
// of the generic not-team gate — and for signed OWNERS on a personal
// login (resolveTeamAuthority, 066). Everyone else stays behind the
// 403. DELETE answers to both authorities but scopes an owner to
// PENDING rows only — releasing an ACTIVE member stays franchise-only.
// PATCH (promote/demote) is franchise-login-only outright, enforces
// the 3-owner cap with a fresh count, notifies on promote keyed by the
// affiliation row + role, and retires that notification on demote so a
// re-promotion notifies again. Session auth, rate limiting and seat
// counting are mocked; the gate logic, call shapes and payload shape
// are what's under test.

const { sessionMock, seatUsageMock, notifyMock, state } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  seatUsageMock: vi.fn(),
  notifyMock: vi.fn(),
  state: {
    // users rows keyed by id — the caller's and (for owner callers) the
    // franchise's are distinct reads against the same table.
    usersById: {} as Record<number, Record<string, unknown> | null>,
    // resolveTeamAuthority's owner-affiliation join row (role='owner').
    ownerAffiliation: null as Record<string, unknown> | null,
    rosterRows: [] as Record<string, unknown>[],
    rosterFilters: {} as Record<string, unknown>,
    // PATCH's target lookup (the active member whose role changes).
    roleTarget: null as Record<string, unknown> | null,
    roleTargetFilters: {} as Record<string, unknown>,
    // PATCH's fresh owner head-count.
    ownerCount: 0,
    updateResult: {
      data: [{ id: 44 }] as { id: number }[] | null,
      error: null as { code?: string } | null
    },
    updates: [] as Record<string, unknown>[],
    updateFilters: {} as Record<string, unknown>,
    deleteResult: {
      data: [] as { id: number; member_user_id: number; status: string }[] | null,
      error: null as { code?: string } | null
    },
    deleteFilters: {} as Record<string, unknown>,
    // Demote's dedupe-key retirement against the notifications table.
    notificationDeleteFilters: null as Record<string, unknown> | null
  }
}))

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: sessionMock }))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({
    success: true,
    limit: 60,
    remaining: 59,
    resetTime: Date.now() + 60_000
  }),
  createRateLimitResponse: () => new Headers(),
  rateLimitConfigs: { api: { windowMs: 60_000, maxRequests: 60 } }
}))

vi.mock('@/lib/teams', () => ({
  TEAM_OWNER_LIMIT: 3,
  TEAM_SEAT_LIMIT: 10,
  getTeamSeatUsage: seatUsageMock
}))

vi.mock('@/lib/notifications', () => ({ insertMissingNotifications: notifyMock }))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return builder
          },
          // loadUserRow terminal — keyed by id so the caller's row and
          // the franchise's row resolve independently.
          maybeSingle: () =>
            Promise.resolve({
              data: state.usersById[Number(filters.id)] ?? null,
              error: null
            })
        }
        return builder
      }
      if (table === 'team_affiliations') {
        let op: 'select' | 'update' | 'delete' = 'select'
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return builder
          },
          in: (column: string, values: unknown) => {
            filters[column] = values
            return builder
          },
          // Two maybeSingle lookups share this table: the owner-authority
          // probe (member_user_id + role='owner') and PATCH's target row
          // (team_user_id + member_user_id).
          maybeSingle: () => {
            if (filters.role === 'owner') {
              return Promise.resolve({ data: state.ownerAffiliation, error: null })
            }
            state.roleTargetFilters = filters
            return Promise.resolve({ data: state.roleTarget, error: null })
          },
          update: (values: Record<string, unknown>) => {
            op = 'update'
            state.updates.push(values)
            // Reference, not copy: the eq() calls that follow land here.
            state.updateFilters = filters
            return builder
          },
          delete: () => {
            op = 'delete'
            state.deleteFilters = filters
            return builder
          },
          // Roster query terminal.
          order: () => {
            state.rosterFilters = filters
            return Promise.resolve({ data: state.rosterRows, error: null })
          },
          // Awaited chains land here: the guarded update/delete (both
          // end in .select(…)) and PATCH's owner head-count (select +
          // role filter, no maybeSingle/order).
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) =>
            Promise.resolve(
              op === 'delete'
                ? state.deleteResult
                : op === 'update'
                  ? state.updateResult
                  : filters.role === 'owner'
                    ? { count: state.ownerCount, error: null }
                    : { data: state.rosterRows, error: null }
            ).then(onFulfilled, onRejected)
        }
        return builder
      }
      if (table === 'notifications') {
        const filters: Record<string, unknown> = {}
        const builder = {
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return builder
          },
          delete: () => {
            state.notificationDeleteFilters = filters
            return builder
          },
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve({ error: null }).then(onFulfilled, onRejected)
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { DELETE, GET, PATCH } from './route'

const TEAM_CALLER = {
  id: 7,
  twitter_username: 'acme',
  twitter_name: 'ACME Corp',
  twitter_profile_image: null,
  subscription_tier: 'TEAM',
  team_review_status: 'pending',
  status: 'active'
}

const APPROVED_TEAM = { ...TEAM_CALLER, team_review_status: 'approved' }

const OWNER_CALLER = {
  id: 33,
  twitter_username: 'skipper',
  twitter_name: 'Skipper',
  twitter_profile_image: null,
  subscription_tier: 'FREE',
  team_review_status: null,
  status: 'active'
}

const ROSTER_ROW = {
  id: 44,
  status: 'active',
  role: 'member',
  invited_at: '2026-08-01T00:00:00Z',
  accepted_at: '2026-08-01T01:00:00Z',
  member: {
    id: 21,
    twitter_username: 'pilot',
    twitter_name: 'Pilot One',
    twitter_profile_image: null,
    subscription_tier: 'FREE',
    team_review_status: null,
    status: 'active'
  }
}

const getRequest = () => new NextRequest('https://cribble.dev/api/team/roster')
const deleteRequest = (affiliationId: number) =>
  new NextRequest(`https://cribble.dev/api/team/roster?affiliationId=${affiliationId}`, {
    method: 'DELETE'
  })
const patchRequest = (body: unknown) =>
  new NextRequest('https://cribble.dev/api/team/roster', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })

function resetState() {
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: true, userId: 7 })
  seatUsageMock.mockReset()
  seatUsageMock.mockResolvedValue(3)
  notifyMock.mockReset()
  notifyMock.mockResolvedValue(undefined)
  state.usersById = { 7: { ...TEAM_CALLER } }
  state.ownerAffiliation = null
  state.rosterRows = []
  state.rosterFilters = {}
  state.roleTarget = null
  state.roleTargetFilters = {}
  state.ownerCount = 0
  state.updateResult = { data: [{ id: 44 }], error: null }
  state.updates = []
  state.updateFilters = {}
  state.deleteResult = { data: [], error: null }
  state.deleteFilters = {}
  state.notificationDeleteFilters = null
}

describe('/api/team/roster — tier gate and the rejected-state exception', () => {
  beforeEach(resetState)

  it('GET 403s a plain non-team caller', async () => {
    state.usersById = {
      7: { ...TEAM_CALLER, subscription_tier: 'FREE', team_review_status: null }
    }

    const response = await GET(getRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
  })

  it('GET answers for a TEAM caller still under review', async () => {
    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      authority: 'team-account',
      reviewStatus: 'pending',
      approved: false
    })
  })

  it('GET reports approved for a TEAM caller past review', async () => {
    state.usersById = { 7: { ...APPROVED_TEAM } }

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reviewStatus: 'approved',
      approved: true
    })
  })

  it('GET answers for a rejected team whose tier already reverted to FREE', async () => {
    state.usersById = {
      7: { ...TEAM_CALLER, subscription_tier: 'FREE', team_review_status: 'rejected' }
    }
    state.rosterRows = [{ ...ROSTER_ROW }]

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      reviewStatus: 'rejected',
      approved: false,
      seatLimit: 10,
      seatsUsed: 3
    })
    expect(body.members).toEqual([
      {
        affiliationId: 44,
        status: 'active',
        role: 'member',
        invitedAt: '2026-08-01T00:00:00Z',
        acceptedAt: '2026-08-01T01:00:00Z',
        userId: 21,
        username: 'pilot',
        name: 'Pilot One',
        avatar: null
      }
    ])
  })

  it('DELETE still 403s the rejected caller — mutations stay gated', async () => {
    state.usersById = {
      7: { ...TEAM_CALLER, subscription_tier: 'FREE', team_review_status: 'rejected' }
    }

    const response = await DELETE(deleteRequest(44))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('/api/team/roster — applied rows never ride the roster lane', () => {
  beforeEach(() => {
    resetState()
    state.usersById = { 7: { ...APPROVED_TEAM } }
  })

  it('GET scopes the query to pending + active — transfer requests stay off the payload', async () => {
    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    expect(state.rosterFilters).toEqual({
      team_user_id: 7,
      status: ['pending', 'active']
    })
  })

  it('DELETE scopes to pending + active — it can never swallow an applied row silently', async () => {
    state.deleteResult = { data: [{ id: 44, member_user_id: 21, status: 'active' }], error: null }

    const response = await DELETE(deleteRequest(44))

    expect(response.status).toBe(200)
    expect(state.deleteFilters).toEqual({
      id: 44,
      team_user_id: 7,
      status: ['pending', 'active']
    })
  })

  it('DELETE 404s an applied row (filtered out by the status scope) without notifying', async () => {
    // The scoped delete matches nothing — the applied row is the
    // applications lane's to PASS, with its own notification.
    state.deleteResult = { data: [], error: null }

    const response = await DELETE(deleteRequest(900))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Roster entry not found' })
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('/api/team/roster — owner authority', () => {
  beforeEach(() => {
    resetState()
    sessionMock.mockResolvedValue({ ok: true, userId: 33 })
    state.usersById = { 33: { ...OWNER_CALLER }, 7: { ...APPROVED_TEAM } }
    state.ownerAffiliation = { team_user_id: 7, team: { ...APPROVED_TEAM } }
  })

  it("GET answers an OWNER with the FRANCHISE's roster and review state", async () => {
    state.rosterRows = [{ ...ROSTER_ROW, role: 'owner' }]

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      authority: 'owner',
      reviewStatus: 'approved',
      approved: true
    })
    expect(body.members[0]).toMatchObject({ affiliationId: 44, role: 'owner' })
    expect(state.rosterFilters).toEqual({
      team_user_id: 7,
      status: ['pending', 'active']
    })
    expect(seatUsageMock).toHaveBeenCalledWith(expect.anything(), 7)
  })

  it('GET 403s a plain ACTIVE member without the owner role', async () => {
    state.ownerAffiliation = null

    const response = await GET(getRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
  })

  it('DELETE lets an owner revoke a PENDING invite — the delete is scoped to pending only', async () => {
    state.deleteResult = { data: [{ id: 50, member_user_id: 22, status: 'pending' }], error: null }

    const response = await DELETE(deleteRequest(50))

    expect(response.status).toBe(200)
    expect(state.deleteFilters).toEqual({
      id: 50,
      team_user_id: 7,
      status: ['pending']
    })
    // Pending revocations stay silent regardless of who clicked.
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it("DELETE 404s an owner's release attempt — the pending-only scope never matches an ACTIVE row", async () => {
    // The scoped delete matches nothing: releasing members is franchise-only.
    state.deleteResult = { data: [], error: null }

    const response = await DELETE(deleteRequest(44))

    expect(response.status).toBe(404)
    expect(state.deleteFilters).toEqual({
      id: 44,
      team_user_id: 7,
      status: ['pending']
    })
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/team/roster — promote/demote, franchise login only', () => {
  beforeEach(() => {
    resetState()
    state.usersById = { 7: { ...APPROVED_TEAM } }
    state.roleTarget = { id: 44, role: 'member' }
  })

  it('403s an OWNER — owners never mint or strip other owners', async () => {
    sessionMock.mockResolvedValue({ ok: true, userId: 33 })
    state.usersById = { 33: { ...OWNER_CALLER }, 7: { ...APPROVED_TEAM } }
    state.ownerAffiliation = { team_user_id: 7, team: { ...APPROVED_TEAM } }

    const response = await PATCH(patchRequest({ memberUserId: 21, role: 'owner' }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Role changes need the team login'
    })
    expect(state.updates).toHaveLength(0)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('403s an under-review team', async () => {
    state.usersById = { 7: { ...TEAM_CALLER } }

    const response = await PATCH(patchRequest({ memberUserId: 21, role: 'owner' }))

    expect(response.status).toBe(403)
    expect(state.updates).toHaveLength(0)
  })

  it('400s a role outside the member/owner union', async () => {
    const response = await PATCH(patchRequest({ memberUserId: 21, role: 'captain' }))

    expect(response.status).toBe(400)
  })

  it('404s when the target is not an ACTIVE member of this team', async () => {
    state.roleTarget = null

    const response = await PATCH(patchRequest({ memberUserId: 21, role: 'owner' }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Roster entry not found' })
    expect(state.roleTargetFilters).toEqual({
      team_user_id: 7,
      member_user_id: 21,
      status: 'active'
    })
  })

  it('promotes via the guarded update and sends the FRONT OFFICE notification', async () => {
    const response = await PATCH(patchRequest({ memberUserId: 21, role: 'owner' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      memberUserId: 21,
      role: 'owner'
    })
    expect(state.updates).toEqual([{ role: 'owner' }])
    expect(state.updateFilters).toEqual({ id: 44, team_user_id: 7, status: 'active' })
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), 21, [
      expect.objectContaining({
        type: 'team_promotion',
        title: 'FRONT OFFICE',
        body: '@acme handed you the front-office keys — you now run the team from your own account.',
        dedupeKey: 'team_promotion_44_owner',
        data: expect.objectContaining({ teamUserId: 7, affiliationId: 44 })
      })
    ])
  })

  it('409s a promote past the owner cap — counted fresh, nothing written', async () => {
    state.ownerCount = 3

    const response = await PATCH(patchRequest({ memberUserId: 21, role: 'owner' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'All 3 owner seats are held'
    })
    expect(state.updates).toHaveLength(0)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('demotes without notifying and retires the promotion dedupe key', async () => {
    state.roleTarget = { id: 44, role: 'owner' }

    const response = await PATCH(patchRequest({ memberUserId: 21, role: 'member' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      memberUserId: 21,
      role: 'member'
    })
    expect(state.updates).toEqual([{ role: 'member' }])
    expect(notifyMock).not.toHaveBeenCalled()
    // Freed key = a later re-promotion of this row notifies again.
    expect(state.notificationDeleteFilters).toEqual({
      user_id: 21,
      dedupe_key: 'team_promotion_44_owner'
    })
  })

  it('answers an idempotent no-op when the role already matches — no write, no notification', async () => {
    state.roleTarget = { id: 44, role: 'owner' }

    const response = await PATCH(patchRequest({ memberUserId: 21, role: 'owner' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      memberUserId: 21,
      role: 'owner'
    })
    expect(state.updates).toHaveLength(0)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('409s when the guarded update matches nothing (member left mid-flight)', async () => {
    state.updateResult = { data: [], error: null }

    const response = await PATCH(patchRequest({ memberUserId: 21, role: 'owner' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Roster entry is no longer available'
    })
    expect(notifyMock).not.toHaveBeenCalled()
  })
})
