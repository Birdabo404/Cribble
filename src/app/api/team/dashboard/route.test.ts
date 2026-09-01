import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The command deck's gate semantics: GET and PATCH answer for the
// franchise's TEAM login (tier-gated but NOT approval-gated — a team
// still under review sees its deck and may pre-set the OPEN ROSTER
// lamp and the hiring bar) or a signed OWNER on a personal login
// (resolveTeamAuthority, 066). GET alone adds a read-only arm: a
// signed ACTIVE member (any role, resolveTeamMembership) gets the
// same console with the transfer queue and the bar stripped; everyone
// else keeps the 403 the hub falls through on. What's under test is
// the gate → HTTP mapping, PATCH's guarded write (lamp and/or bar,
// clamped by hiringBarSchema), and the queue's display-only stamps;
// the board assembly and the hiring-facts read are mocked (their math
// lives in their own tests).

const { sessionMock, boardMock, seatUsageMock, factsMock, rateLimitMock, state } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  boardMock: vi.fn(),
  seatUsageMock: vi.fn(),
  factsMock: vi.fn(),
  rateLimitMock: vi.fn(),
  state: {
    // users rows keyed by id — the caller's and (for owner callers) the
    // franchise's are distinct reads against the same table.
    usersById: {} as Record<number, Record<string, unknown> | null>,
    // resolveTeamAuthority's owner-affiliation join row (role='owner').
    ownerAffiliation: null as Record<string, unknown> | null,
    // resolveTeamMembership's any-role join row (no role filter).
    memberAffiliation: null as Record<string, unknown> | null,
    // The deck's roster/queue rows (the .order() terminal).
    affiliationRows: [] as Record<string, unknown>[],
    affiliationFilters: {} as Record<string, unknown>,
    userUpdates: [] as Record<string, unknown>[],
    userUpdateFilters: {} as Record<string, unknown>
  }
}))

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: sessionMock }))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  createRateLimitResponse: () => new Headers(),
  rateLimitConfigs: { api: { windowMs: 60_000, maxRequests: 60 } }
}))

vi.mock('@/lib/teams', () => ({
  TEAM_SEAT_LIMIT: 10,
  getTeamSeatUsage: seatUsageMock
}))

vi.mock('@/lib/teamBoardServer', () => ({ assembleTeamBoard: boardMock }))

vi.mock('@/lib/teamHiringServer', () => ({ fetchPilotHiringFacts: factsMock }))

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
          // Row lookups terminal — keyed by id so the caller's row and
          // the franchise's row resolve independently.
          maybeSingle: () =>
            Promise.resolve({
              data: state.usersById[Number(filters.id)] ?? null,
              error: null
            }),
          update: (values: Record<string, unknown>) => {
            state.userUpdates.push(values)
            // Reference, not copy: the eq() that follows lands here.
            state.userUpdateFilters = filters
            return builder
          },
          // PATCH's update chain ends on a bare awaited eq().
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
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
          // The owner probe (role='owner') and the membership probe
          // (no role filter) share this terminal; the role filter's
          // presence says which one is asking.
          maybeSingle: () =>
            Promise.resolve({
              data:
                filters.role === 'owner'
                  ? state.ownerAffiliation
                  : filters.role === undefined
                    ? state.memberAffiliation
                    : null,
              error: null
            }),
          // The deck roster/queue query terminal.
          order: () => {
            state.affiliationFilters = filters
            return Promise.resolve({ data: state.affiliationRows, error: null })
          }
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { GET, PATCH } from './route'

const TEAM_CALLER = {
  id: 7,
  twitter_username: 'acme',
  twitter_name: 'ACME Corp',
  twitter_profile_image: null,
  subscription_tier: 'TEAM',
  team_review_status: 'pending',
  status: 'active',
  team_recruiting: true,
  team_req_min_score: null,
  team_req_min_tokens: null,
  team_req_min_burn_usd: null
}

/** An approved franchise row — what an owner's authority resolves to. */
const APPROVED_TEAM = { ...TEAM_CALLER, team_review_status: 'approved' }

/** A plain personal account (id 33) that may or may not hold owner keys. */
const OWNER_CALLER = {
  id: 33,
  twitter_username: 'skipper',
  twitter_name: 'Skipper',
  twitter_profile_image: null,
  subscription_tier: 'FREE',
  team_review_status: null,
  status: 'active',
  team_recruiting: null,
  team_req_min_score: null,
  team_req_min_tokens: null,
  team_req_min_burn_usd: null
}

