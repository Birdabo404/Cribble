import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import { insertMissingNotifications } from '@/lib/notifications'
import { getFollowCounts, isMissingFollowsTable } from '@/lib/publicProfile'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'

// Follow graph mutations. POST follows, DELETE unfollows; both are
// idempotent. A brand-new edge notifies the followee once — the
// dedupe key survives unfollow/refollow cycles, so toggling a follow
// can never be used to spam someone's feed.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

interface TargetRow {
  id: number
  twitter_username: string | null
  status: string | null
}

async function resolveTarget(rawId: unknown): Promise<
  | { ok: true; target: TargetRow }
  | { ok: false; status: number; error: string }
> {
  const targetId = Number(rawId)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return { ok: false, status: 400, error: 'Invalid userId' }
  }

  const { data: target, error } = await supabase
    .from('users')
    .select('id, twitter_username, status')
    .eq('id', targetId)
    .maybeSingle()

  if (error) {
    console.error('[Follow] Target lookup failed:', error)
    return { ok: false, status: 500, error: 'Lookup failed' }
  }
  if (!target || target.status === 'banned') {
    return { ok: false, status: 404, error: 'Player not found' }
  }
  return { ok: true, target: target as TargetRow }
}

export async function POST(request: NextRequest) {
  try {
    // Follow/unfollow are button-driven; the general API budget keeps a
    // scripted client from hammering the notification path.
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

    let body: { userId?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const resolved = await resolveTarget(body.userId)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }
    const target = resolved.target

    if (target.id === session.userId) {
      return NextResponse.json({ error: 'You cannot follow yourself' }, { status: 400 })
    }

    // ignoreDuplicates + select: returned rows are only the edges that
    // were actually created, which is exactly the "should we notify" bit.
    const { data: inserted, error: insertError } = await supabase
      .from('follows')
      .upsert(
        { follower_id: session.userId, followee_id: target.id },
        { onConflict: 'follower_id,followee_id', ignoreDuplicates: true }
      )
      .select('follower_id')

    if (insertError) {
      if (isMissingFollowsTable(insertError)) {
        return NextResponse.json(
          { error: 'Follow system not initialized yet' },
          { status: 503 }
        )
      }
      console.error('[Follow] Insert failed:', insertError)
      return NextResponse.json({ error: 'Failed to follow' }, { status: 500 })
    }

    if ((inserted || []).length > 0) {
      const { data: follower } = await supabase
        .from('users')
        .select('twitter_username')
        .eq('id', session.userId)
        .maybeSingle()

      const followerName = follower?.twitter_username || `User${session.userId}`
      await insertMissingNotifications(supabase, target.id, [
        {
          type: 'social',
          title: 'NEW WINGMAN',
          body: `@${followerName} started following you.`,
          data: { followerId: session.userId, username: followerName },
          dedupeKey: `follow_from_${session.userId}`
        }
      ])
    }

    const counts = await getFollowCounts(supabase, target.id)
    return NextResponse.json({ success: true, following: true, followers: counts.followers })
  } catch (error) {
    console.error('[Follow] POST error:', error)
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

    const resolved = await resolveTarget(request.nextUrl.searchParams.get('userId'))
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }
    const target = resolved.target

    const { error: deleteError } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', session.userId)
      .eq('followee_id', target.id)

    if (deleteError) {
      if (isMissingFollowsTable(deleteError)) {
        return NextResponse.json(
          { error: 'Follow system not initialized yet' },
          { status: 503 }
        )
      }
      console.error('[Follow] Delete failed:', deleteError)
      return NextResponse.json({ error: 'Failed to unfollow' }, { status: 500 })
    }

    const counts = await getFollowCounts(supabase, target.id)
    return NextResponse.json({ success: true, following: false, followers: counts.followers })
  } catch (error) {
    console.error('[Follow] DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
