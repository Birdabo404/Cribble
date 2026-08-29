import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { insertMissingNotifications } from '@/lib/notifications'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  APPLICATION_MESSAGE_MAX,
  MAX_OPEN_APPLICATIONS,
  canApply,
  countOpenApplications,
  type AffiliationStatus,
  type ApplyViewerFacts
} from '@/lib/teamApplications'
import { getTeamSeatUsage } from '@/lib/teams'
import {
  TEAM_USER_SELECT,
  isTeamTier,
  isUniqueViolation,
  loadUserRow,
  teamIdentity,
  teamIsLive,
  type TeamUserRow
} from '@/lib/teamRoster'

// Member side of the transfer-request flow — the mirror of the invite
// routes. POST files an application against an approved live team, GET
// powers every APPLY surface (profile button, directory rows, the
// invites-page section) from one payload, DELETE withdraws silently.
// POST's guards run through the same canApply verdict the buttons
// render, so what a pilot sees and what the server enforces can never
// drift; the (team, member) UNIQUE index is the race backstop and its
// 23505 answers as a friendly 409.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** Team-side users row plus the OPEN ROSTER / CLOSED lamp (064). */
const TEAM_TARGET_SELECT = `${TEAM_USER_SELECT}, team_recruiting`

interface TeamTargetRow extends TeamUserRow {
  team_recruiting: boolean | null
}

/** The caller's member-side rows joined to their teams — one query
 *  feeds applications, membership, invites and the target verdict. */
const APPLY_JOIN_SELECT = `id, team_user_id, status, invited_at, accepted_at, message,
  team:users!team_affiliations_team_user_id_fkey(
    id, twitter_username, twitter_name, twitter_profile_image,
    subscription_tier, team_review_status, status
  )`

interface ApplyJoinRow {
  id: number
  team_user_id: number
  status: string
  invited_at: string
  accepted_at: string | null
  message: string | null
  team: TeamUserRow | null
}

const bodySchema = z.object({
  teamUserId: z.number().int().positive(),
  message: z.string().trim().max(APPLICATION_MESSAGE_MAX).optional()
})

