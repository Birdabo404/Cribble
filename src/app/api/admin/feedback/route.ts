import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Beta feedback inbox, readable by all staff. Newest first with an id
// cursor (same shape as the audit log) and an optional status filter
// for triage: new / seen / done.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const PAGE_SIZE = 50

const STATUSES = ['new', 'seen', 'done'] as const
type FeedbackStatus = (typeof STATUSES)[number]

function parseStatus(raw: string | null): FeedbackStatus | null {
  if (!raw || raw === 'all') return null
  return (STATUSES as readonly string[]).includes(raw) ? (raw as FeedbackStatus) : null
}

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'feedback.view')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const search = request.nextUrl.searchParams
  const rawBefore = search.get('before')
  const beforeValue = rawBefore ? Number(rawBefore) : null
  const before = beforeValue !== null && Number.isInteger(beforeValue) && beforeValue > 0
    ? beforeValue
    : null
  const status = parseStatus(search.get('status'))

  try {
    let query = supabase
      .from('feedback')
      .select(
        `id, user_id, category, message, page_path, status, created_at,
         user:users!feedback_user_id_fkey(twitter_username)`
      )
      .order('id', { ascending: false })
      .limit(PAGE_SIZE)

    if (status !== null) query = query.eq('status', status)
    if (before !== null) query = query.lt('id', before)

    const { data, error } = await query

    if (error) {
      console.error('[AdminFeedback] Query failed:', error)
      return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 })
    }

    // PostgREST returns the FK-embedded user as a single object (many-to-
    // one), but without generated DB types the client infers an array —
    // hence the unknown hop (same as the audit route).
    const items = (data || []).map((row) => ({
      id: Number(row.id),
      user_id: Number(row.user_id),
      username:
        (row.user as unknown as { twitter_username: string | null } | null)?.twitter_username ??
        null,
      category: row.category,
      message: row.message,
      page_path: row.page_path ?? null,
      status: row.status,
      created_at: row.created_at
    }))

    return NextResponse.json({
      success: true,
      items,
      nextCursor: items.length === PAGE_SIZE ? items[items.length - 1]!.id : null
    })
  } catch (err) {
    console.error('[AdminFeedback] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
