import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isApprovedTeam } from '@/lib/entitlements'
import { insertMissingNotifications } from '@/lib/notifications'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { TEAM_SEAT_LIMIT, getTeamSeatUsage } from '@/lib/teams'
import {
  isTeamTier,
  isUniqueViolation,
  loadUserRow,
  resolveTeamAuthority,
  teamIdentity,
  type TeamAuthority,
  type TeamUserRow
} from '@/lib/teamRoster'

// Team side of the transfer-request flow: SIGN (applied -> active) or
// PASS (hard delete + a neutral notification). Applications are
// seatless, so the 10-seat cap bites HERE, at sign time. The guarded
// update only flips a row that is still this team's APPLIED request;
// the one-active-affiliation partial unique index turns a pilot who
// signed elsewhere mid-flight into a 23505, answered as a friendly 409.
// The queue answers to the franchise login OR a signed OWNER
// (resolveTeamAuthority, 066) — an owner processes transfers from
// their personal account. Signed applicants land as plain members
// (role rides the column default).

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const APPLICATION_JOIN_SELECT = `id, status, invited_at, message,
  member:users!team_affiliations_member_user_id_fkey(
    id, twitter_username, twitter_name, twitter_profile_image,
    subscription_tier, team_review_status, status
  )`

interface ApplicationJoinRow {
  id: number
  status: string
  invited_at: string
  message: string | null
  member: TeamUserRow | null
}

