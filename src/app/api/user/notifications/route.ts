import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ensureSeasonNotifications } from '@/lib/notifications'
import { getSessionUserId } from '@/lib/sessionAuth'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FEED_LIMIT = 30

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    // Time-based season notifications are generated lazily on read
    // (idempotent via dedupe keys) since there is no scheduler yet.
    await ensureSeasonNotifications(supabase, session.userId)

    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('id, type, title, body, data, read_at, created_at')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false })
      .limit(FEED_LIMIT)

    if (error) {
      console.error('[Notifications] Feed query failed:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to load notifications' },
        { status: 500 }
      )
    }

    const { count: unreadCount, error: countError } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.userId)
      .is('read_at', null)

    if (countError) {
      console.error('[Notifications] Unread count failed:', countError)
    }

    return NextResponse.json({
      success: true,
      notifications: notifications ?? [],
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
