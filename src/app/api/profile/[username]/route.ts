import { revalidateTag } from 'next/cache'
import { after, NextRequest, NextResponse } from 'next/server'
import { refreshStaleCards } from '@/lib/hangar/cards'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import {
  gateProfileForViewer,
  getFollowCounts,
  getMutualFollowerProof,
  getViewerFollowContext,
  loadPublicProfileCached,
  PROFILE_LOAD_FAILED,
  PROFILE_USERNAME_RE,
  publicProfileCacheTag
} from '@/lib/publicProfile'
import { getTeamAffiliatesList } from '@/lib/teamAffiliates'

// Full public profile for /u/[username]. Superset of the leaderboard
// profile card payload: adds follow counts and — when the request
// carries a valid session — the viewer relationship (isFollowing /
// followsYou) plus mutual-follow social proof. Anonymous visitors
// still get the whole public profile; viewer fields come back null.
// Private accounts get their top tools / badges stripped server-side
// unless the viewer is the owner or a follower.
//
// HANGAR cards ride the same cached payload and are never resolved on
// the request path. When the loader saw stale or missing link_cards
// rows it says so (hangarStale); this route then refreshes them in
// after() — off the response — and busts the profile tag so the next
// viewer gets the fresh cards. Stale-while-revalidate, no cron.

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

    // Hangar refresh, off the response path. refreshStaleCards re-checks
    // freshness against the live table first, so a burst of viewers on
    // one stale cache entry does not fan out into a burst of GitHub
    // calls; the tag is only busted when a row actually changed. Every
    // failure is swallowed — decoration must never fail the profile.
    // (The ?? covers a Data Cache entry written before this field
    // existed; it ages out within the 60s TTL.)
    const stalePins = result.hangarStale ?? []
    if (stalePins.length > 0) {
      after(async () => {
        try {
          const refreshed = await refreshStaleCards(supabase, stalePins)
          if (refreshed > 0) revalidateTag(publicProfileCacheTag(username))
        } catch (err) {
          console.error('[PublicProfile] Hangar refresh failed:', err)
        }
      })
    }

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
