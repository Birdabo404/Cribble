import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { insertMissingNotifications } from '@/lib/notifications'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  isUniqueViolation,
  loadUserRow,
  teamIdentity,
  teamIsLive,
  type TeamUserRow
} from '@/lib/teamRoster'

// Member side of the affiliation flow. GET lists the caller's pending
// invites plus their current membership (one ACTIVE affiliation max, by
// the partial unique index). POST accepts an invite; DELETE declines one.
// Declines are hard deletes — the status CHECK has no 'declined' value,
// and a lingering row would both hold one of the team's 10 seats and
// block a future re-invite.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const TEAM_JOIN_SELECT = `id, status, invited_at, accepted_at,
  team:users!team_affiliations_team_user_id_fkey(
    id, twitter_username, twitter_name, twitter_profile_image,
    subscription_tier, team_review_status, status
  )`

interface InviteJoinRow {
  id: number
  status: string
  invited_at: string
  accepted_at: string | null
  team: TeamUserRow | null
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const { data: rows, error } = await supabase
      .from('team_affiliations')
      .select(TEAM_JOIN_SELECT)
      .eq('member_user_id', session.userId)
      .order('invited_at', { ascending: false })

    if (error) {
      console.error('[Team] Invites query failed:', error)
      return NextResponse.json({ error: 'Failed to load invites' }, { status: 500 })
    }

    const all = ((rows ?? []) as unknown as InviteJoinRow[]).filter(
      (row) => row.team !== null
    )

    // Invites from banned teams are hidden (they cannot be accepted and
    // must not advertise the team); a lapsed-but-not-banned team still
    // shows, greyed out client-side via `live: false`.
    const invites = all
      .filter((row) => row.status === 'pending')
      .filter((row) => (row.team as TeamUserRow).status !== 'banned')
      .map((row) => ({
        affiliationId: Number(row.id),
        invitedAt: row.invited_at,
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

    return NextResponse.json({ success: true, invites, membership })
  } catch (error) {
    console.error('[Team] Invites GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const acceptSchema = z.object({
  affiliationId: z.number().int().positive()
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
    const parsed = acceptSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid affiliationId' }, { status: 400 })
    }
    const affiliationId = parsed.data.affiliationId

    const { data: inviteRow, error: inviteError } = await supabase
      .from('team_affiliations')
      .select(TEAM_JOIN_SELECT)
      .eq('id', affiliationId)
      .eq('member_user_id', session.userId)
      .maybeSingle()

    if (inviteError) {
      console.error('[Team] Accept lookup failed:', inviteError)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }

    const invite = inviteRow as unknown as InviteJoinRow | null
    if (!invite || invite.status !== 'pending' || !invite.team) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }
    // The invite was sent by an approved team, but that can have changed
    // since: subscription lapse, review revoked, or a ban. Joining a dead
    // team would waste the member's single active slot on no badge.
    if (!teamIsLive(invite.team)) {
      return NextResponse.json(
        { error: 'This team is no longer active' },
        { status: 409 }
      )
    }

    // Guarded update: only flips a row that is still this member's
    // PENDING invite. The partial unique index (one ACTIVE affiliation
    // per member) turns a lost accept-race into a 23505.
    const { data: updated, error: updateError } = await supabase
      .from('team_affiliations')
      .update({ status: 'active', accepted_at: new Date().toISOString() })
      .eq('id', affiliationId)
      .eq('member_user_id', session.userId)
      .eq('status', 'pending')
      .select('id')

    if (updateError) {
      if (isUniqueViolation(updateError)) {
        return NextResponse.json(
          { error: 'You already fly with a team — leave it first' },
          { status: 409 }
        )
      }
      console.error('[Team] Accept update failed:', updateError)
      return NextResponse.json({ error: 'Failed to accept invite' }, { status: 500 })
    }
    if ((updated ?? []).length === 0) {
      return NextResponse.json(
        { error: 'Invite is no longer available' },
        { status: 409 }
      )
    }

    // Going ACTIVE kills the member's open transfer requests — no team
    // could ever sign one past the one-active index. Best-effort sweep;
    // a failure just leaves rows every actioning path already tolerates.
    // Other pending invites stay untouched (existing design: they pile
    // up and die on that same index).
    const { error: sweepError } = await supabase
      .from('team_affiliations')
      .delete()
      .eq('member_user_id', session.userId)
      .eq('status', 'applied')
    if (sweepError) {
      console.error('[Team] Open-application sweep failed:', sweepError)
    }

    const team = teamIdentity(invite.team)

    // The team hears about the accept; the member's own username rides in
    // the payload so the roster page can deep-link without a re-join.
    const member = await loadUserRow(supabase, session.userId)
    const memberName = member.ok
      ? teamIdentity(member.user).username
      : `User${session.userId}`
    await insertMissingNotifications(supabase, team.userId, [
      {
        type: 'team_invite_accepted',
        title: 'AFFILIATE JOINED',
        body: `@${memberName} accepted your team invite.`,
        data: { memberUserId: session.userId, username: memberName, affiliationId },
        dedupeKey: `team_invite_accepted_${affiliationId}`
      }
    ])

    return NextResponse.json({ success: true, team })
  } catch (error) {
    console.error('[Team] Accept POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const affiliationId = Number(request.nextUrl.searchParams.get('affiliationId'))
    if (!Number.isInteger(affiliationId) || affiliationId <= 0) {
      return NextResponse.json({ error: 'Invalid affiliationId' }, { status: 400 })
    }

    // Decline = delete, scoped to the caller's own PENDING row so this
    // can never touch an active membership (that's /api/team/membership).
    const { data: deleted, error } = await supabase
      .from('team_affiliations')
      .delete()
      .eq('id', affiliationId)
      .eq('member_user_id', session.userId)
      .eq('status', 'pending')
      .select('id')

    if (error) {
      console.error('[Team] Decline failed:', error)
      return NextResponse.json({ error: 'Failed to decline invite' }, { status: 500 })
    }
    if ((deleted ?? []).length === 0) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Team] Decline DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
