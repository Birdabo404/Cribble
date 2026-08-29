import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_OPEN_APPLICATIONS } from '@/lib/teamApplications'

// The transfer-request POST runs its facts through the shared canApply
// verdict, so what's under test is the fact-gathering and the verdict →
// HTTP mapping: tier and moderation gates, "not found" opacity for
// dead/unapproved teams, the one-team / already-courting /
// roster-closed / roster-full / open-cap 409s (banned-team rows never
// counting), the 23505 race backstop, and the row-id-keyed
// notification. GET must hide banned-team rows from every list it
// returns and hand the row id back only on an 'applied' verdict.
// DELETE must stay scoped to the caller's own APPLIED row —
// withdrawing can never touch an invite or a membership.

const { sessionMock, seatUsageMock, notifyMock, state } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  seatUsageMock: vi.fn(),
  notifyMock: vi.fn(),
  state: {
    usersById: {} as Record<number, Record<string, unknown> | undefined>,
    memberRows: [] as Record<string, unknown>[],
    joinRows: [] as Record<string, unknown>[],
    insertResult: {
      data: { id: 900 } as { id: number } | null,
      error: null as { code?: string } | null
    },
    insertedRows: [] as Record<string, unknown>[],
    deleteResult: {
      data: [{ id: 900 }] as { id: number }[] | null,
      error: null as { code?: string } | null
    },
    deleteFilters: {} as Record<string, unknown>
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
        // Both users reads (caller via loadUserRow, target team) run the
        // same select().eq('id', …).maybeSingle() chain — key on the id.
        let requestedId: unknown = null
        const builder = {
          select: () => builder,
          eq: (_column: string, value: unknown) => {
            requestedId = value
            return builder
          },
          maybeSingle: () =>
            Promise.resolve({
              data: state.usersById[Number(requestedId)] ?? null,
              error: null
            })
        }
        return builder
      }
      if (table === 'team_affiliations') {
        let op: 'select' | 'delete' = 'select'
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return builder
          },
          in: () => builder,
          delete: () => {
            op = 'delete'
            // Reference, not copy: the eq() calls that follow land here.
            state.deleteFilters = filters
            return builder
          },
          insert: (values: Record<string, unknown>) => {
            state.insertedRows.push(values)
            return {
              select: () => ({ single: () => Promise.resolve(state.insertResult) })
            }
          },
          // GET's member-rows join terminal.
          order: () => Promise.resolve({ data: state.joinRows, error: null }),
          // Awaited terminals: the viewer-facts select and the withdraw
          // delete-with-returning both end on a bare await.
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) =>
            Promise.resolve(
              op === 'delete' ? state.deleteResult : { data: state.memberRows, error: null }
            ).then(onFulfilled, onRejected)
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { DELETE, GET, POST } from './route'

const PILOT_CALLER = {
  id: 21,
  twitter_username: 'pilot',
  twitter_name: 'Pilot One',
  twitter_profile_image: 'https://img.example/pilot.png',
  subscription_tier: 'FREE',
  team_review_status: null,
  status: 'active'
}

const LIVE_TEAM = {
  id: 7,
  twitter_username: 'acme',
  twitter_name: 'ACME Corp',
  twitter_profile_image: null,
  subscription_tier: 'TEAM',
  team_review_status: 'approved',
  status: 'active',
  team_recruiting: true
}

function applyRequest(body: unknown) {
  return new NextRequest('https://cribble.dev/api/team/apply', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })
}

function withdrawRequest(applicationId: string) {
  return new NextRequest(
    `https://cribble.dev/api/team/apply?applicationId=${applicationId}`,
    { method: 'DELETE' }
  )
}

function getRequest(teamUserId?: number) {
  const query = teamUserId !== undefined ? `?teamUserId=${teamUserId}` : ''
  return new NextRequest(`https://cribble.dev/api/team/apply${query}`)
}

/** A member-side join row as GET's APPLY_JOIN_SELECT returns it. */
function joinRow(overrides: Record<string, unknown>, team: Record<string, unknown>) {
  return {
    id: 900,
    team_user_id: 7,
    status: 'applied',
    invited_at: '2026-08-20T00:00:00Z',
    accepted_at: null,
    message: null,
    team,
    ...overrides
  }
}

