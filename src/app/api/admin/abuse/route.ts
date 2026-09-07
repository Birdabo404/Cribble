import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Fraud review queue — any staff (abuse.review sits at the moderator floor,
// the same gate as the confirm/dismiss actions). Defaults to the flags
// awaiting triage (status='open'); pass ?status=confirmed|dismissed to audit
// past decisions. Each row carries the raw abuse signals the detection sweep
// fired on, plus the flagged account's identity so staff can jump to the user
// dossier. Read-only: raw usage never leaves the service role.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const PAGE_LIMIT = 100

const FLAG_STATUSES = ['open', 'confirmed', 'dismissed'] as const
type FlagStatus = (typeof FLAG_STATUSES)[number]

function parseStatus(raw: string | null): FlagStatus {
  return (FLAG_STATUSES as readonly string[]).includes(raw ?? '')
    ? (raw as FlagStatus)
    : 'open'
}

interface FlagUserJoin {
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
  status: string | null
}

interface FlagRow {
  id: number | string
  user_id: number | string
  category: string
  risk_score: number | string
  level: string
  signals: unknown
  status: string
  detection_count: number | string
  first_detected_at: string | null
  last_detected_at: string | null
  resolved_at: string | null
  resolution_reason: string | null
  users: FlagUserJoin | FlagUserJoin[] | null
}

/** PostgREST returns an embedded row as an object or (defensively) an array. */
function firstJoin(join: FlagRow['users']): FlagUserJoin | null {
  if (!join) return null
  return Array.isArray(join) ? (join[0] ?? null) : join
}

async function countByStatus(status: FlagStatus): Promise<number> {
  const { count, error } = await supabase
    .from('fraud_flags')
    .select('id', { count: 'exact', head: true })
    .eq('status', status)
  if (error) {
    console.error('[AdminAbuse] Count query failed:', error)
    return 0
  }
  return count ?? 0
}

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'abuse.review')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const status = parseStatus(request.nextUrl.searchParams.get('status'))

  try {
    const { data, error } = await supabase
      .from('fraud_flags')
      .select(
        `id, user_id, category, risk_score, level, signals, status,
         detection_count, first_detected_at, last_detected_at, resolved_at,
         resolution_reason,
         users!fraud_flags_user_id_fkey(twitter_username, twitter_name,
           twitter_profile_image, status)`
      )
      .eq('status', status)
      // Highest-risk, most-recently-seen first — the queue reads worst-first.
      .order('risk_score', { ascending: false })
      .order('last_detected_at', { ascending: false })
      .limit(PAGE_LIMIT)

    if (error) {
      console.error('[AdminAbuse] Queue query failed:', error)
      return NextResponse.json({ error: 'Failed to load fraud flags' }, { status: 500 })
    }

    const flags = ((data ?? []) as unknown as FlagRow[]).map((row) => {
      const user = firstJoin(row.users)
      const username = user?.twitter_username || null
      return {
        id: Number(row.id),
        userId: Number(row.user_id),
        username,
        display_name: user?.twitter_name || username || `User${row.user_id}`,
        avatar: user?.twitter_profile_image || null,
        account_status: user?.status || 'active',
        category: row.category,
        risk_score: Number(row.risk_score),
        level: row.level,
        signals: Array.isArray(row.signals) ? row.signals : [],
        status: row.status,
        detection_count: Number(row.detection_count),
        first_detected_at: row.first_detected_at,
        last_detected_at: row.last_detected_at,
        resolved_at: row.resolved_at,
        resolution_reason: row.resolution_reason
      }
    })

    const [open, confirmed, dismissed] = await Promise.all([
      countByStatus('open'),
      countByStatus('confirmed'),
      countByStatus('dismissed')
    ])

    return NextResponse.json({
      success: true,
      status,
      flags,
      counts: { open, confirmed, dismissed }
    })
  } catch (err) {
    console.error('[AdminAbuse] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