const APPLIED_ROW = {
  id: 900,
  status: 'applied',
  role: 'member',
  invited_at: '2026-08-20T00:00:00Z',
  accepted_at: null,
  message: 'Let me fly.',
  member: {
    id: 21,
    twitter_username: 'pilot',
    twitter_name: 'Pilot One',
    twitter_profile_image: null,
    subscription_tier: 'FREE',
    team_review_status: null,
    status: 'active',
    user_scores: { season_score: 500, last_calculated_at: null }
  }
}

const getRequest = () => new NextRequest('https://cribble.dev/api/team/dashboard')
const patchRequest = (body: unknown) =>
  new NextRequest('https://cribble.dev/api/team/dashboard', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })

beforeEach(() => {
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: true, userId: 7 })
  boardMock.mockReset()
  boardMock.mockResolvedValue({
    rows: [],
    totals: { teams: 0, members: 0, topScore: 0, burnUsd: '0', burnPilots: 0 },
    season: { current: null }
  })
  seatUsageMock.mockReset()
  seatUsageMock.mockResolvedValue(3)
  factsMock.mockReset()
  factsMock.mockResolvedValue(new Map())
  rateLimitMock.mockReset()
  rateLimitMock.mockReturnValue({
    success: true,
    limit: 60,
    remaining: 59,
    resetTime: Date.now() + 60_000
  })
  state.usersById = { 7: { ...TEAM_CALLER } }
  state.ownerAffiliation = null
  state.memberAffiliation = null
  state.affiliationRows = []
  state.affiliationFilters = {}
  state.userUpdates = []
  state.userUpdateFilters = {}
})

