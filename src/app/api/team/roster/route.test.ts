import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Roster gate semantics. GET answers for TEAM-tier callers (any review
// state) AND for rejected teams whose tier already reverted to FREE —
// that payload is what renders the REVIEW REJECTED banner on /team
// instead of the generic not-team gate. Everyone else stays behind the
// 403, and DELETE keeps the strict tier gate so a rejected team can
// never mutate its roster. Session auth, rate limiting and seat
// counting are mocked; the gate logic and payload shape are what's
// under test.

const { sessionMock, seatUsageMock, notifyMock, state } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  seatUsageMock: vi.fn(),
  notifyMock: vi.fn(),
  state: {
    caller: null as Record<string, unknown> | null,
    rosterRows: [] as Record<string, unknown>[]
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
        const builder = {
          select: () => builder,
          eq: () => builder,
          // loadUserRow terminal — the caller's own row.
          maybeSingle: () => Promise.resolve({ data: state.caller, error: null })
        }
        return builder
      }
      if (table === 'team_affiliations') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          // Roster query terminal.
          order: () => Promise.resolve({ data: state.rosterRows, error: null })
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { DELETE, GET } from './route'

const TEAM_CALLER = {
  id: 7,
  twitter_username: 'acme',
  twitter_name: 'ACME Corp',
  twitter_profile_image: null,
  subscription_tier: 'TEAM',
  team_review_status: 'pending',
  status: 'active'
}

const ROSTER_ROW = {
  id: 44,
  status: 'active',
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

describe('/api/team/roster — tier gate and the rejected-state exception', () => {
  beforeEach(() => {
    sessionMock.mockReset()
    sessionMock.mockResolvedValue({ ok: true, userId: 7 })
    seatUsageMock.mockReset()
    seatUsageMock.mockResolvedValue(3)
    notifyMock.mockReset()
    notifyMock.mockResolvedValue(undefined)
    state.caller = { ...TEAM_CALLER }
    state.rosterRows = []
  })

  it('GET 403s a plain non-team caller', async () => {
    state.caller = { ...TEAM_CALLER, subscription_tier: 'FREE', team_review_status: null }

    const response = await GET(getRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
  })

  it('GET answers for a TEAM caller still under review', async () => {
    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reviewStatus: 'pending',
      approved: false
    })
  })

  it('GET reports approved for a TEAM caller past review', async () => {
    state.caller = { ...TEAM_CALLER, team_review_status: 'approved' }

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reviewStatus: 'approved',
      approved: true
    })
  })

  it('GET answers for a rejected team whose tier already reverted to FREE', async () => {
    state.caller = { ...TEAM_CALLER, subscription_tier: 'FREE', team_review_status: 'rejected' }
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
        invitedAt: '2026-08-01T00:00:00Z',
        acceptedAt: '2026-08-01T01:00:00Z',
        userId: 21,
        username: 'pilot',
        name: 'Pilot One',
        avatar: null
      }
    ])
  })

  it('DELETE still 403s the rejected caller — mutations stay tier-gated', async () => {
    state.caller = { ...TEAM_CALLER, subscription_tier: 'FREE', team_review_status: 'rejected' }

    const response = await DELETE(deleteRequest(44))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
    expect(notifyMock).not.toHaveBeenCalled()
  })
})
