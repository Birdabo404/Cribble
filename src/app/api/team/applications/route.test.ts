import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The SIGN/PASS route's contract: SIGN needs an approved TEAM account,
// PASS just a TEAM-tier one (an under-review team must be able to clear
// its queue); the row must still be this team's APPLIED one, and the
// seat cap bites at SIGN time (applications held no seat until now).
// The guarded update's zero-rows and 23505 outcomes are distinct 409s —
// "no longer available" vs "signed elsewhere" (flagged applicationGone
// so the client drops the dead row) — and both actions notify the
// pilot keyed by the row id. A successful SIGN sweeps the pilot's other
// open applications. A moderated applicant answers 404 and their row is
// purged, leaking nothing.

const { sessionMock, seatUsageMock, notifyMock, state } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  seatUsageMock: vi.fn(),
  notifyMock: vi.fn(),
  state: {
    caller: null as Record<string, unknown> | null,
    applicationRow: null as Record<string, unknown> | null,
    updateResult: {
      data: [{ id: 900 }] as { id: number }[] | null,
      error: null as { code?: string } | null
    },
    updates: [] as Record<string, unknown>[],
    updateFilters: {} as Record<string, unknown>,
    deleteResult: {
      data: [{ id: 900 }] as { id: number }[] | null,
      error: null as { code?: string } | null
    },
    deletes: [] as Record<string, unknown>[]
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
          // loadUserRow terminal — the team caller's own row.
          maybeSingle: () => Promise.resolve({ data: state.caller, error: null })
        }
        return builder
      }
      if (table === 'team_affiliations') {
        let op: 'read' | 'update' | 'delete' = 'read'
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return builder
          },
          // Application lookup terminal.
          maybeSingle: () => Promise.resolve({ data: state.applicationRow, error: null }),
          update: (values: Record<string, unknown>) => {
            op = 'update'
            state.updates.push(values)
            // Reference, not copy: the eq() calls that follow land here.
            state.updateFilters = filters
            return builder
          },
          delete: () => {
            op = 'delete'
            state.deletes.push(filters)
            return builder
          },
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) =>
            Promise.resolve(
              op === 'update'
                ? state.updateResult
                : op === 'delete'
                  ? state.deleteResult
                  : { data: [], error: null }
            ).then(onFulfilled, onRejected)
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

const APPLICANT = {
  id: 21,
  twitter_username: 'pilot',
  twitter_name: 'Pilot One',
  twitter_profile_image: null,
  subscription_tier: 'FREE',
  team_review_status: null,
  status: 'active'
}

const APPLICATION = {
  id: 900,
  status: 'applied',
  invited_at: '2026-08-20T00:00:00Z',
  message: 'Let me fly.',
  member: APPLICANT
}

function actionRequest(body: unknown) {
  return new NextRequest('https://cribble.dev/api/team/applications', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })
}

beforeEach(() => {
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: true, userId: 7 })
  seatUsageMock.mockReset()
  seatUsageMock.mockResolvedValue(3)
  notifyMock.mockReset()
  notifyMock.mockResolvedValue(undefined)
  state.caller = { ...TEAM_CALLER }
  state.applicationRow = { ...APPLICATION, member: { ...APPLICANT } }
  state.updateResult = { data: [{ id: 900 }], error: null }
  state.updates = []
  state.updateFilters = {}
  state.deleteResult = { data: [{ id: 900 }], error: null }
  state.deletes = []
})

