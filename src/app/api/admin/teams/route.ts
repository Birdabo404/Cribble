import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { getTeamSeatUsage } from '@/lib/teams'

// Team review queue — any staff (team.review sits at the moderator
// floor, the same gate as the approve/reject actions). Defaults to
// the accounts awaiting review (team_review_status='pending'); pass
// ?status=approved|rejected to audit past decisions. Each row carries
// the anti-impersonation signals staff review against: OAuth
// provider identity (users.twitter_id — GitHub and X ids share the
// column, there is no provider column), account age, website claim,
// current tier (a rejected/lapsed team shows FREE) and seat usage.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const PAGE_LIMIT = 100

const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
type ReviewStatus = (typeof REVIEW_STATUSES)[number]

function parseStatus(raw: string | null): ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(raw ?? '')
    ? (raw as ReviewStatus)
    : 'pending'
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Best-effort provider guess from the avatar host. The users table
 *  stores no provider column — GitHub and X both live in twitter_* —
 *  so this is a review hint, never an authorization input. */
function providerHint(avatar: string | null): 'github' | 'x' | 'unknown' {
  if (!avatar) return 'unknown'
  try {
    const host = new URL(avatar).hostname.toLowerCase()
    if (host.endsWith('githubusercontent.com')) return 'github'
    if (host.endsWith('twimg.com')) return 'x'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'team.review')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const status = parseStatus(request.nextUrl.searchParams.get('status'))

  try {
    const { data, error } = await supabase
      .from('users')
      .select(
        `id, twitter_id, twitter_username, twitter_name, twitter_profile_image,
         subscription_tier, team_review_status, team_approved_at, status,
         metadata, created_at, last_login`
      )
      .eq('team_review_status', status)
      .order('id', { ascending: false })
      .limit(PAGE_LIMIT)

    if (error) {
      console.error('[AdminTeams] Queue query failed:', error)
      return NextResponse.json({ error: 'Failed to load teams' }, { status: 500 })
    }

    // Seat usage per team via the shared helper (pending invites hold a
    // seat). One count query per row is fine here — the review queue is a
    // manually-worked list, not a hot path. A failed count degrades to
    // null rather than hiding the applicant.
    const teams = await Promise.all(
      (data ?? []).map(async (row) => {
        let seats: number | null = null
        try {
          seats = await getTeamSeatUsage(supabase, Number(row.id))
        } catch (seatError) {
          console.error('[AdminTeams] Seat count failed:', seatError)
        }

        const meta = (row.metadata || {}) as Record<string, unknown>
        const avatar = row.twitter_profile_image || null

        return {
          userId: Number(row.id),
          username: row.twitter_username || null,
          display_name: row.twitter_name || row.twitter_username || `User${row.id}`,
          avatar,
          provider_user_id: row.twitter_id ? String(row.twitter_id) : null,
          provider_hint: providerHint(avatar),
          account_status: row.status || 'active',
          tier: (row.subscription_tier || 'FREE').toUpperCase(),
          review_status: row.team_review_status,
          team_approved_at: row.team_approved_at ?? null,
          website: str(meta.website),
          team_since: str(meta.team_since),
          created_at: row.created_at ?? null,
          last_login: row.last_login ?? null,
          seats
        }
      })
    )

    return NextResponse.json({ success: true, status, teams })
  } catch (err) {
    console.error('[AdminTeams] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
