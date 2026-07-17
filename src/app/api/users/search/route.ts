import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { readAccountIsPrivate } from '@/lib/publicProfile'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'

// Nav user search — the "find a pilot" box. Matches handle and display
// name case-insensitively and returns only what the result row renders:
// identity, score, and the private-account flag (for the lock glyph).
// Private accounts stay discoverable, exactly like X — only their
// profile content is gated, never their existence.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const MAX_QUERY = 40
const MAX_RESULTS = 8

interface SearchUserRow {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
  status: string | null
  metadata: Record<string, unknown> | null
  user_scores: { total_score: number | null } | null
}

const SEARCH_SELECT = `
  id,
  twitter_username,
  twitter_name,
  twitter_profile_image,
  status,
  metadata,
  user_scores(total_score)
`

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const raw = String(request.nextUrl.searchParams.get('q') || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_QUERY)

  if (!raw) {
    return NextResponse.json({ success: true, users: [] })
  }

  // Escape LIKE wildcards so "j_doe" matches literally; two separate
  // single-filter queries sidestep PostgREST or() value quoting.
  const pattern = `%${raw.replace(/([%_\\])/g, '\\$1')}%`

  try {
    const [byUsername, byName] = await Promise.all([
      supabase
        .from('users')
        .select(SEARCH_SELECT)
        .ilike('twitter_username', pattern)
        .limit(12),
      supabase
        .from('users')
        .select(SEARCH_SELECT)
        .ilike('twitter_name', pattern)
        .limit(12)
    ])

    if (byUsername.error && byName.error) {
      console.error('[UserSearch] Query failed:', byUsername.error)
      return NextResponse.json(
        { success: false, error: 'Search failed' },
        { status: 500 }
      )
    }

    const merged = new Map<number, SearchUserRow>()
    for (const res of [byUsername, byName]) {
      for (const row of (res.error ? [] : res.data || []) as unknown as SearchUserRow[]) {
        merged.set(Number(row.id), row)
      }
    }

    const q = raw.toLowerCase()
    // Exact handle → handle prefix → name prefix → substring, then by score.
    const relevance = (row: SearchUserRow): number => {
      const handle = (row.twitter_username || '').toLowerCase()
      const name = (row.twitter_name || '').toLowerCase()
      if (handle === q) return 0
      if (handle.startsWith(q)) return 1
      if (name.startsWith(q)) return 2
      return 3
    }

    const users = Array.from(merged.values())
      // No handle = no /u/ page to open; banned and suspended accounts
      // stay invisible (suspension hides discovery, not the profile).
      .filter((row) => row.twitter_username && row.status !== 'banned' && row.status !== 'suspended')
      .sort((a, b) => {
        const byRelevance = relevance(a) - relevance(b)
        if (byRelevance !== 0) return byRelevance
        const scoreA = Number(a.user_scores?.total_score || 0)
        const scoreB = Number(b.user_scores?.total_score || 0)
        return scoreB - scoreA || Number(a.id) - Number(b.id)
      })
      .slice(0, MAX_RESULTS)
      .map((row) => ({
        userId: Number(row.id),
        username: row.twitter_username as string,
        display_name: row.twitter_name || (row.twitter_username as string),
        profile_image: row.twitter_profile_image || null,
        score: Math.round(Number(row.user_scores?.total_score || 0)),
        isPrivate: readAccountIsPrivate(row.metadata)
      }))

    return NextResponse.json({ success: true, users })
  } catch (err) {
    console.error('[UserSearch] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Unexpected error' },
      { status: 500 }
    )
  }
}
