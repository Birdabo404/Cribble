import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isApprovedTeam } from '@/lib/entitlements'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { assembleTeamBoard } from '@/lib/teamBoardServer'
import {
  evaluateHiringBar,
  hasBar,
  hiringBarFromColumns,
  hiringBarSchema,
  type BarStamp,
  type HiringBar,
  type PilotHiringFacts
} from '@/lib/teamHiring'
import { fetchPilotHiringFacts } from '@/lib/teamHiringServer'
import { largestRemainderShares, memberSeasonScore } from '@/lib/teamLeaderboard'
import { TEAM_SEAT_LIMIT, getTeamSeatUsage } from '@/lib/teams'
import {
  TEAM_USER_SELECT,
  isTeamTier,
  loadUserRow,
  resolveTeamAuthority,
  resolveTeamMembership,
  teamIdentity,
  type TeamAuthority,
  type TeamUserRow
} from '@/lib/teamRoster'

// The command deck's one payload: identity + review lamp, seat meter,
// board rank/score/burn (assembled through the SAME pipeline as the
// public TEAMS leaderboard, so the KPIs can never disagree with the
// board), the roster with per-pilot roles, season scores and
// contribution shares, and the inbound-transfer queue stamped against
// the team's hiring bar. PATCH flips the OPEN ROSTER / CLOSED lamp
// and/or rewrites the bar — tier-gated but NOT approval-gated, so a
// team still under review can pre-set both.
//
// PATCH answers for TWO kinds of caller: the franchise's own TEAM
// login, or a signed OWNER commanding it from a personal account
// (resolveTeamAuthority, migration 066). GET adds a third, read-only
// arm: a signed ACTIVE member (any role) sees the same console minus
// the transfer queue (applicant messages are private to the operators
// who can action them) and with the bar nulled (hiring-bar config is
// an operator concern). A caller with none of these keeps today's
// 403 — TeamsHub relies on 401/403 falling through to the public
// landing. Only role changes and member removal stay franchise-only,
// and those live on /api/team/roster.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** Team users row plus the recruiting lamp (064) and hiring bar (066). */
const DECK_USER_SELECT = `${TEAM_USER_SELECT}, team_recruiting, team_req_min_score, team_req_min_tokens, team_req_min_burn_usd`

interface DeckUserRow extends TeamUserRow {
  team_recruiting: boolean | null
  team_req_min_score: number | string | null
  team_req_min_tokens: number | string | null
  team_req_min_burn_usd: number | string | null
}

/** Stamp fallback when the facts read failed outright: every enabled
 *  metric reads 'unverified' — the honest answer, never a fake BELOW. */
function unverifiedStamp(bar: HiringBar): BarStamp {
  return {
    score: bar.minScore !== null ? 'unverified' : null,
    tokens: bar.minTokens !== null ? 'unverified' : null,
    burnUsd: bar.minBurnUsd !== null ? 'unverified' : null,
    overall: hasBar(bar) ? 'partial' : 'no-bar'
  }
}

/** Who is looking at the deck: TeamAuthority's two command arms plus
 *  the GET-only read arm for signed members. Kept apart from
 *  TeamAuthority so 'member' can never leak into a mutation gate. */
interface DeckViewer {
  teamUserId: number
  via: TeamAuthority['via'] | 'member'
}

/**
 * The team this session may see, plus that team's deck row — GET's
 * gate only (PATCH resolves its own, mutation-grade authority inline).
 * The franchise arm is tier-gated only (an under-review team still
 * sees its deck); the owner arm rides resolveTeamAuthority, whose live
 * gate means an owner's team is always approved; the member arm rides
 * resolveTeamMembership and earns the read-only view, nothing more.
 * Callers with none of the three answer the 403 the hub falls
 * through on.
 */
async function resolveDeck(
  userId: number
): Promise<
  | { ok: true; viewer: DeckViewer; deck: DeckUserRow }
  | { ok: false; status: number; error: string }