describe('POST /api/team/applications — guards', () => {
  it('401s a signed-out caller', async () => {
    sessionMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(401)
    expect(state.updates).toHaveLength(0)
  })

  it('403s a non-team caller outright', async () => {
    state.caller = { ...TEAM_CALLER, subscription_tier: 'PRO' }

    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
  })

  it('403s an under-review SIGN — pay-first does not unlock signing', async () => {
    state.caller = { ...TEAM_CALLER, team_review_status: 'pending' }

    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Signing unlocks once your team passes review'
    })
    expect(state.updates).toHaveLength(0)
  })

  it('allows an under-review PASS — clearing dead requests never waits on review', async () => {
    state.caller = { ...TEAM_CALLER, team_review_status: 'pending' }

    const response = await POST(actionRequest({ applicationId: 900, action: 'decline' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(state.deletes).toEqual([{ id: 900, team_user_id: 7, status: 'applied' }])
    // The decline notification stays correct for the pilot.
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), 21, [
      expect.objectContaining({ type: 'team_application_declined' })
    ])
  })

  it('400s an action outside the accept/decline union', async () => {
    const response = await POST(actionRequest({ applicationId: 900, action: 'ghost' }))

    expect(response.status).toBe(400)
  })

  it('404s when the team holds no such APPLIED row', async () => {
    state.applicationRow = null

    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Application not found' })
  })

  it('purges a banned applicant\'s row and answers 404 — no moderation leak, no notification', async () => {
    state.applicationRow = { ...APPLICATION, member: { ...APPLICANT, status: 'banned' } }

    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Application not found' })
    expect(state.deletes).toEqual([{ id: 900, team_user_id: 7, status: 'applied' }])
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/team/applications — accept (SIGN)', () => {
  it('409s when all seats are in use — the seatless application meets the cap here', async () => {
    seatUsageMock.mockResolvedValue(10)

    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'All 10 affiliate seats are in use'
    })
    expect(state.updates).toHaveLength(0)
  })

  it('flips the row to active via the scoped guarded update and notifies the pilot', async () => {
    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      member: { userId: 21, username: 'pilot', name: 'Pilot One', avatar: null },
      seatsUsed: 4
    })
    expect(state.updates).toEqual([
      expect.objectContaining({ status: 'active', accepted_at: expect.any(String) })
    ])
    expect(state.updateFilters).toEqual({ id: 900, team_user_id: 7, status: 'applied' })
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), 21, [
      expect.objectContaining({
        type: 'team_application_accepted',
        title: 'REQUEST SIGNED',
        body: '@acme signed your transfer request.',
        dedupeKey: 'team_application_accepted_900',
        data: {
          teamUserId: 7,
          username: 'acme',
          name: 'ACME Corp',
          avatarUrl: 'https://img.example/acme.png',
          applicationId: 900
        }
      })
    ])
  })

  it('sweeps the pilot\'s other open applications after a SIGN — pending invites untouched', async () => {
    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(200)
    // The sweep is scoped to the pilot's remaining APPLIED rows: the
    // signed row is 'active' by now, and status='applied' can never
    // match a pending invite.
    expect(state.deletes).toEqual([{ member_user_id: 21, status: 'applied' }])
  })

  it('maps the one-active-affiliation 23505 to "signed elsewhere" and flags the row gone', async () => {
    state.updateResult = { data: null, error: { code: '23505' } }

    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'That pilot already signed with another team',
      applicationGone: true
    })
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('409s when the guarded update matches nothing (row changed underneath)', async () => {
    state.updateResult = { data: [], error: null }

    const response = await POST(actionRequest({ applicationId: 900, action: 'accept' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Application is no longer available'
    })
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/team/applications — decline (PASS)', () => {
  it('hard-deletes the scoped row and sends the neutral notification', async () => {
    const response = await POST(actionRequest({ applicationId: 900, action: 'decline' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(state.deletes).toEqual([{ id: 900, team_user_id: 7, status: 'applied' }])
    expect(state.updates).toHaveLength(0)
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), 21, [
      expect.objectContaining({
        type: 'team_application_declined',
        title: 'REQUEST PASSED',
        body: '@acme passed on your transfer request.',
        dedupeKey: 'team_application_declined_900',
        data: expect.objectContaining({ teamUserId: 7, applicationId: 900 })
      })
    ])
  })
})
