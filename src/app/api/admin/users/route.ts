import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser, resolveStaffRole } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Staff user search. Unlike the public /api/users/search this one shows
// EVERYONE — banned and suspended accounts included, since those are
// exactly who moderators need to find — plus the moderation columns
// (status, tier, staff role). A purely numeric query also matches on
// user id, so audit-log entries can be chased down directly.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const MAX_QUERY = 40
const MAX_RESULTS = 20

interface AdminSearchRow {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
  status: string | null
  subscription_tier: string | null
  staff_role: string | null
  is_admin: boolean | null
  created_at: string | null
  last_login: string | null
}

const SEARCH_SELECT =
  'id, twitter_username, twitter_name, twitter_profile_image, status, subscription_tier, staff_role, is_admin, created_at, last_login'

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'user.view')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const raw = String(request.nextUrl.searchParams.get('q') || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_QUERY)

  if (!raw) {
    return NextResponse.json({ success: true, users: [] })
  }

  const pattern = `%${raw.replace(/([%_\\])/g, '\\$1')}%`
  const numericId = /^\d{1,10}$/.test(raw) ? Number(raw) : null

  try {
    const [byUsername, byName, byId] = await Promise.all([
      supabase.from('users').select(SEARCH_SELECT).ilike('twitter_username', pattern).limit(MAX_RESULTS),
      supabase.from('users').select(SEARCH_SELECT).ilike('twitter_name', pattern).limit(MAX_RESULTS),
      numericId !== null
        ? supabase.from('users').select(SEARCH_SELECT).eq('id', numericId).limit(1)
        : Promise.resolve({ data: [], error: null })
    ])

    if (byUsername.error && byName.error) {
      console.error('[AdminUserSearch] Query failed:', byUsername.error)
      return NextResponse.json({ error: 'Search failed' }, { status: 500 })
    }

    const merged = new Map<number, AdminSearchRow>()
    for (const res of [byId, byUsername, byName]) {
      for (const row of (res.error ? [] : res.data || []) as unknown as AdminSearchRow[]) {
        merged.set(Number(row.id), row)
      }
    }

    const q = raw.toLowerCase()
    const relevance = (row: AdminSearchRow): number => {
      if (numericId !== null && Number(row.id) === numericId) return 0
      const handle = (row.twitter_username || '').toLowerCase()
      const name = (row.twitter_name || '').toLowerCase()
      if (handle === q) return 1
      if (handle.startsWith(q)) return 2
      if (name.startsWith(q)) return 3
      return 4
    }

    const users = Array.from(merged.values())
      .sort((a, b) => relevance(a) - relevance(b) || Number(a.id) - Number(b.id))
      .slice(0, MAX_RESULTS)
      .map((row) => ({
        userId: Number(row.id),
        username: row.twitter_username,
        display_name: row.twitter_name || row.twitter_username || `User${row.id}`,
        profile_image: row.twitter_profile_image || null,
        status: row.status || 'active',
        tier: (row.subscription_tier || 'FREE').toUpperCase(),
        staff_role: resolveStaffRole(row),
        created_at: row.created_at,
        last_login: row.last_login
      }))

    return NextResponse.json({ success: true, users })
  } catch (err) {
    console.error('[AdminUserSearch] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