export async function POST(request: NextRequest) {
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
    const parsed = bodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid application' }, { status: 400 })
    }
    const teamUserId = parsed.data.teamUserId
    // Whitespace-only pitches store as NULL, not ''.
    const message = parsed.data.message ? parsed.data.message : null

    const caller = await loadUserRow(supabase, session.userId)
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status })
    }
    if (isTeamTier(caller.user.subscription_tier)) {
      return NextResponse.json({ error: 'Team accounts cannot apply' }, { status: 403 })
    }
    // A moderated caller's request would be a ghost: every team surface
    // filters suspended/banned applicants, so the TRANSFER REQUEST
    // notification would point at an empty queue. Refuse before any
    // insert — with copy that does not advertise the moderation state.
    if (caller.user.status === 'suspended' || caller.user.status === 'banned') {
      return NextResponse.json(
        { error: 'Applications are unavailable for this account' },
        { status: 403 }
      )
    }

    // Missing, non-TEAM, unapproved, lapsed and banned targets all answer
    // the same "not found" — an application probe must not reveal a
    // team's moderation or review state. (Self-application needs no
    // check: the caller is not TEAM tier, so it can never pass this.)
    const { data: targetRow, error: targetError } = await supabase
      .from('users')
      .select(TEAM_TARGET_SELECT)
      .eq('id', teamUserId)
      .maybeSingle()

    if (targetError) {
      console.error('[Team] Application target lookup failed:', targetError)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }
    const target = targetRow as unknown as TeamTargetRow | null
    if (!target || !teamIsLive(target)) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    // Every member-side fact canApply needs, in one query: the caller's
    // active membership, any existing row with THIS team, and how many
    // transfer requests they already have in flight. The team's status
    // rides along so the cap count can skip banned-team rows the same
    // way the member GET hides them.
    const { data: memberRows, error: memberError } = await supabase
      .from('team_affiliations')
      .select(
        'team_user_id, status, team:users!team_affiliations_team_user_id_fkey(status)'
      )
      .eq('member_user_id', session.userId)
      .in('status', ['pending', 'active', 'applied'])

    if (memberError) {
      console.error('[Team] Application member lookup failed:', memberError)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }

    const rows = (memberRows ?? []) as unknown as {
      team_user_id: number
      status: string
      team: { status: string | null } | null
    }[]
    const activeRow = rows.find((row) => row.status === 'active')
    const existingRow = rows.find((row) => Number(row.team_user_id) === teamUserId)
    const viewer: ApplyViewerFacts = {
      userId: session.userId,
      isTeamTier: false,
      activeTeamUserId: activeRow ? Number(activeRow.team_user_id) : null,
      existingStatus: (existingRow?.status as AffiliationStatus | undefined) ?? null,
      openApplicationCount: countOpenApplications(rows)
    }

    // getTeamSeatUsage throws on a failed read — never enforce the cap on
    // a guessed count. Applications are seatless, but a full roster still
    // refuses new requests (nothing could ever sign them).
    const seatsUsed = await getTeamSeatUsage(supabase, teamUserId)

    const verdict = canApply(viewer, {
      userId: teamUserId,
      live: true,
      recruiting: target.team_recruiting !== false,
      seatsUsed
    })

    switch (verdict.state) {
      case 'own-team':
      case 'team-account':
        // Unreachable behind the tier guard above; kept for exhaustiveness.
        return NextResponse.json({ error: 'Team accounts cannot apply' }, { status: 403 })
      case 'member':
      case 'has-team':
        return NextResponse.json({ error: 'You already fly with a team' }, { status: 409 })
      case 'invited':
      case 'applied':
        return NextResponse.json({ error: 'Already applied or invited' }, { status: 409 })
      case 'not-live':
        // Unreachable — the target answered 404 above; kept for exhaustiveness.
        return NextResponse.json({ error: 'Team not found' }, { status: 404 })
      case 'roster-closed':
        return NextResponse.json({ error: 'This roster is closed' }, { status: 409 })
      case 'roster-full':
        return NextResponse.json({ error: 'All affiliate seats are in use' }, { status: 409 })
      case 'can-apply':
        if (verdict.atOpenApplicationCap) {
          return NextResponse.json({ error: 'Transfer request limit reached' }, { status: 409 })
        }
        break
      default: {
        const exhaustive: never = verdict
        return exhaustive
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from('team_affiliations')
      .insert({
        team_user_id: teamUserId,
        member_user_id: session.userId,
        status: 'applied',
        message
      })
      .select('id')
      .single()

    if (insertError) {
      // The (team, member) UNIQUE index caught a race the pre-checks
      // missed — same row either way, so the copy covers both shapes.
      if (isUniqueViolation(insertError)) {
        return NextResponse.json({ error: 'Already applied or invited' }, { status: 409 })
      }
      console.error('[Team] Application insert failed:', insertError)
      return NextResponse.json({ error: 'Failed to send application' }, { status: 500 })
    }

    const applicationId = Number(inserted?.id)
    const pilot = teamIdentity(caller.user)

    // Keyed by the application row id: a withdrawn-then-refiled request
    // is a NEW row, so the team hears about it again; re-processing the
    // same row stays silent.
    await insertMissingNotifications(supabase, teamUserId, [
      {
        type: 'team_application',
        title: 'TRANSFER REQUEST',
        body: `@${pilot.username} wants to fly your colors.`,
        data: {
          memberUserId: session.userId,
          username: pilot.username,
          name: pilot.name,
          avatarUrl: pilot.avatar,
          applicationId,
          message
        },
        dedupeKey: `team_application_${applicationId}`
      }
    ])

    return NextResponse.json({ success: true, applicationId })
  } catch (error) {
    console.error('[Team] Application POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const teamUserIdParam = request.nextUrl.searchParams.get('teamUserId')
    let targetTeamUserId: number | null = null
    if (teamUserIdParam !== null) {
      targetTeamUserId = Number(teamUserIdParam)
      if (!Number.isInteger(targetTeamUserId) || targetTeamUserId <= 0) {
        return NextResponse.json({ error: 'Invalid teamUserId' }, { status: 400 })
      }
    }

    const caller = await loadUserRow(supabase, session.userId)
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status })
    }

    // Team accounts never hold member-side rows, so skip the queries.
    // canApply's identity gates fire before any team fact is read, so
    // placeholder team facts are safe here (and save the lookups).
    if (isTeamTier(caller.user.subscription_tier)) {
      const target =
        targetTeamUserId !== null
          ? {
              state: canApply(
                {
                  userId: session.userId,
                  isTeamTier: true,
                  activeTeamUserId: null,
                  existingStatus: null,
                  openApplicationCount: 0
                },
                { userId: targetTeamUserId, live: false, recruiting: false, seatsUsed: 0 }
              ).state
            }
          : undefined
      return NextResponse.json({
        success: true,
        maxOpen: MAX_OPEN_APPLICATIONS,
        applications: [],
        membership: null,
        invites: [],
        ...(target ? { target } : {})
      })
    }

    const { data: rowData, error: rowsError } = await supabase
      .from('team_affiliations')
      .select(APPLY_JOIN_SELECT)
      .eq('member_user_id', session.userId)
      .order('invited_at', { ascending: false })

    if (rowsError) {
      console.error('[Team] Applications query failed:', rowsError)
      return NextResponse.json({ error: 'Failed to load applications' }, { status: 500 })
    }

    const all = ((rowData ?? []) as unknown as ApplyJoinRow[]).filter(
      (row) => row.team !== null
    )

    // Requests against banned teams are hidden (they cannot be signed and
    // must not advertise the team); a lapsed-but-not-banned team still
    // shows, greyed out client-side via `live: false` — same treatment as
    // the invites GET.
    const applications = all
      .filter((row) => row.status === 'applied')
      .filter((row) => (row.team as TeamUserRow).status !== 'banned')
      .map((row) => ({
        applicationId: Number(row.id),
        teamUserId: Number(row.team_user_id),
        appliedAt: row.invited_at,
        message: row.message,
        live: teamIsLive(row.team as TeamUserRow),
        team: teamIdentity(row.team as TeamUserRow)
      }))

    const activeRow = all.find((row) => row.status === 'active')
    const membership = activeRow
      ? {
          affiliationId: Number(activeRow.id),
          acceptedAt: activeRow.accepted_at,
          live: teamIsLive(activeRow.team as TeamUserRow),
          team: teamIdentity(activeRow.team as TeamUserRow)
        }
      : null

    // Banned-team invites are hidden here too — /api/team/invites, the
    // full invites feed, already filters them the same way.
    const invites = all
      .filter((row) => row.status === 'pending')
      .filter((row) => (row.team as TeamUserRow).status !== 'banned')
      .map((row) => ({
        affiliationId: Number(row.id),
        teamUserId: Number(row.team_user_id)
      }))

    let target: { state: string; applicationId?: number } | undefined
    if (targetTeamUserId !== null) {
      const { data: targetRow, error: targetError } = await supabase
        .from('users')
        .select(TEAM_TARGET_SELECT)
        .eq('id', targetTeamUserId)
        .maybeSingle()

      if (targetError) {
        console.error('[Team] Target team lookup failed:', targetError)
        return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
      }

      const team = targetRow as unknown as TeamTargetRow | null
      const live = team !== null && teamIsLive(team)
      // A dead (or missing) team short-circuits inside canApply before
      // seats matter, so the count is only fetched when it can bite.
      const seatsUsed = live ? await getTeamSeatUsage(supabase, targetTeamUserId) : 0

      const existingRow = all.find((row) => Number(row.team_user_id) === targetTeamUserId)
      const verdict = canApply(
        {
          userId: session.userId,
          isTeamTier: false,
          activeTeamUserId: activeRow ? Number(activeRow.team_user_id) : null,
          existingStatus: (existingRow?.status as AffiliationStatus | undefined) ?? null,
          // Banned-team rows don't count — they're hidden from the list
          // above, and the POST guard counts through the same helper.
          openApplicationCount: countOpenApplications(all)
        },
        {
          userId: targetTeamUserId,
          live,
          recruiting: team?.team_recruiting !== false,
          seatsUsed
        }
      )

      target = { state: verdict.state }
      if (verdict.state === 'applied' && existingRow) {
        // Hand the row id back so the surface can offer WITHDRAW in place.
        target.applicationId = Number(existingRow.id)
      }
    }

    return NextResponse.json({
      success: true,
      maxOpen: MAX_OPEN_APPLICATIONS,
      applications,
      membership,
      invites,
      ...(target ? { target } : {})
    })
  } catch (error) {
    console.error('[Team] Applications GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const applicationId = Number(request.nextUrl.searchParams.get('applicationId'))
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return NextResponse.json({ error: 'Invalid applicationId' }, { status: 400 })
    }

    // Withdraw = silent hard delete, scoped to the caller's own APPLIED
    // row so this can never touch a pending invite (that's the invites
    // DELETE) or an active membership (that's /api/team/membership).
    const { data: deleted, error } = await supabase
      .from('team_affiliations')
      .delete()
      .eq('id', applicationId)
      .eq('member_user_id', session.userId)
      .eq('status', 'applied')
      .select('id')

    if (error) {
      console.error('[Team] Withdraw failed:', error)
      return NextResponse.json({ error: 'Failed to withdraw application' }, { status: 500 })
    }
    if ((deleted ?? []).length === 0) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Team] Withdraw DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
