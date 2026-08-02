import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isApprovedTeam } from '@/lib/entitlements'
import { insertMissingNotifications } from '@/lib/notifications'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { TEAM_SEAT_LIMIT, getTeamSeatUsage } from '@/lib/teams'
import {
  TEAM_USER_SELECT,
  escapeLikePattern,
  isTeamTier,
  isUniqueViolation,
  loadUserRow,
  teamIdentity,
  type TeamUserRow
} from '@/lib/teamRoster'

// Invite a member by callsign. Only a fully-lit team (TEAM tier AND
// approved review) may invite; pending invites hold a seat, so the cap
// check counts pending + active. The pre-checks give friendly errors;
// the two unique indexes (one row per team+member pair, one ACTIVE
// affiliation per member) are the race backstop — a 23505 on insert is
// reported as "already invited" instead of a 500.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const bodySchema = z.object({
  callsign: z
    .string()
    .trim()
    .min(1)
    .max(40)
    // Invites are typed by hand; tolerate a leading @.
    .transform((value) => value.replace(/^@/, '').trim())
    .refine((value) => value.length > 0, { message: 'Callsign is required' })
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
      return NextResponse.json({ error: 'Invalid callsign' }, { status: 400 })
    }
    const callsign = parsed.data.callsign

    const caller = await loadUserRow(supabase, session.userId)
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status })
    }
    if (!isTeamTier(caller.user.subscription_tier)) {
      return NextResponse.json({ error: 'Team accounts only' }, { status: 403 })
    }
    if (!isApprovedTeam(caller.user)) {
      return NextResponse.json(
        { error: 'Invites unlock once your team passes review' },
        { status: 403 }
      )
    }

    // getTeamSeatUsage throws on a failed read — never enforce the cap on
    // a guessed count.
    const seatsUsed = await getTeamSeatUsage(supabase, session.userId)
    if (seatsUsed >= TEAM_SEAT_LIMIT) {
      return NextResponse.json(
        { error: `All ${TEAM_SEAT_LIMIT} affiliate seats are in use` },
        { status: 409 }
      )
    }

    // Case-insensitive exact handle match (ilike with escaped wildcards).
    const { data: targets, error: targetError } = await supabase
      .from('users')
      .select(TEAM_USER_SELECT)
      .ilike('twitter_username', escapeLikePattern(callsign))
      .limit(1)

    if (targetError) {
      console.error('[Team] Invite target lookup failed:', targetError)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }

    const target = (targets ?? [])[0] as TeamUserRow | undefined
    // Banned/suspended accounts answer "not found", matching user search —
    // an invite probe must not reveal moderation state.
    if (!target || target.status === 'banned' || target.status === 'suspended') {
      return NextResponse.json({ error: 'Callsign not found' }, { status: 404 })
    }
    if (Number(target.id) === session.userId) {
      return NextResponse.json(
        { error: 'A team cannot affiliate itself' },
        { status: 400 }
      )
    }
    if (isTeamTier(target.subscription_tier)) {
      return NextResponse.json(
        { error: 'Team accounts cannot be affiliated' },
        { status: 400 }
      )
    }

    // One ACTIVE affiliation per member, ever. Pending invites from other
    // teams may pile up — first accept wins.
    const { count: activeCount, error: activeError } = await supabase
      .from('team_affiliations')
      .select('id', { count: 'exact', head: true })
      .eq('member_user_id', target.id)
      .eq('status', 'active')

    if (activeError) {
      console.error('[Team] Active-affiliation check failed:', activeError)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }
    if ((activeCount ?? 0) > 0) {
      return NextResponse.json(
        { error: 'That pilot already flies with a team' },
        { status: 409 }
      )
    }

    const { data: inserted, error: insertError } = await supabase
      .from('team_affiliations')
      .insert({
        team_user_id: session.userId,
        member_user_id: target.id,
        status: 'pending'
      })
      .select('id')
      .single()

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        return NextResponse.json(
          { error: 'Already invited' },
          { status: 409 }
        )
      }
      console.error('[Team] Invite insert failed:', insertError)
      return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 })
    }

    const affiliationId = Number(inserted?.id)
    const team = teamIdentity(caller.user)

    // Keyed by the affiliation row id: a declined-then-reissued invite is
    // a NEW row, so the member is notified again; re-processing the same
    // row stays silent.
    await insertMissingNotifications(supabase, Number(target.id), [
      {
        type: 'team_invite',
        title: 'TEAM INVITE',
        body: `@${team.username} wants you on their affiliate roster.`,
        data: {
          teamUserId: team.userId,
          username: team.username,
          name: team.name,
          avatarUrl: team.avatar,
          affiliationId
        },
        dedupeKey: `team_invite_${affiliationId}`
      }
    ])

    return NextResponse.json({
      success: true,
      member: teamIdentity(target),
      seatsUsed: seatsUsed + 1,
      seatLimit: TEAM_SEAT_LIMIT
    })
  } catch (error) {
    console.error('[Team] Invite POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