beforeEach(() => {
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: true, userId: 21 })
  seatUsageMock.mockReset()
  seatUsageMock.mockResolvedValue(3)
  notifyMock.mockReset()
  notifyMock.mockResolvedValue(undefined)
  state.usersById = { 21: { ...PILOT_CALLER }, 7: { ...LIVE_TEAM } }
  state.memberRows = []
  state.joinRows = []
  state.insertResult = { data: { id: 900 }, error: null }
  state.insertedRows = []
  state.deleteResult = { data: [{ id: 900 }], error: null }
  state.deleteFilters = {}
})

describe('POST /api/team/apply — guard chain and race backstop', () => {
  it('401s a signed-out caller before touching anything', async () => {
    sessionMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(401)
    expect(state.insertedRows).toHaveLength(0)
  })

  it('403s a TEAM-tier caller — teams recruit, they never apply', async () => {
    state.usersById[21] = { ...PILOT_CALLER, subscription_tier: 'TEAM' }

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts cannot apply' })
  })

  it('403s a suspended caller with quiet copy — no insert, no ghost notification', async () => {
    state.usersById[21] = { ...PILOT_CALLER, status: 'suspended' }

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Applications are unavailable for this account'
    })
    expect(state.insertedRows).toHaveLength(0)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('403s a banned caller with the same copy — moderation state never advertised', async () => {
    state.usersById[21] = { ...PILOT_CALLER, status: 'banned' }

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Applications are unavailable for this account'
    })
    expect(state.insertedRows).toHaveLength(0)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('404s an unknown target as "Team not found"', async () => {
    const response = await POST(applyRequest({ teamUserId: 999 }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Team not found' })
  })

  it('404s a TEAM account still under review — never leaking review state', async () => {
    state.usersById[7] = { ...LIVE_TEAM, team_review_status: 'pending' }

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Team not found' })
  })

  it('404s a banned team with the same opacity', async () => {
    state.usersById[7] = { ...LIVE_TEAM, status: 'banned' }

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Team not found' })
  })

  it('409s a pilot who already flies with a team (any team)', async () => {
    state.memberRows = [{ team_user_id: 99, status: 'active' }]

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'You already fly with a team' })
    expect(state.insertedRows).toHaveLength(0)
  })

  it('409s when this team already invited the pilot — one row per pair', async () => {
    state.memberRows = [{ team_user_id: 7, status: 'pending' }]

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Already applied or invited' })
  })

  it('409s a closed roster', async () => {
    state.usersById[7] = { ...LIVE_TEAM, team_recruiting: false }

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'This roster is closed' })
  })

  it('409s a full roster — applications are seatless, but nothing could ever sign one', async () => {
    seatUsageMock.mockResolvedValue(10)

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'All affiliate seats are in use' })
  })

  it('409s at the open-application cap', async () => {
    state.memberRows = Array.from({ length: MAX_OPEN_APPLICATIONS }, (_, idx) => ({
      team_user_id: 100 + idx,
      status: 'applied',
      team: { status: 'active' }
    }))

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Transfer request limit reached' })
    expect(state.insertedRows).toHaveLength(0)
  })

  it('a banned-team row never consumes the cap — the hidden request cannot block a new one', async () => {
    // Three open rows, but the banned team's is hidden from the pilot's
    // list (no withdraw path), so only two count against the cap.
    state.memberRows = [
      { team_user_id: 100, status: 'applied', team: { status: 'active' } },
      { team_user_id: 101, status: 'applied', team: { status: 'banned' } },
      { team_user_id: 102, status: 'applied', team: { status: null } }
    ]

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(200)
    expect(state.insertedRows).toHaveLength(1)
  })

  it('400s a pitch over the message cap', async () => {
    const response = await POST(applyRequest({ teamUserId: 7, message: 'x'.repeat(281) }))

    expect(response.status).toBe(400)
    expect(state.insertedRows).toHaveLength(0)
  })

  it('inserts an applied row with the trimmed pitch and notifies the team, keyed by the row id', async () => {
    const response = await POST(applyRequest({ teamUserId: 7, message: '  Let me fly.  ' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, applicationId: 900 })
    expect(state.insertedRows).toEqual([
      { team_user_id: 7, member_user_id: 21, status: 'applied', message: 'Let me fly.' }
    ])
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), 7, [
      expect.objectContaining({
        type: 'team_application',
        title: 'TRANSFER REQUEST',
        body: '@pilot wants to fly your colors.',
        dedupeKey: 'team_application_900',
        data: {
          memberUserId: 21,
          username: 'pilot',
          name: 'Pilot One',
          avatarUrl: 'https://img.example/pilot.png',
          applicationId: 900,
          message: 'Let me fly.'
        }
      })
    ])
  })

  it('stores a whitespace-only pitch as null, not an empty string', async () => {
    const response = await POST(applyRequest({ teamUserId: 7, message: '   ' }))

    expect(response.status).toBe(200)
    expect(state.insertedRows).toEqual([
      expect.objectContaining({ message: null })
    ])
  })

  it('maps the (team, member) 23505 race to the same friendly 409, silently', async () => {
    state.insertResult = { data: null, error: { code: '23505' } }

    const response = await POST(applyRequest({ teamUserId: 7 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Already applied or invited' })
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/team/apply — banned-team hiding and the target handoff', () => {
  const BANNED_TEAM = { ...LIVE_TEAM, id: 8, twitter_username: 'ghosts', status: 'banned' }
  const LAPSED_TEAM = { ...LIVE_TEAM, id: 9, twitter_username: 'lapsed', subscription_tier: 'FREE' }

  it('hides banned-team rows from applications and invites; lapsed teams stay, greyed', async () => {
    state.joinRows = [
      joinRow({ id: 901, team_user_id: 7 }, { ...LIVE_TEAM }),
      joinRow({ id: 902, team_user_id: 8 }, { ...BANNED_TEAM }),
      joinRow({ id: 903, team_user_id: 9 }, { ...LAPSED_TEAM }),
      joinRow({ id: 904, team_user_id: 8, status: 'pending' }, { ...BANNED_TEAM }),
      joinRow({ id: 905, team_user_id: 7, status: 'pending' }, { ...LIVE_TEAM })
    ]

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    // The banned team's application (902) is hidden; the lapsed team's
    // (903) shows with live: false. What the pilot sees is exactly what
    // counts against their cap.
    expect(
      body.applications.map((row: { applicationId: number; live: boolean }) => [
        row.applicationId,
        row.live
      ])
    ).toEqual([
      [901, true],
      [903, false]
    ])
    // The minimal invites array hides banned teams too — same rule as
    // the full /api/team/invites feed.
    expect(body.invites).toEqual([{ affiliationId: 905, teamUserId: 7 }])
  })

  it('hands the row id back only on an applied verdict', async () => {
    state.joinRows = [joinRow({ id: 901, team_user_id: 7 }, { ...LIVE_TEAM })]

    const response = await GET(getRequest(7))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.target).toEqual({ state: 'applied', applicationId: 901 })
  })

  it('returns a bare can-apply verdict — no applicationId to withdraw', async () => {
    const response = await GET(getRequest(7))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.target).toEqual({ state: 'can-apply' })
    expect(body.target).not.toHaveProperty('applicationId')
  })
})

describe('DELETE /api/team/apply — withdraw scoping', () => {
  it('hard-deletes only the caller\'s own APPLIED row, silently', async () => {
    const response = await DELETE(withdrawRequest('900'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    // The scoping trio: never someone else's row, never a pending
    // invite, never an active membership.
    expect(state.deleteFilters).toEqual({
      id: 900,
      member_user_id: 21,
      status: 'applied'
    })
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('404s when nothing matched the scope', async () => {
    state.deleteResult = { data: [], error: null }

    const response = await DELETE(withdrawRequest('900'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Application not found' })
  })

  it('400s a malformed applicationId without touching the table', async () => {
    const response = await DELETE(withdrawRequest('abc'))

    expect(response.status).toBe(400)
    expect(state.deleteFilters).toEqual({})
  })
})