> {
  const { data: callerRow, error: callerError } = await supabase
    .from('users')
    .select(DECK_USER_SELECT)
    .eq('id', userId)
    .maybeSingle()

  if (callerError) {
    console.error('[Team] Dashboard user lookup failed:', callerError)
    return { ok: false, status: 500, error: 'Lookup failed' }
  }
  if (!callerRow) {
    return { ok: false, status: 404, error: 'User not found' }
  }
  const caller = callerRow as unknown as DeckUserRow

  if (isTeamTier(caller.subscription_tier)) {
    return {
      ok: true,
      viewer: { teamUserId: userId, via: 'team-account' },
      deck: caller
    }
  }

  // Owner first — it is the stronger grant and the payload reports
  // which arm answered. Only a caller with no command at all falls
  // through to the membership probe.
  const authority = await resolveTeamAuthority(supabase, userId)
  const memberTeamId = authority
    ? null
    : await resolveTeamMembership(supabase, userId)
  const viewer: DeckViewer | null =
    authority ??
    (memberTeamId !== null ? { teamUserId: memberTeamId, via: 'member' } : null)
  if (!viewer) {
    return { ok: false, status: 403, error: 'Team accounts only' }
  }

  const { data: teamRow, error: teamError } = await supabase
    .from('users')
    .select(DECK_USER_SELECT)
    .eq('id', viewer.teamUserId)
    .maybeSingle()

  if (teamError) {
    console.error('[Team] Dashboard team lookup failed:', teamError)
    return { ok: false, status: 500, error: 'Lookup failed' }
  }
  // The grant dissolved mid-flight (team row gone): not yours to see.
  if (!teamRow) {
    return { ok: false, status: 403, error: 'Team accounts only' }
  }

  return { ok: true, viewer, deck: teamRow as unknown as DeckUserRow }
}

/** Roster + queue in one query: every affiliation row this team holds,
 *  joined to the member's identity and score row. */
const DECK_JOIN_SELECT = `id, status, role, invited_at, accepted_at, message,
  member:users!team_affiliations_member_user_id_fkey(
    id, twitter_username, twitter_name, twitter_profile_image,
    subscription_tier, team_review_status, status,
    user_scores(season_score, last_calculated_at)
  )`

interface DeckMemberRow extends TeamUserRow {
  user_scores: {
    season_score: number | null
    last_calculated_at: string | null
  } | null
}

interface DeckAffiliationRow {
  id: number
  status: string
  role: string
  invited_at: string
  accepted_at: string | null
  message: string | null
  member: DeckMemberRow | null
}

