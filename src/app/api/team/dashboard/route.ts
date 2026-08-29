import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isApprovedTeam } from '@/lib/entitlements'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { assembleTeamBoard } from '@/lib/teamBoardServer'
import { largestRemainderShares, memberSeasonScore } from '@/lib/teamLeaderboard'
import { TEAM_SEAT_LIMIT, getTeamSeatUsage } from '@/lib/teams'
import {
  TEAM_USER_SELECT,
  isTeamTier,
  loadUserRow,
  teamIdentity,
  type TeamUserRow
} from '@/lib/teamRoster'

// The command deck's one payload: identity + review lamp, seat meter,
// board rank/score/burn (assembled through the SAME pipeline as the
// public TEAMS leaderboard, so the KPIs can never disagree with the
// board), the roster with per-pilot season scores and contribution
// shares, and the inbound-transfer queue. PATCH flips the OPEN ROSTER /
// CLOSED lamp — tier-gated but NOT approval-gated, so a team still
// under review can pre-close its roster.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** Caller's users row plus the recruiting lamp (064). */
const DECK_USER_SELECT = `${TEAM_USER_SELECT}, team_recruiting`

interface DeckUserRow extends TeamUserRow {
  team_recruiting: boolean | null
}

/** Roster + queue in one query: every affiliation row this team holds,
 *  joined to the member's identity and score row. */
const DECK_JOIN_SELECT = `id, status, invited_at, accepted_at, message,
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
  invited_at: string
  accepted_at: string | null
  message: string | null
  member: DeckMemberRow | null
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const { data: callerRow, error: callerError } = await supabase
      .from('users')
      .select(DECK_USER_SELECT)
      .eq('id', session.userId)
      .maybeSingle()

    if (callerError) {
      console.error('[Team] Dashboard user lookup failed:', callerError)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }
    if (!callerRow) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    const caller = callerRow as unknown as DeckUserRow
    if (!isTeamTier(caller.subscription_tier)) {
      return NextResponse.json({ error: 'Team accounts only' }, { status: 403 })
    }

    // The board pipeline and this team's own rows are independent reads.
    const boardPromise = assembleTeamBoard(supabase)
    const { data: rowData, error: rowsError } = await supabase
      .from('team_affiliations')
      .select(DECK_JOIN_SELECT)
      .eq('team_user_id', session.userId)
      .order('invited_at', { ascending: true })

    if (rowsError) {
      console.error('[Team] Dashboard roster query failed:', rowsError)
      return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
    }

    const { rows: boardRows, totals, season } = await boardPromise
    const seatsUsed = await getTeamSeatUsage(supabase, session.userId)

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

    // The transfer queue. Moderated applicants are hidden — actioning
    // them 404s-and-purges in /api/team/applications anyway.
    const applications = all
      .filter((row) => row.status === 'applied')
      .filter((row) => {
        const status = (row.member as DeckMemberRow).status
        return status !== 'banned' && status !== 'suspended'
      })
      .map((row) => {
        const member = row.member as DeckMemberRow
        return {
          applicationId: Number(row.id),
          ...teamIdentity(member),
          score: memberSeasonScore(
            member.user_scores?.season_score ?? null,
            member.user_scores?.last_calculated_at ?? null,
            season
          ),
          message: row.message,
          appliedAt: row.invited_at
        }
      })
      // Newest request first, matching the invites feed.
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))

    // Rank/score/burn from the caller's board row; a team not on the
    // board (e.g. still under review) reads rank null with the squad
    // score summed locally from the same roster numbers.
    const boardRow = boardRows.find((row) => row.userId === session.userId) ?? null
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
      team: teamIdentity(caller),
      reviewStatus: caller.team_review_status,
      approved: isApprovedTeam(caller),
      recruiting: caller.team_recruiting !== false,
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

const patchSchema = z.object({
  recruiting: z.boolean()
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
    const recruiting = parsed.data.recruiting

    const caller = await loadUserRow(supabase, session.userId)
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status })
    }
    // Tier-gated only: a team still under review may pre-set its lamp.
    if (!isTeamTier(caller.user.subscription_tier)) {
      return NextResponse.json({ error: 'Team accounts only' }, { status: 403 })
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ team_recruiting: recruiting })
      .eq('id', session.userId)

    if (updateError) {
      console.error('[Team] Recruiting update failed:', updateError)
      return NextResponse.json({ error: 'Failed to update roster status' }, { status: 500 })
    }

    return NextResponse.json({ success: true, recruiting })
  } catch (error) {
    console.error('[Team] Dashboard PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
