import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// The audit log, readable by ALL staff — moderators see the owner's
// entries and each other's, which is the point: every action is visible
// to every other staff member, so quiet abuse has nowhere to live.
// Append-only by construction; there is no write/update/delete API over
// this table anywhere in the app.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const PAGE_SIZE = 50

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'audit.view')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const search = request.nextUrl.searchParams
  const parseId = (key: string): number | null => {
    const raw = search.get(key)
    if (!raw) return null
    const value = Number(raw)
    return Number.isInteger(value) && value > 0 ? value : null
  }
  const targetId = parseId('target')
  const adminId = parseId('admin')
  const before = parseId('before')

  try {
    let query = supabase
      .from('admin_activity_log')
      .select(
        `id, admin_user_id, target_user_id, action, old_values, new_values, reason, created_at,
         admin:users!admin_activity_log_admin_user_id_fkey(twitter_username),
         target:users!admin_activity_log_target_user_id_fkey(twitter_username)`
      )
      .order('id', { ascending: false })
      .limit(PAGE_SIZE)

    if (targetId !== null) query = query.eq('target_user_id', targetId)
    if (adminId !== null) query = query.eq('admin_user_id', adminId)
    if (before !== null) query = query.lt('id', before)

    const { data, error } = await query

    if (error) {
      console.error('[AdminAudit] Query failed:', error)
      return NextResponse.json({ error: 'Failed to load audit log' }, { status: 500 })
    }

    // PostgREST returns the FK-embedded users as single objects (many-to-
    // one), but without generated DB types the client infers arrays —
    // hence the unknown hop.
    const entries = (data || []).map((row) => ({
      id: Number(row.id),
      admin_user_id: row.admin_user_id === null ? null : Number(row.admin_user_id),
      admin_username:
        (row.admin as unknown as { twitter_username: string | null } | null)?.twitter_username ??
        null,
      target_user_id: row.target_user_id === null ? null : Number(row.target_user_id),
      target_username:
        (row.target as unknown as { twitter_username: string | null } | null)?.twitter_username ??
        null,
      action: row.action,
      old_values: row.old_values ?? null,
      new_values: row.new_values ?? null,
      reason: row.reason ?? null,
      created_at: row.created_at
    }))

    return NextResponse.json({
      success: true,
      entries,
      nextCursor: entries.length === PAGE_SIZE ? entries[entries.length - 1]!.id : null
    })
  } catch (err) {
    console.error('[AdminAudit] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