export async function GET(request: NextRequest) {
  try {
    // Same guard as PATCH: an authed deck read fans out into the board
    // pipeline and (behind a bar) the full-population burn aggregate,
    // so it is at least as expensive as the writes it sits beside.
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const resolved = await resolveDeck(session.userId)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }
    const { viewer, deck } = resolved
    // Hiring-bar config is an operator concern: the member arm carries
    // an all-null bar, which also keeps the stamp path below inert
    // (hasBar reads false, so the facts read can never fire).
    const bar: HiringBar =
      viewer.via === 'member'
        ? { minScore: null, minTokens: null, minBurnUsd: null }
        : hiringBarFromColumns(deck)

    // The board pipeline and this team's own rows are independent reads.
    const boardPromise = assembleTeamBoard(supabase)
    const { data: rowData, error: rowsError } = await supabase
      .from('team_affiliations')
      .select(DECK_JOIN_SELECT)
      .eq('team_user_id', viewer.teamUserId)
      .order('invited_at', { ascending: true })

    if (rowsError) {
      console.error('[Team] Dashboard roster query failed:', rowsError)
      return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
    }

    const { rows: boardRows, totals, season } = await boardPromise
    const seatsUsed = await getTeamSeatUsage(supabase, viewer.teamUserId)

    const all = ((rowData ?? []) as unknown as DeckAffiliationRow[]).filter(
      (row) => row.member !== null
    )

    // Roster: pending + active, every row shown (even a banned member's —
    // it holds a seat the team must be able to free via /api/team/roster).
    // Scores reuse the board's season state so the numbers can't drift.
    const rosterRows = all
      .filter((row) => row.status === 'pending' || row.status === 'active')
      .map((row) => {
        const member = row.member as DeckMemberRow
        return {
          affiliationId: Number(row.id),
          status: row.status as 'pending' | 'active',
          role: row.role === 'owner' ? ('owner' as const) : ('member' as const),
          ...teamIdentity(member),
          score: memberSeasonScore(
            member.user_scores?.season_score ?? null,
            member.user_scores?.last_calculated_at ?? null,
            season
          ),
          invitedAt: row.invited_at,
          acceptedAt: row.accepted_at
        }
      })
      // Signed pilots ranked by contribution first; pending invites trail
      // in the order they were sent.
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1
        if (a.status === 'active') return b.score - a.score || a.userId - b.userId
        return a.invitedAt.localeCompare(b.invitedAt)
      })

    // Contribution shares over ACTIVE pilots only — a pending invite has
    // contributed nothing yet, so it reads 0 while its score still shows.
    const actives = rosterRows.filter((row) => row.status === 'active')
    const shares = largestRemainderShares(actives.map((row) => row.score))
    const shareByUserId = new Map(actives.map((row, idx) => [row.userId, shares[idx]]))
    const roster = rosterRows.map((row) => ({
      ...row,
      share: shareByUserId.get(row.userId) ?? 0
    }))

    // The transfer queue — operators only: applicant messages are
    // private to the people who can action them, so the member arm
    // never sees a row. Moderated applicants are hidden — actioning
    // them 404s-and-purges in /api/team/applications anyway.
    const applicationRows =
      viewer.via === 'member'
        ? []
        : all
            .filter((row) => row.status === 'applied')
            .filter((row) => {
              const status = (row.member as DeckMemberRow).status
              return status !== 'banned' && status !== 'suspended'
            })

    // Stamps are display-only — a facts failure must not sink the deck.
    // fetchPilotHiringFacts degrades burn reads on its own; the one
    // thing it throws on (the score read) degrades HERE to all-metrics
    // UNVERIFIED instead of a wrong verdict.
    let factsByUser = new Map<number, PilotHiringFacts>()
    if (applicationRows.length > 0 && hasBar(bar)) {
      try {
        factsByUser = await fetchPilotHiringFacts(
          supabase,
          applicationRows.map((row) => Number((row.member as DeckMemberRow).id))
        )
      } catch (error) {
        console.warn('[Team] Applicant hiring facts unavailable:', error)
      }
    }

    const applications = applicationRows
      .map((row) => {
        const member = row.member as DeckMemberRow
        const facts = factsByUser.get(Number(member.id))
        return {
          applicationId: Number(row.id),
          ...teamIdentity(member),
          score: memberSeasonScore(
            member.user_scores?.season_score ?? null,
            member.user_scores?.last_calculated_at ?? null,
            season
          ),
          stamp: facts ? evaluateHiringBar(bar, facts) : unverifiedStamp(bar),
          message: row.message,
          appliedAt: row.invited_at
        }
      })
      // Newest request first, matching the invites feed.
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))

    // Rank/score/burn from the team's board row; a team not on the
    // board (e.g. still under review) reads rank null with the squad
    // score summed locally from the same roster numbers.
    const boardRow = boardRows.find((row) => row.userId === viewer.teamUserId) ?? null
    const board = {
      rank: boardRow ? boardRow.rank : null,
      teams: totals.teams,
      score: boardRow
        ? boardRow.score
        : actives.reduce((sum, row) => sum + row.score, 0),
      burnUsd: boardRow ? boardRow.burnUsd : '0',
      burnPilots: boardRow ? boardRow.burnPilots : 0
    }

    return NextResponse.json({
      success: true,
      authority: viewer.via,
      team: teamIdentity(deck),
      reviewStatus: deck.team_review_status,
      approved: isApprovedTeam(deck),
      recruiting: deck.team_recruiting !== false,
      bar,
      seatLimit: TEAM_SEAT_LIMIT,
      seatsUsed,
      board,
      roster,
      applications
    })
  } catch (error) {
    console.error('[Team] Dashboard GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Lamp and/or bar — at least one. A bar write carries all three
 *  metrics (null = that metric off), so a partial body can never
 *  silently clear a threshold the caller didn't touch. */
const patchSchema = z
  .object({
    recruiting: z.boolean().optional(),
    bar: hiringBarSchema.optional()
  })
  .refine((body) => body.recruiting !== undefined || body.bar !== undefined, {
    message: 'Nothing to update'
  })

export async function PATCH(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = patchSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { recruiting, bar } = parsed.data

    const caller = await loadUserRow(supabase, session.userId)
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status })
    }
    // Franchise arm stays tier-gated only (an under-review team may
    // pre-set its lamp and bar); owners write through their authority.
    let authority: TeamAuthority | null
    if (isTeamTier(caller.user.subscription_tier)) {
      authority = { teamUserId: session.userId, via: 'team-account' }
    } else {
      authority = await resolveTeamAuthority(supabase, session.userId)
    }
    if (!authority) {
      return NextResponse.json({ error: 'Team accounts only' }, { status: 403 })
    }

    const updates: Record<string, unknown> = {}
    if (recruiting !== undefined) {
      updates.team_recruiting = recruiting
    }
    if (bar !== undefined) {
      updates.team_req_min_score = bar.minScore
      updates.team_req_min_tokens = bar.minTokens
      updates.team_req_min_burn_usd = bar.minBurnUsd
    }

    const { error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('id', authority.teamUserId)

    if (updateError) {
      console.error('[Team] Recruiting update failed:', updateError)
      return NextResponse.json({ error: 'Failed to update roster status' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      ...(recruiting !== undefined ? { recruiting } : {}),
      ...(bar !== undefined ? { bar } : {})
    })
  } catch (error) {
    console.error('[Team] Dashboard PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