describe('GET /api/team/dashboard — authority gate', () => {
  it('401s a signed-out caller', async () => {
    sessionMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await GET(getRequest())

    expect(response.status).toBe(401)
  })

  it('429s past the rate limit before the session, the board pipeline or any read', async () => {
    rateLimitMock.mockReturnValue({ success: false, limit: 60, remaining: 0, resetTime: Date.now() })

    const response = await GET(getRequest())

    expect(response.status).toBe(429)
    expect(sessionMock).not.toHaveBeenCalled()
    expect(boardMock).not.toHaveBeenCalled()
    expect(factsMock).not.toHaveBeenCalled()
  })

  it('403s a caller with no authority — the hub falls through to the public board on this', async () => {
    state.usersById = { 7: { ...TEAM_CALLER, subscription_tier: 'PRO' } }

    const response = await GET(getRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
    expect(boardMock).not.toHaveBeenCalled()
  })

  it('403s a signed user with no affiliation row at all — neither command nor read arm', async () => {
    sessionMock.mockResolvedValue({ ok: true, userId: 33 })
    state.usersById = { 33: { ...OWNER_CALLER }, 7: { ...APPROVED_TEAM } }
    // No owner row AND no active seat: both probes come back empty.
    state.ownerAffiliation = null
    state.memberAffiliation = null

    const response = await GET(getRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
  })

  it("answers a signed ACTIVE member read-only — authority 'member', queue and bar stripped", async () => {
    sessionMock.mockResolvedValue({ ok: true, userId: 33 })
    // The franchise HAS a bar and a live applicant — neither may reach
    // a member: applicant messages are private to operators, and the
    // bar is operator config.
    state.usersById = {
      33: { ...OWNER_CALLER },
      7: { ...APPROVED_TEAM, team_req_min_score: 50_000 }
    }
    state.ownerAffiliation = null
    state.memberAffiliation = { team_user_id: 7, team: { ...APPROVED_TEAM } }
    state.affiliationRows = [
      {
        id: 44,
        status: 'active',
        role: 'member',
        invited_at: '2026-08-01T00:00:00Z',
        accepted_at: '2026-08-01T01:00:00Z',
        message: null,
        member: { ...APPLIED_ROW.member }
      },
      { ...APPLIED_ROW, id: 901 }
    ]

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      authority: 'member',
      approved: true,
      recruiting: true,
      bar: { minScore: null, minTokens: null, minBurnUsd: null },
      seatLimit: 10,
      seatsUsed: 3,
      applications: []
    })
    // Reads key on the team id, and the roster arrives whole — roles,
    // scores and shares included.
    expect(body.team.userId).toBe(7)
    expect(state.affiliationFilters).toMatchObject({ team_user_id: 7 })
    expect(seatUsageMock).toHaveBeenCalledWith(expect.anything(), 7)
    expect(body.roster).toHaveLength(1)
    expect(body.roster[0]).toMatchObject({
      affiliationId: 44,
      role: 'member',
      score: 500,
      share: 100
    })
    // The queue never leaves the server: not even the facts read fires.
    expect(factsMock).not.toHaveBeenCalled()
  })

  it('answers for a TEAM caller still under review — the deck renders pre-approval', async () => {
    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      authority: 'team-account',
      reviewStatus: 'pending',
      approved: false,
      recruiting: true,
      bar: { minScore: null, minTokens: null, minBurnUsd: null }
    })
  })

  it("answers an OWNER with the FRANCHISE's deck — reads key on the team id, not the session", async () => {
    sessionMock.mockResolvedValue({ ok: true, userId: 33 })
    state.usersById = { 33: { ...OWNER_CALLER }, 7: { ...APPROVED_TEAM } }
    state.ownerAffiliation = { team_user_id: 7, team: { ...APPROVED_TEAM } }

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      authority: 'owner',
      approved: true
    })
    expect(body.team.userId).toBe(7)
    expect(state.affiliationFilters).toMatchObject({ team_user_id: 7 })
    expect(seatUsageMock).toHaveBeenCalledWith(expect.anything(), 7)
  })

  it('surfaces the hiring bar and per-row roles', async () => {
    state.usersById = {
      7: { ...TEAM_CALLER, team_req_min_score: 50_000, team_req_min_burn_usd: '1000' }
    }
    state.affiliationRows = [
      {
        id: 44,
        status: 'active',
        role: 'owner',
        invited_at: '2026-08-01T00:00:00Z',
        accepted_at: '2026-08-01T01:00:00Z',
        message: null,
        member: { ...APPLIED_ROW.member }
      }
    ]

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    // NUMERIC burn rides as a string off the wire and still lands as a number.
    expect(body.bar).toEqual({ minScore: 50_000, minTokens: null, minBurnUsd: 1000 })
    expect(body.roster).toHaveLength(1)
    expect(body.roster[0]).toMatchObject({ affiliationId: 44, role: 'owner' })
  })

  it('stamps queue rows against the bar via the batched facts read', async () => {
    state.usersById = {
      7: { ...TEAM_CALLER, team_req_min_score: 50_000, team_req_min_tokens: 100_000_000 }
    }
    state.affiliationRows = [{ ...APPLIED_ROW, member: { ...APPLIED_ROW.member } }]
    factsMock.mockResolvedValue(
      new Map([
        [21, { totalScore: 60_000, burnVerified: true, totalTokens: 5_000_000, burnUsd: 12 }]
      ])
    )

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(factsMock).toHaveBeenCalledWith(expect.anything(), [21])
    expect(body.applications).toHaveLength(1)
    expect(body.applications[0].stamp).toEqual({
      score: 'met',
      tokens: 'missed',
      burnUsd: null,
      overall: 'below'
    })
  })

  it('skips the facts read entirely when no bar is set — stamps read no-bar', async () => {
    state.affiliationRows = [{ ...APPLIED_ROW, member: { ...APPLIED_ROW.member } }]

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(factsMock).not.toHaveBeenCalled()
    expect(body.applications[0].stamp).toEqual({
      score: null,
      tokens: null,
      burnUsd: null,
      overall: 'no-bar'
    })
  })

  it('degrades a failed facts read to UNVERIFIED stamps — never a sunk deck or a fake BELOW', async () => {
    state.usersById = { 7: { ...TEAM_CALLER, team_req_min_score: 50_000 } }
    state.affiliationRows = [{ ...APPLIED_ROW, member: { ...APPLIED_ROW.member } }]
    factsMock.mockRejectedValue(new Error('score read failed'))

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.applications[0].stamp).toEqual({
      score: 'unverified',
      tokens: null,
      burnUsd: null,
      overall: 'partial'
    })
  })
})

