import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Owner-only waitlist invite queue, read exclusively through the
// waitlist_invite_queue view (migration 039). The view is the PII
// boundary: it exposes email + signup date + send state and never
// ip_address or user_agent, so neither can this route.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

// Long enough to paste a full email address (RFC cap).
const MAX_QUERY = 254
const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 100

const STATUS_FILTERS = ['pending', 'sent', 'failed', 'redeemed'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const QUEUE_SELECT =
  'waitlist_id, email, created_at, attempt_count, last_attempt_at, sent_at, last_error, code, redeemed_at, redeemed_by_username, queue_status'

interface QueueRow {
  waitlist_id: string
  email: string
  created_at: string
  attempt_count: number | null
  last_attempt_at: string | null
  sent_at: string | null
  last_error: string | null
  code: string | null
  redeemed_at: string | null
  redeemed_by_username: string | null
  queue_status: 'pending' | 'sending' | 'sent' | 'failed' | 'redeemed'
}

// Response contract shared with the admin waitlist page. Kept in sync
// manually with [id]/invite/route.ts — route files cannot export
// non-handler symbols.
function toEntry(row: QueueRow) {
  return {
    id: row.waitlist_id,
    email: row.email,
    createdAt: row.created_at,
    status: row.queue_status,
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: row.last_attempt_at ?? null,
    sentAt: row.sent_at ?? null,
    lastError: row.last_error ?? null,
    code: row.code ?? null,
    redeemedBy: row.redeemed_by_username ?? null,
    redeemedAt: row.redeemed_at ?? null
  }
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    // Owner-only, same rationale as /api/admin/invites: these codes
    // create accounts.
    const staff = await getStaffUser(request, 'invite.manage')
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status })
    }

    const params = request.nextUrl.searchParams

    const statusParam = params.get('status') || 'all'
    // 'sending' is deliberately not a filter tab: in-flight rows are
    // transient and surface under 'all' with status 'sending'.
    const status: StatusFilter | 'all' = (STATUS_FILTERS as readonly string[]).includes(statusParam)
      ? (statusParam as StatusFilter)
      : 'all'

    const q = String(params.get('q') || '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, MAX_QUERY)
    const pattern = q ? `%${q.replace(/([%_\\])/g, '\\$1')}%` : null

    const pageParam = Number(params.get('page'))
    const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1
    const pageSizeParam = Number(params.get('pageSize'))
    const pageSize = Number.isInteger(pageSizeParam) && pageSizeParam >= 1
      ? Math.min(pageSizeParam, PAGE_SIZE_MAX)
      : PAGE_SIZE_DEFAULT

    const rangeFrom = (page - 1) * pageSize
    const rangeTo = rangeFrom + pageSize - 1

    const listQuery = () => {
      let query = supabase
        .from('waitlist_invite_queue')
        .select(QUEUE_SELECT, { count: 'exact' })
      if (status !== 'all') query = query.eq('queue_status', status)
      if (pattern) query = query.ilike('email', pattern)
      // Oldest signups first — they've waited longest.
      return query.order('created_at', { ascending: true }).range(rangeFrom, rangeTo)
    }

    // Tab badges follow the current search, so counts always agree with
    // what switching tabs would show.
    const countQuery = (filter: StatusFilter | null) => {
      let query = supabase
        .from('waitlist_invite_queue')
        .select('*', { count: 'exact', head: true })
      if (filter) query = query.eq('queue_status', filter)
      if (pattern) query = query.ilike('email', pattern)
      return query
    }

    const [list, all, pending, sent, failed, redeemed] = await Promise.all([
      listQuery(),
      countQuery(null),
      countQuery('pending'),
      countQuery('sent'),
      countQuery('failed'),
      countQuery('redeemed')
    ])

    const failure =
      list.error || all.error || pending.error || sent.error || failed.error || redeemed.error
    if (failure) {
      console.error('Failed to list waitlist queue:', failure)
      return NextResponse.json({ error: 'Failed to list waitlist queue' }, { status: 500 })
    }

    return NextResponse.json({
      entries: ((list.data ?? []) as QueueRow[]).map(toEntry),
      total: list.count ?? 0,
      page,
      pageSize,
      counts: {
        all: all.count ?? 0,
        pending: pending.count ?? 0,
        sent: sent.count ?? 0,
        failed: failed.count ?? 0,
        redeemed: redeemed.count ?? 0
      }
    })
  } catch (error) {
    console.error('Admin waitlist GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
