import { NextRequest, NextResponse } from 'next/server'
import { isApprovedTeam } from '@/lib/entitlements'
import { insertMissingNotifications } from '@/lib/notifications'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { TEAM_SEAT_LIMIT, getTeamSeatUsage } from '@/lib/teams'
import { isTeamTier, loadUserRow, teamIdentity, type TeamUserRow } from '@/lib/teamRoster'

// Team-side roster management. GET returns the caller's full roster
// (pending + active) with seat usage — gated on the TEAM tier so the
// management page renders while the review is still pending, and also
// answering for rejected accounts: an admin rejection reverts the tier
// to FREE while team_review_status stays 'rejected', and /team needs
// this payload to show the REVIEW REJECTED banner instead of the
// generic not-team gate. DELETE revokes an invite or removes an active
// member; removed/declined rows are deleted outright (the status CHECK
// only allows pending/active, and a lingering row would keep eating one
// of the 10 seats).

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

interface RosterJoinRow {
  id: number
  status: string
  invited_at: string
  accepted_at: string | null
  member: TeamUserRow | null
}

export async function GET(request: NextRequest) {
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

    const caller = await loadUserRow(supabase, session.userId)
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status })
    }
    // The one non-TEAM state that may read: a rejected team (tier
    // already reverted to FREE) still sees its console with the
    // rejected banner. Mutations stay locked — the client gates on
    // `approved` and DELETE keeps the strict tier check below.
    const isRejectedTeam = caller.user.team_review_status === 'rejected'
    if (!isTeamTier(caller.user.subscription_tier) && !isRejectedTeam) {
      return NextResponse.json({ error: 'Team accounts only' }, { status: 403 })
    }

    // Two FKs point at users, so the embed names the member-side constraint.
    const { data: rows, error: rosterError } = await supabase
      .from('team_affiliations')
      .select(
        `id, status, invited_at, accepted_at,
         member:users!team_affiliations_member_user_id_fkey(
           id, twitter_username, twitter_name, twitter_profile_image,
           subscription_tier, team_review_status, status
         )`
      )
      .eq('team_user_id', session.userId)
      .order('invited_at', { ascending: true })

    if (rosterError) {
      console.error('[Team] Roster query failed:', rosterError)
      return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 })
    }

    // Every row is shown — even one whose member has since been banned —
    // because every row holds a seat and the team must be able to free it.
    // Public affiliate surfaces filter banned/suspended separately.
    const members = ((rows ?? []) as unknown as RosterJoinRow[])
      .filter((row) => row.member !== null)
      .map((row) => ({
        affiliationId: Number(row.id),
        status: row.status as 'pending' | 'active',
        invitedAt: row.invited_at,
        acceptedAt: row.accepted_at,
        ...teamIdentity(row.member as TeamUserRow)
      }))

    let seatsUsed: number
    try {
      seatsUsed = await getTeamSeatUsage(supabase, session.userId)
    } catch (error) {
      console.error('[Team] Seat count failed:', error)
      return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      reviewStatus: caller.user.team_review_status,
      approved: isApprovedTeam(caller.user),
      seatLimit: TEAM_SEAT_LIMIT,
      seatsUsed,
      members
    })
  } catch (error) {
    console.error('[Team] Roster GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
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

    const affiliationId = Number(request.nextUrl.searchParams.get('affiliationId'))
    if (!Number.isInteger(affiliationId) || affiliationId <= 0) {
      return NextResponse.json({ error: 'Invalid affiliationId' }, { status: 400 })
    }

    const caller = await loadUserRow(supabase, session.userId)
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status })
    }
    if (!isTeamTier(caller.user.subscription_tier)) {
      return NextResponse.json({ error: 'Team accounts only' }, { status: 403 })
    }
    if (!isApprovedTeam(caller.user)) {
      return NextResponse.json(
        { error: 'Team is not approved yet' },
        { status: 403 }
      )
    }

    // Delete-with-returning: the deleted row's status decides whether the
    // member gets the removal notice, without a read/delete race window.
    const { data: deleted, error: deleteError } = await supabase
      .from('team_affiliations')
      .delete()
      .eq('id', affiliationId)
      .eq('team_user_id', session.userId)
      .select('id, member_user_id, status')

    if (deleteError) {
      console.error('[Team] Roster delete failed:', deleteError)
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
    }

    const row = (deleted ?? [])[0] as
      | { id: number; member_user_id: number; status: string }
      | undefined
    if (!row) {
      return NextResponse.json({ error: 'Roster entry not found' }, { status: 404 })
    }

    // Revoking a PENDING invite stays silent — the member never acted on
    // it. Removing an ACTIVE member is a real status change they should
    // hear about. Row ids are never reused, so the id-keyed dedupe can
    // never swallow a later, different removal.
    if (row.status === 'active') {
      const identity = teamIdentity(caller.user)
      await insertMissingNotifications(supabase, Number(row.member_user_id), [
        {
          type: 'team_removed',
          title: 'REMOVED FROM TEAM',
          body: `@${identity.username} removed you from their affiliate roster.`,
          data: { teamUserId: identity.userId, username: identity.username },
          dedupeKey: `team_removed_${row.id}`
        }
      ])
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Team] Roster DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
