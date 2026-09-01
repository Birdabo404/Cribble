import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The invite route's guard chain, in the order it runs: an approved
// team (through its franchise login or a signed OWNER's personal
// account, resolveTeamAuthority 066) → free seat → resolvable target
// (not banned/suspended, not the team itself, not another team, not
// already on a team) → insert scoped to the TEAM's id. The unique
// indexes are the race backstop: a 23505 must come back as a friendly
// 409, never a 500. Session auth, rate limiting, seat counting and the
// notification writer are mocked; the guard logic and the Supabase
// call shapes are what's under test.

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
    targets: [] as Record<string, unknown>[],
    activeCount: 0,
    insertResult: { data: { id: 501 } as { id: number } | null, error: null as { code?: string } | null },
    insertedRows: [] as Record<string, unknown>[]
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
          ilike: () => builder,
          // loadUserRow terminal — keyed by id so the caller's row and
          // the franchise's row resolve independently.
          maybeSingle: () =>
            Promise.resolve({
              data: state.usersById[Number(filters.id)] ?? null,
              error: null
            }),
          // Callsign lookup terminal.
          limit: () => Promise.resolve({ data: state.targets, error: null })
        }
        return builder
      }
      if (table === 'team_affiliations') {
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return builder
          },
          // resolveTeamAuthority's owner-affiliation lookup terminal.
          maybeSingle: () =>
            Promise.resolve({
              data: filters.role === 'owner' ? state.ownerAffiliation : null,
              error: null
            }),
          // Awaited head-count query (active-affiliation check).
          then: (
            onFulfilled: (value: { count: number; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) =>
            Promise.resolve({ count: state.activeCount, error: null }).then(
              onFulfilled,
              onRejected
            ),
          insert: (values: Record<string, unknown>) => {
            state.insertedRows.push(values)
            return {
              select: () => ({ single: () => Promise.resolve(state.insertResult) })
            }
          }
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { POST } from './route'

const TEAM_CALLER = {
  id: 7,
  twitter_username: 'acme',
  twitter_name: 'ACME Corp',
  twitter_profile_image: 'https://img.example/acme.png',
  subscription_tier: 'TEAM',
  team_review_status: 'approved',
  status: 'active'
}

const FREE_TARGET = {
  id: 21,
  twitter_username: 'pilot',
  twitter_name: 'Pilot One',
  twitter_profile_image: null,
  subscription_tier: 'FREE',
  team_review_status: null,
  status: 'active'
}

function inviteRequest(callsign: string) {
  return new NextRequest('https://cribble.dev/api/team/invite', {
    method: 'POST',
    body: JSON.stringify({ callsign }),
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('POST /api/team/invite — guard chain and race backstop', () => {
  beforeEach(() => {
    sessionMock.mockReset()
    sessionMock.mockResolvedValue({ ok: true, userId: 7 })
    seatUsageMock.mockReset()
    seatUsageMock.mockResolvedValue(3)
    notifyMock.mockReset()
    notifyMock.mockResolvedValue(undefined)
    state.usersById = { 7: { ...TEAM_CALLER } }
    state.ownerAffiliation = null
    state.targets = [{ ...FREE_TARGET }]
    state.activeCount = 0
    state.insertResult = { data: { id: 501 }, error: null }
    state.insertedRows = []
  })

  it('403s a TEAM account still under review — pay-first does not unlock invites', async () => {
    state.usersById = { 7: { ...TEAM_CALLER, team_review_status: 'pending' } }

    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(403)
    expect(state.insertedRows).toHaveLength(0)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('403s a caller with no authority outright', async () => {
    state.usersById = { 7: { ...TEAM_CALLER, subscription_tier: 'PRO' } }

    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
  })

  it('409s when all seats (pending + active) are already held', async () => {
    seatUsageMock.mockResolvedValue(10)

    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(409)
    expect(state.insertedRows).toHaveLength(0)
  })

  it('answers "not found" for banned targets — invites must not leak moderation state', async () => {
    state.targets = [{ ...FREE_TARGET, status: 'banned' }]

    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Callsign not found' })
  })

  it('400s when the target is itself a TEAM account', async () => {
    state.targets = [{ ...FREE_TARGET, subscription_tier: 'TEAM' }]

    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(400)
    expect(state.insertedRows).toHaveLength(0)
  })

  it('409s when the target already has an ACTIVE affiliation (pending invites elsewhere are fine)', async () => {
    state.activeCount = 1

    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(409)
    expect(state.insertedRows).toHaveLength(0)
  })

  it('inserts a pending row and notifies the member with a row-keyed dedupe', async () => {
    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      seatsUsed: 4,
      seatLimit: 10
    })
    expect(state.insertedRows).toEqual([
      { team_user_id: 7, member_user_id: 21, status: 'pending' }
    ])
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), 21, [
      expect.objectContaining({
        type: 'team_invite',
        dedupeKey: 'team_invite_501',
        data: expect.objectContaining({ teamUserId: 7, affiliationId: 501 })
      })
    ])
  })

  it('maps a 23505 unique violation (lost invite race) to a friendly 409', async () => {
    state.insertResult = { data: null, error: { code: '23505' } }

    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Already invited' })
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/team/invite — owner authority', () => {
  const OWNER_CALLER = {
    id: 33,
    twitter_username: 'skipper',
    twitter_name: 'Skipper',
    twitter_profile_image: null,
    subscription_tier: 'FREE',
    team_review_status: null,
    status: 'active'
  }

  beforeEach(() => {
    sessionMock.mockReset()
    sessionMock.mockResolvedValue({ ok: true, userId: 33 })
    seatUsageMock.mockReset()
    seatUsageMock.mockResolvedValue(3)
    notifyMock.mockReset()
    notifyMock.mockResolvedValue(undefined)
    state.usersById = { 33: { ...OWNER_CALLER }, 7: { ...TEAM_CALLER } }
    state.ownerAffiliation = { team_user_id: 7, team: { ...TEAM_CALLER } }
    state.targets = [{ ...FREE_TARGET }]
    state.activeCount = 0
    state.insertResult = { data: { id: 501 }, error: null }
    state.insertedRows = []
  })

  it("sends the invite as the FRANCHISE — the row and notification carry the team's identity", async () => {
    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(200)
    expect(seatUsageMock).toHaveBeenCalledWith(expect.anything(), 7)
    expect(state.insertedRows).toEqual([
      { team_user_id: 7, member_user_id: 21, status: 'pending' }
    ])
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), 21, [
      expect.objectContaining({
        type: 'team_invite',
        body: '@acme wants you on their affiliate roster.',
        data: expect.objectContaining({ teamUserId: 7 })
      })
    ])
  })

  it('403s a plain ACTIVE member — inviting needs the owner role', async () => {
    state.ownerAffiliation = null

    const response = await POST(inviteRequest('pilot'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
    expect(state.insertedRows).toHaveLength(0)
  })
})
