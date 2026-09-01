import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import {
  gateProfileForViewer,
  getFollowCounts,
  getMutualFollowerProof,
  getViewerFollowContext,
  loadPublicProfileCached,
  PROFILE_LOAD_FAILED,
  PROFILE_USERNAME_RE
} from '@/lib/publicProfile'
import { getTeamAffiliatesList } from '@/lib/teamAffiliates'

// Full public profile for /u/[username]. Superset of the leaderboard
// profile card payload: adds follow counts and — when the request
// carries a valid session — the viewer relationship (isFollowing /
// followsYou) plus mutual-follow social proof. Anonymous visitors
// still get the whole public profile; viewer fields come back null.
// Private accounts get their top tools / badges stripped server-side
// unless the viewer is the owner or a follower.

export const dynamic = 'force-dynamic'

// The cached loader (unstable_cache around loadPublicProfile, 60s TTL,
// tagged per handle) lives in @/lib/publicProfile so the /u/[username]
// page metadata and OG card share this route's Data Cache entry.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const username = String((await params).username || '').trim()
  if (!PROFILE_USERNAME_RE.test(username)) {
    return NextResponse.json(
      { success: false, error: 'Invalid username' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  try {
    // Viewer identity is optional — a missing/expired session just means
    // no relationship context, never an error. It resolves in parallel
    // with the profile itself instead of after it.
    const [result, session] = await Promise.all([
      loadPublicProfileCached(username.toLowerCase())(),
      getSessionUserId(request)
    ])

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }
    const profile = result.profile
    const viewerId = session.ok ? session.userId : null

    // The Affiliates roster only exists for approved Team accounts —
    // isTeam already encodes "tier TEAM AND review approved", so a
    // pending/lapsed/rejected team publishes no roster.
    const [counts, viewerContext, mutualProof, affiliates] = await Promise.all([
      getFollowCounts(supabase, profile.userId),
      viewerId !== null
        ? getViewerFollowContext(supabase, viewerId, profile.userId)
        : Promise.resolve(null),
      viewerId !== null && viewerId !== profile.userId
        ? getMutualFollowerProof(supabase, viewerId, profile.userId)
        : Promise.resolve(null),
      profile.isTeam
        ? getTeamAffiliatesList(supabase, profile.userId)
        : Promise.resolve(null)
    ])

    return NextResponse.json({
      success: true,
      profile: {
        ...gateProfileForViewer(profile, viewerContext),
        followers: counts.followers,
        following: counts.following,
        viewer: viewerContext,
        followedBy: mutualProof,
        affiliates
      }
    })
  } catch (err) {
    if (err instanceof Error && err.message === PROFILE_LOAD_FAILED) {
      return NextResponse.json(
        { success: false, error: 'Profile lookup failed' },
        { status: 500 }
      )
    }
    console.error('[PublicProfile] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Unexpected error' },
      { status: 500 }
    )
  }
}
