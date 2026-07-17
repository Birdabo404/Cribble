import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import {
  gateProfileForViewer,
  getViewerFollowContext,
  loadPublicProfile
} from '@/lib/publicProfile'

// Public player profile for the leaderboard's profile cards. Assembly
// lives in src/lib/publicProfile.ts, shared with /api/profile/[username]
// (the full profile page) so the two surfaces can't drift apart. The
// same private-mode gate applies here — otherwise this endpoint would
// be a side door around follower-only tools/badges.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userId = Number(request.nextUrl.searchParams.get('userId'))
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json(
      { success: false, error: 'Invalid userId' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  try {
    const result = await loadPublicProfile(supabase, { userId })
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }

    const session = await getSessionUserId(request)
    const viewerContext = session.ok
      ? await getViewerFollowContext(supabase, session.userId, result.profile.userId)
      : null

    return NextResponse.json({
      success: true,
      profile: gateProfileForViewer(result.profile, viewerContext)
    })
  } catch (err) {
    console.error('[PlayerProfile] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}
