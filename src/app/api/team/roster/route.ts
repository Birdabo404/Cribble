import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isApprovedTeam } from '@/lib/entitlements'
import { insertMissingNotifications } from '@/lib/notifications'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import type { TeamRole } from '@/lib/teamHiring'
import { TEAM_OWNER_LIMIT, TEAM_SEAT_LIMIT, getTeamSeatUsage } from '@/lib/teams'
import {
  isTeamTier,
  loadUserRow,
  resolveTeamAuthority,
  teamIdentity,
  type TeamAuthority,
  type TeamUserRow
} from '@/lib/teamRoster'

// Team-side roster management. GET returns the team's full roster
// (pending + active, with per-row roles) and seat usage — for the
// franchise login (gated on the TEAM tier so the management page
// renders while the review is still pending, and also answering for
// rejected accounts: an admin rejection reverts the tier to FREE while
// team_review_status stays 'rejected', and /team needs this payload to
// show the REVIEW REJECTED banner instead of the generic not-team
// gate) or a signed OWNER (resolveTeamAuthority, 066). DELETE revokes
// an invite or removes an active member; removed/declined rows are
// deleted outright (the status CHECK only allows pending/active, and a
// lingering row would keep eating one of the 10 seats). Owners may
// revoke PENDING invites, but releasing an ACTIVE member — and PATCH's
// promote/demote — stays franchise-login-only, so there are no coups.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

interface RosterJoinRow {
  id: number
  status: string
  role: string
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
    // The one non-TEAM, non-owner state that may read: a rejected team
    // (tier already reverted to FREE) still sees its console with the
    // rejected banner. Mutations stay locked — the client gates on
    // `approved` and DELETE keeps the strict checks below.
    const isRejectedTeam = caller.user.team_review_status === 'rejected'
    let authority: TeamAuthority | null
    let teamRow: TeamUserRow
    if (isTeamTier(caller.user.subscription_tier) || isRejectedTeam) {
      authority = { teamUserId: session.userId, via: 'team-account' }
      teamRow = caller.user
    } else {
      authority = await resolveTeamAuthority(supabase, session.userId)
      if (!authority) {
        return NextResponse.json({ error: 'Team accounts only' }, { status: 403 })
      }
      const team = await loadUserRow(supabase, authority.teamUserId)
      if (!team.ok) {
        return NextResponse.json({ error: team.error }, { status: team.status })
      }
      teamRow = team.user
    }

