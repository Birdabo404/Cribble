import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import { isMissingFollowsTable } from '@/lib/publicProfile'

// Follower / following lists for a public profile, newest edge first.
// Every row carries the viewer relationship so the list can render
// inline FOLLOW / FOLLOWING buttons and FOLLOWS YOU chips — each
// list doubles as a discovery surface.

export const dynamic = 'force-dynamic'

const USERNAME_RE = /^[A-Za-z0-9_.-]{1,40}$/
const PAGE_SIZE = 50

interface FollowListUser {
  userId: number
  username: string
  display_name: string
  profile_image: string | null
  tier: string
  isYou: boolean
  isFollowing: boolean
  followsYou: boolean
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const username = String((await params).username || '').trim()
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { success: false, error: 'Invalid username' },
      { status: 400 }
    )
  }

  const type = request.nextUrl.searchParams.get('type')
  if (type !== 'followers' && type !== 'following') {
    return NextResponse.json(
      { success: false, error: 'type must be followers or following' },
      { status: 400 }
    )
  }

  const offsetRaw = Number(request.nextUrl.searchParams.get('offset') || 0)
  const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0

  const supabase = createServiceClient()

  try {
    const escaped = username.replace(/([%_\\])/g, '\\$1')
    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('id, status')
      .ilike('twitter_username', escaped)
      .limit(1)
      .maybeSingle()

    if (targetError) {
      console.error('[FollowList] Target lookup failed:', targetError)
      return NextResponse.json({ success: false, error: 'Lookup failed' }, { status: 500 })
    }
    if (!target || target.status === 'banned') {
      return NextResponse.json({ success: false, error: 'Player not found' }, { status: 404 })
    }

    // followers: edges pointing at the target; following: edges leaving it.
    const edgeColumn = type === 'followers' ? 'follower_id' : 'followee_id'
    const matchColumn = type === 'followers' ? 'followee_id' : 'follower_id'

    const { data: edges, error: edgesError, count } = await supabase
      .from('follows')
      .select(`${edgeColumn}, created_at`, { count: 'exact' })
      .eq(matchColumn, target.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (edgesError) {
      // Before migration 013 lands the graph simply doesn't exist yet —
      // that's an empty roster, not a server error.
      if (isMissingFollowsTable(edgesError)) {
        return NextResponse.json({ success: true, users: [], total: 0, hasMore: false })
      }
      console.error('[FollowList] Edge query failed:', edgesError)
      return NextResponse.json({ success: false, error: 'Query failed' }, { status: 500 })
    }

    const orderedIds = (edges || []).map(
      (e) => Number((e as Record<string, unknown>)[edgeColumn])
    )

    if (orderedIds.length === 0) {
      return NextResponse.json({
        success: true,
        users: [],
        total: count ?? 0,
        hasMore: false
      })
    }

    const session = await getSessionUserId(request)
    const viewerId = session.ok ? session.userId : null

    const [usersRes, viewerEdgesRes] = await Promise.all([
      supabase
        .from('users')
        .select('id, twitter_username, twitter_name, twitter_profile_image, subscription_tier, status')
        .in('id', orderedIds),
      viewerId !== null
        ? supabase
            .from('follows')
            .select('follower_id, followee_id')
            .or(`follower_id.eq.${viewerId},followee_id.eq.${viewerId}`)
            .or(`follower_id.in.(${orderedIds.join(',')}),followee_id.in.(${orderedIds.join(',')})`)
        : Promise.resolve({ data: null, error: null })
    ])

    if (usersRes.error) {
      console.error('[FollowList] User hydrate failed:', usersRes.error)
      return NextResponse.json({ success: false, error: 'Query failed' }, { status: 500 })
    }

    const viewerFollowing = new Set<number>()
    const viewerFollowers = new Set<number>()
    for (const edge of viewerEdgesRes.data || []) {
      const from = Number(edge.follower_id)
      const to = Number(edge.followee_id)
      if (from === viewerId) viewerFollowing.add(to)
      if (to === viewerId) viewerFollowers.add(from)
    }

    const byId = new Map((usersRes.data || []).map((u) => [Number(u.id), u]))
    const users: FollowListUser[] = []
    for (const id of orderedIds) {
      const u = byId.get(id)
      if (!u || u.status === 'banned') continue
      users.push({
        userId: id,
        username: u.twitter_username || `User${id}`,
        display_name: u.twitter_name || u.twitter_username || `User${id}`,
        profile_image: u.twitter_profile_image || null,
        tier: (u.subscription_tier || 'FREE').toUpperCase(),
        isYou: viewerId === id,
        isFollowing: viewerFollowing.has(id),
        followsYou: viewerFollowers.has(id)
      })
    }

    const total = count ?? users.length
    return NextResponse.json({
      success: true,
      users,
      total,
      hasMore: offset + PAGE_SIZE < total
    })
  } catch (err) {
    console.error('[FollowList] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}