const bodySchema = z.object({
  applicationId: z.number().int().positive(),
  action: z.enum(['accept', 'decline'])
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
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { applicationId, action } = parsed.data

    const caller = await loadUserRow(supabase, session.userId)
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status })
    }
    // Franchise login or a signed owner — either may work the queue.
    let authority: TeamAuthority | null
    let teamRow: TeamUserRow
    if (isTeamTier(caller.user.subscription_tier)) {
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
    // Only SIGN is review-gated. PASS stays open to any TEAM-tier owner
    // of the row: an under-review team must be able to clear dead
    // requests from its queue, and the decline notification is correct
    // either way. (An owner's team is live — approved — by the
    // authority gate, so this only ever bites the franchise arm.)
    if (action === 'accept' && !isApprovedTeam(teamRow)) {
      return NextResponse.json(
        { error: 'Signing unlocks once your team passes review' },
        { status: 403 }
      )
    }

    const { data: appRow, error: appError } = await supabase
      .from('team_affiliations')
      .select(APPLICATION_JOIN_SELECT)
      .eq('id', applicationId)
      .eq('team_user_id', authority.teamUserId)
      .eq('status', 'applied')
      .maybeSingle()

    if (appError) {
      console.error('[Team] Application lookup failed:', appError)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }

    const application = appRow as unknown as ApplicationJoinRow | null
    if (!application || !application.member) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    // A moderated applicant's request is dead weight: purge the row and
    // answer with the same "not found" opacity the invite flow gives
    // banned accounts — actioning it must not reveal moderation state.
    const applicant = application.member
    if (applicant.status === 'banned' || applicant.status === 'suspended') {
      const { error: purgeError } = await supabase
        .from('team_affiliations')
        .delete()
        .eq('id', applicationId)
        .eq('team_user_id', authority.teamUserId)
        .eq('status', 'applied')
      if (purgeError) {
        console.error('[Team] Moderated application purge failed:', purgeError)
      }
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    // Notifications speak as the FRANCHISE even when an owner clicked.
    const team = teamIdentity(teamRow)
    const member = teamIdentity(applicant)

    switch (action) {
      case 'accept': {
        // getTeamSeatUsage throws on a failed read — never enforce the
        // cap on a guessed count. Applications held no seat until now.
        // Check-then-update tolerates the same race the invite route's
        // check-then-insert does (invite/route.ts): two concurrent SIGNs
        // at 9/10 can both pass the count and land 11 actives. Accepted —
        // the window is tiny and an over-cap roster is self-evident on
        // the console, not corrupting.
        const seatsUsed = await getTeamSeatUsage(supabase, authority.teamUserId)
        if (seatsUsed >= TEAM_SEAT_LIMIT) {
          return NextResponse.json(
            { error: `All ${TEAM_SEAT_LIMIT} affiliate seats are in use` },
            { status: 409 }
          )
        }

        // Guarded update: only flips a row that is still this team's
        // APPLIED request. The one-ACTIVE-affiliation partial unique
        // index turns a lost sign-race into a 23505. role is untouched:
        // a signed applicant is a plain member (the column default).
        const { data: updated, error: updateError } = await supabase
          .from('team_affiliations')
          .update({ status: 'active', accepted_at: new Date().toISOString() })
          .eq('id', applicationId)
          .eq('team_user_id', authority.teamUserId)
          .eq('status', 'applied')
          .select('id')

        if (updateError) {
          if (isUniqueViolation(updateError)) {
            // applicationGone: the row is dead weight now (the pilot's
            // activation elsewhere swept it, or it soon will) — the
            // client drops it from the queue on this flag.
            return NextResponse.json(
              { error: 'That pilot already signed with another team', applicationGone: true },
              { status: 409 }
            )
          }
          console.error('[Team] Application accept failed:', updateError)
          return NextResponse.json({ error: 'Failed to sign application' }, { status: 500 })
        }
        if ((updated ?? []).length === 0) {
          return NextResponse.json(
            { error: 'Application is no longer available' },
            { status: 409 }
          )
        }

        // The pilot just went ACTIVE, so their other open transfer
        // requests are dead — no team could ever sign one past the
        // one-active index. Best-effort sweep (the flipped row is
        // 'active' now, so it can't match): a failure just leaves rows
        // every actioning path already tolerates. Pending invites stay
        // untouched — they pile up and die on that same index.
        const { error: sweepError } = await supabase
          .from('team_affiliations')
          .delete()
          .eq('member_user_id', member.userId)
          .eq('status', 'applied')
        if (sweepError) {
          console.error('[Team] Open-application sweep failed:', sweepError)
        }

        await insertMissingNotifications(supabase, member.userId, [
          {
            type: 'team_application_accepted',
            title: 'REQUEST SIGNED',
            body: `@${team.username} signed your transfer request.`,
            data: {
              teamUserId: team.userId,
              username: team.username,
              name: team.name,
              avatarUrl: team.avatar,
              applicationId
            },
            dedupeKey: `team_application_accepted_${applicationId}`
          }
        ])

        return NextResponse.json({
          success: true,
          member,
          seatsUsed: seatsUsed + 1
        })
      }
      case 'decline': {
        // PASS = hard delete (consistent with invite declines — the row
        // would otherwise block a future re-application) + a neutral
        // notification so the pilot isn't left waiting on a ghost.
        const { data: deleted, error: deleteError } = await supabase
          .from('team_affiliations')
          .delete()
          .eq('id', applicationId)
          .eq('team_user_id', authority.teamUserId)
          .eq('status', 'applied')
          .select('id')

        if (deleteError) {
          console.error('[Team] Application decline failed:', deleteError)
          return NextResponse.json(
            { error: 'Failed to pass on application' },
            { status: 500 }
          )
        }
        if ((deleted ?? []).length === 0) {
          return NextResponse.json({ error: 'Application not found' }, { status: 404 })
        }

        await insertMissingNotifications(supabase, member.userId, [
          {
            type: 'team_application_declined',
            title: 'REQUEST PASSED',
            body: `@${team.username} passed on your transfer request.`,
            data: {
              teamUserId: team.userId,
              username: team.username,
              name: team.name,
              avatarUrl: team.avatar,
              applicationId
            },
            dedupeKey: `team_application_declined_${applicationId}`
          }
        ])

        return NextResponse.json({ success: true })
      }
      default: {
        const exhaustive: never = action
        return exhaustive
      }
    }
  } catch (error) {
    console.error('[Team] Applications POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