    // Two FKs point at users, so the embed names the member-side constraint.
    // Roster rows only: 'applied' rows (064) are seatless transfer
    // requests that live on the /api/team/applications lane — letting
    // them ride this payload would miscount the console's roster.
    const { data: rows, error: rosterError } = await supabase
      .from('team_affiliations')
      .select(
        `id, status, role, invited_at, accepted_at,
         member:users!team_affiliations_member_user_id_fkey(
           id, twitter_username, twitter_name, twitter_profile_image,
           subscription_tier, team_review_status, status
         )`
      )
      .eq('team_user_id', authority.teamUserId)
      .in('status', ['pending', 'active'])
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
        role: row.role === 'owner' ? ('owner' as const) : ('member' as const),
        invitedAt: row.invited_at,
        acceptedAt: row.accepted_at,
        ...teamIdentity(row.member as TeamUserRow)
      }))

    let seatsUsed: number
    try {
      seatsUsed = await getTeamSeatUsage(supabase, authority.teamUserId)
    } catch (error) {
      console.error('[Team] Seat count failed:', error)
      return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      authority: authority.via,
      reviewStatus: teamRow.team_review_status,
      approved: isApprovedTeam(teamRow),
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
    // Franchise login or a signed owner. The owner's team is live
    // (approved) by the authority gate; the franchise arm keeps its
    // explicit approval check.
    let authority: TeamAuthority | null
    if (isTeamTier(caller.user.subscription_tier)) {
      if (!isApprovedTeam(caller.user)) {
        return NextResponse.json(
          { error: 'Team is not approved yet' },
          { status: 403 }
        )
      }
      authority = { teamUserId: session.userId, via: 'team-account' }
    } else {
      authority = await resolveTeamAuthority(supabase, session.userId)
      if (!authority) {
        return NextResponse.json({ error: 'Team accounts only' }, { status: 403 })
      }
    }

    // Delete-with-returning: the deleted row's status decides whether the
    // member gets the removal notice, without a read/delete race window.
    // Scoped to roster rows — an 'applied' transfer request is declined
    // through /api/team/applications (PASS), which sends its own
    // notification; this lane must never silently swallow one. Owners
    // may only revoke PENDING invites — releasing an ACTIVE member
    // stays franchise-login-only, so an owner's delete of an active row
    // matches nothing and answers the same 404 an applied row gets.
    const deletableStatuses =
      authority.via === 'team-account' ? ['pending', 'active'] : ['pending']
    const { data: deleted, error: deleteError } = await supabase
      .from('team_affiliations')
      .delete()
      .eq('id', affiliationId)
      .eq('team_user_id', authority.teamUserId)
      .in('status', deletableStatuses)
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
    // hear about (and only the franchise login reaches this branch, so
    // caller.user IS the team row). Row ids are never reused, so the
    // id-keyed dedupe can never swallow a later, different removal.
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

/** Promote/demote body: the target pilot and the role they should hold. */
const patchSchema = z.object({
  memberUserId: z.number().int().positive(),
  role: z.enum(['member', 'owner'])
})

/** dedupe key for the FRONT OFFICE notification — affiliation row id +
 *  role. Demote deletes the key's notification, so a re-promotion of
 *  the same row notifies again while a re-processed promote stays
 *  silent. */
function promotionDedupeKey(affiliationId: number): string {
  return `team_promotion_${affiliationId}_owner`
}

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
    const { memberUserId, role } = parsed.data

    const caller = await loadUserRow(supabase, session.userId)
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status })
    }
    // Franchise login ONLY — owners never mint or strip other owners,
    // so there are no coups. An owner's personal account gets the same
    // 403 any non-team caller does.
    if (!isTeamTier(caller.user.subscription_tier)) {
      return NextResponse.json({ error: 'Role changes need the team login' }, { status: 403 })
    }
    if (!isApprovedTeam(caller.user)) {
      return NextResponse.json(
        { error: 'Team is not approved yet' },
        { status: 403 }
      )
    }

    // The target must be an ACTIVE member of THIS team — pending
    // invites and applied requests hold no role worth changing.
    const { data: targetRow, error: targetError } = await supabase
      .from('team_affiliations')
      .select('id, role')
      .eq('team_user_id', session.userId)
      .eq('member_user_id', memberUserId)
      .eq('status', 'active')
      .maybeSingle()

    if (targetError) {
      console.error('[Team] Role target lookup failed:', targetError)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }
    const target = targetRow as { id: number; role: string } | null
    if (!target) {
      return NextResponse.json({ error: 'Roster entry not found' }, { status: 404 })
    }

    const affiliationId = Number(target.id)
    const currentRole: TeamRole = target.role === 'owner' ? 'owner' : 'member'
    if (currentRole === role) {
      // Idempotent no-op — re-processing a promote/demote changes nothing.
      return NextResponse.json({ success: true, memberUserId, role })
    }

    // Owner cap, counted fresh at promote time (the app-side twin of
    // the seat cap: a failed count never enforces on a guess, and the
    // same tiny check-then-write race the seat cap accepts is accepted
    // here — an over-cap front office is self-evident, not corrupting).
    if (role === 'owner') {
      const { count, error: countError } = await supabase
        .from('team_affiliations')
        .select('id', { count: 'exact', head: true })
        .eq('team_user_id', session.userId)
        .eq('status', 'active')
        .eq('role', 'owner')

      if (countError) {
        console.error('[Team] Owner count failed:', countError)
        return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
      }
      if ((count ?? 0) >= TEAM_OWNER_LIMIT) {
        return NextResponse.json(
          { error: `All ${TEAM_OWNER_LIMIT} owner seats are held` },
          { status: 409 }
        )
      }
    }

    // Guarded update: only flips a row that is still this team's ACTIVE
    // member — a member who left mid-flight answers 409, not a resurrection.
    const { data: updated, error: updateError } = await supabase
      .from('team_affiliations')
      .update({ role })
      .eq('id', affiliationId)
      .eq('team_user_id', session.userId)
      .eq('status', 'active')
      .select('id')

    if (updateError) {
      console.error('[Team] Role update failed:', updateError)
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
    }
    if ((updated ?? []).length === 0) {
      return NextResponse.json(
        { error: 'Roster entry is no longer available' },
        { status: 409 }
      )
    }

    const team = teamIdentity(caller.user)
    switch (role) {
      case 'owner':
        await insertMissingNotifications(supabase, memberUserId, [
          {
            type: 'team_promotion',
            title: 'FRONT OFFICE',
            body: `@${team.username} handed you the front-office keys — you now run the team from your own account.`,
            data: {
              teamUserId: team.userId,
              username: team.username,
              name: team.name,
              avatarUrl: team.avatar,
              affiliationId
            },
            dedupeKey: promotionDedupeKey(affiliationId)
          }
        ])
        break
      case 'member': {
        // Demote: retire the now-false FRONT OFFICE notification. This
        // also frees the dedupe key, so a later re-promotion of the
        // same row notifies again. Best-effort — a failed delete only
        // means a stale feed row and a silent future re-promotion.
        const { error: retireError } = await supabase
          .from('notifications')
          .delete()
          .eq('user_id', memberUserId)
          .eq('dedupe_key', promotionDedupeKey(affiliationId))
        if (retireError) {
          console.error('[Team] Promotion notification retire failed:', retireError)
        }
        break
      }
      default: {
        const exhaustive: never = role
        return exhaustive
      }
    }

    return NextResponse.json({ success: true, memberUserId, role })
  } catch (error) {
    console.error('[Team] Roster PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