describe('PATCH /api/team/dashboard — the OPEN ROSTER lamp', () => {
  it('flips the lamp for a TEAM caller (approval not required)', async () => {
    const response = await PATCH(patchRequest({ recruiting: false }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, recruiting: false })
    expect(state.userUpdates).toEqual([{ team_recruiting: false }])
    expect(state.userUpdateFilters).toEqual({ id: 7 })
  })

  it('403s a caller with no authority without writing', async () => {
    state.usersById = { 7: { ...TEAM_CALLER, subscription_tier: 'FREE' } }

    const response = await PATCH(patchRequest({ recruiting: true }))

    expect(response.status).toBe(403)
    expect(state.userUpdates).toHaveLength(0)
  })

  it('400s a body outside the schema', async () => {
    const response = await PATCH(patchRequest({ recruiting: 'open' }))

    expect(response.status).toBe(400)
    expect(state.userUpdates).toHaveLength(0)
  })

  it('400s an empty body — there must be something to update', async () => {
    const response = await PATCH(patchRequest({}))

    expect(response.status).toBe(400)
    expect(state.userUpdates).toHaveLength(0)
  })
})

describe('PATCH /api/team/dashboard — the hiring bar', () => {
  it('writes a full bar (null = that metric off) and echoes it back', async () => {
    const response = await PATCH(
      patchRequest({ bar: { minScore: 50_000, minTokens: null, minBurnUsd: 1_000 } })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      bar: { minScore: 50_000, minTokens: null, minBurnUsd: 1_000 }
    })
    expect(state.userUpdates).toEqual([
      {
        team_req_min_score: 50_000,
        team_req_min_tokens: null,
        team_req_min_burn_usd: 1_000
      }
    ])
    expect(state.userUpdateFilters).toEqual({ id: 7 })
  })

  it('updates lamp and bar in one write', async () => {
    const response = await PATCH(
      patchRequest({
        recruiting: true,
        bar: { minScore: null, minTokens: 100_000_000, minBurnUsd: null }
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      recruiting: true,
      bar: { minScore: null, minTokens: 100_000_000, minBurnUsd: null }
    })
    expect(state.userUpdates).toEqual([
      {
        team_recruiting: true,
        team_req_min_score: null,
        team_req_min_tokens: 100_000_000,
        team_req_min_burn_usd: null
      }
    ])
  })

  it('400s a partial bar — a write must carry all three metrics', async () => {
    const response = await PATCH(patchRequest({ bar: { minScore: 50_000 } }))

    expect(response.status).toBe(400)
    expect(state.userUpdates).toHaveLength(0)
  })

  it('400s thresholds outside the hiringBarSchema clamps', async () => {
    for (const bar of [
      // Below HIRING_BAR_MIN — "at least 0" is what NULL already says.
      { minScore: 0, minTokens: null, minBurnUsd: null },
      // Non-integer.
      { minScore: 1.5, minTokens: null, minBurnUsd: null },
      // Past the 1e15 score ceiling.
      { minScore: 1_000_000_000_000_001, minTokens: null, minBurnUsd: null },
      // Past the $1B burn ceiling.
      { minScore: null, minTokens: null, minBurnUsd: 1_000_000_001 }
    ]) {
      const response = await PATCH(patchRequest({ bar }))
      expect(response.status).toBe(400)
    }
    expect(state.userUpdates).toHaveLength(0)
  })

  it("lets an OWNER set the FRANCHISE's bar from a personal login", async () => {
    sessionMock.mockResolvedValue({ ok: true, userId: 33 })
    state.usersById = { 33: { ...OWNER_CALLER }, 7: { ...APPROVED_TEAM } }
    state.ownerAffiliation = { team_user_id: 7, team: { ...APPROVED_TEAM } }

    const response = await PATCH(
      patchRequest({ bar: { minScore: 10_000, minTokens: null, minBurnUsd: null } })
    )

    expect(response.status).toBe(200)
    // The write lands on the team row, never the owner's own.
    expect(state.userUpdateFilters).toEqual({ id: 7 })
  })

  it('403s a plain member trying to write — the ACTIVE seat that reads the deck never writes it', async () => {
    sessionMock.mockResolvedValue({ ok: true, userId: 33 })
    state.usersById = { 33: { ...OWNER_CALLER }, 7: { ...APPROVED_TEAM } }
    state.ownerAffiliation = null
    // The very seat that earns the member GET arm.
    state.memberAffiliation = { team_user_id: 7, team: { ...APPROVED_TEAM } }

    const response = await PATCH(
      patchRequest({ bar: { minScore: 10_000, minTokens: null, minBurnUsd: null } })
    )

    expect(response.status).toBe(403)
    expect(state.userUpdates).toHaveLength(0)
  })
})
