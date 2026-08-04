import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { z } from 'zod'
import {
  disabledNotificationTypes,
  resolveNotificationPrefs
} from '@/lib/notificationPrefs'
import { getSessionUserId } from '@/lib/sessionAuth'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const FEED_LIMIT = 30

interface FeedRow {
  id: number
  type: string
  title: string
  body: string | null
  data: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

/** Social rows persist only the actor's id (+ username at write time).
 *  Actor ids live under `followerId` (follows) or `friendId` (referrals). */
function socialActorId(row: Pick<FeedRow, 'type' | 'data'>): number | null {
  if (row.type !== 'social') return null
  const raw = row.data?.followerId ?? row.data?.friendId
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Joins fresh actor username + avatar into social rows' `data` at read
 *  time — avatars never go stale and rows written before this field exist
 *  get one retroactively. Response-only; nothing is written back. */
async function enrichSocialRows(rows: FeedRow[]): Promise<FeedRow[]> {
  const actorIds = [
    ...new Set(rows.map(socialActorId).filter((id): id is number => id !== null))
  ]
  if (actorIds.length === 0) return rows

  const { data: actors, error } = await supabase
    .from('users')
    .select('id, twitter_username, twitter_profile_image')
    .in('id', actorIds)

  if (error) {
    console.error('[Notifications] Actor enrich failed:', error)
    return rows
  }

  const byId = new Map(
    (actors ?? []).map((u) => [
      u.id as number,
      {
        username: (u.twitter_username as string | null) ?? null,
        avatarUrl: (u.twitter_profile_image as string | null) ?? null
      }
    ])
  )

  return rows.map((row) => {
    const actorId = socialActorId(row)
    const actor = actorId !== null ? byId.get(actorId) : undefined
    if (!actor) return row
    return {
      ...row,
      data: {
        ...(row.data ?? {}),
        ...(actor.username ? { username: actor.username } : {}),
        ...(actor.avatarUrl ? { avatarUrl: actor.avatarUrl } : {})
      }
    }
  })
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    // Categories muted in settings are excluded at query time — from the
    // feed and the unread badge alike, so the count never advertises rows
    // the panel won't show. A failed prefs lookup fails open to the
    // unfiltered feed; preferences must never take notifications down.
    const { data: owner, error: ownerError } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', session.userId)
      .maybeSingle()

    if (ownerError) {
      console.error('[Notifications] Prefs lookup failed:', ownerError)
    }

    const disabled = disabledNotificationTypes(resolveNotificationPrefs(owner?.metadata))
    const mutedList =
      disabled.length > 0 ? `(${disabled.map((t) => `"${t}"`).join(',')})` : null

    // Season notifications arrive via the season_tick() cron fan-out
    // (migration 025) — the feed is a pure read.
    let feedQuery = supabase
      .from('notifications')
      .select('id, type, title, body, data, read_at, created_at')
      .eq('user_id', session.userId)

    if (mutedList) feedQuery = feedQuery.not('type', 'in', mutedList)

    const { data: notifications, error } = await feedQuery
      .order('created_at', { ascending: false })
      .limit(FEED_LIMIT)

    if (error) {
      console.error('[Notifications] Feed query failed:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to load notifications' },
        { status: 500 }
      )
    }

    let countQuery = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.userId)
      .is('read_at', null)

    if (mutedList) countQuery = countQuery.not('type', 'in', mutedList)

    const { count: unreadCount, error: countError } = await countQuery

    if (countError) {
      console.error('[Notifications] Unread count failed:', countError)
    }

    return NextResponse.json({
      success: true,
      notifications: await enrichSocialRows((notifications ?? []) as FeedRow[]),
      unreadCount: unreadCount ?? 0
    })
  } catch (error) {
    console.error('[Notifications] GET error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

const markReadSchema = z
  .object({
    all: z.boolean().optional(),
    ids: z.array(z.number().int().positive()).min(1).max(100).optional()
  })
  .refine((body) => body.all === true || (body.ids?.length ?? 0) > 0, {
    message: 'Provide { all: true } or a non-empty ids array'
  })

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const parsed = markReadSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    let query = supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', session.userId)
      .is('read_at', null)

    if (parsed.data.all !== true) {
      query = query.in('id', parsed.data.ids!)
    }

    const { error } = await query
    if (error) {
      console.error('[Notifications] Mark read failed:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update notifications' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Notifications] PATCH error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
