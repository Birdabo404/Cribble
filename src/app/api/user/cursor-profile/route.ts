import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fetchCursorProfile, normalizeCursorUsername } from '@/lib/cursorProfile'
import { cleanCursorTopModels } from '@/lib/cursorProfileBoard'
import {
  cursorProfileSnapshotColumns,
  upsertCursorProfileDaily
} from '@/lib/cursorProfileServer'
import {
  checkDistributedRateLimit,
  checkRateLimit,
  createRateLimitResponse,
  rateLimitConfigs
} from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { addExactIntegers, exactInteger } from '@/lib/tokenLeaderboard'
import { addCalendarDays, calendarDateInTimeZone } from '@/lib/timeZone'

// Link a Cribble account to a public cursor.com profile — the no-CLI path
// onto THE BURN board (CURSOR source). Claiming is trust-based: any
// logged-in user may take an unclaimed public handle, one per account.
//
//   GET    -> link status + latest scraped stats (the settings section)
//   POST   -> claim {username}: live-fetch, must be PUBLIC, upsert
//             profile + daily history
//   PATCH  -> toggle {boardEnabled} without unlinking
//   DELETE -> unlink and erase the accumulated daily history

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0'
}

const claimSchema = z.object({ username: z.string().min(1).max(80) }).strict()
const toggleSchema = z.object({ boardEnabled: z.boolean() }).strict()

const PROFILE_COLUMNS =
  'cursor_username, display_name, avatar_url, board_enabled, last_synced_at, ' +
  'last_sync_status, current_streak, longest_streak, agents_local, agents_cloud, ' +
  'longest_agent_seconds, top_models'

interface CursorProfileDbRow {
  cursor_username: string
  display_name: string | null
  avatar_url: string | null
  board_enabled: boolean
  last_synced_at: string | null
  last_sync_status: string | null
  current_streak: number | null
  longest_streak: number | null
  agents_local: number | null
  agents_cloud: number | null
  longest_agent_seconds: number | null
  top_models: unknown
}

type LinkedStateResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false }

function count(value: number | null): number {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value)) : 0
}

/**
 * The one response body GET/POST/PATCH all return, so the settings UI
 * consumes a single shape: { linked:false } or { linked:true, profile }.
 * tokens30d is summed from the accumulated daily table (last 30 UTC
 * days), not from the profile row — it is the same figure cursor.com's
 * own rolling window shows.
 */
async function loadLinkedState(userId: number): Promise<LinkedStateResult> {
  const { data, error } = await supabase
    .from('cursor_profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[CursorProfile] Status read failed:', error.message)
    return { ok: false }
  }
  if (!data) {
    return { ok: true, body: { success: true, linked: false } }
  }
  const row = data as unknown as CursorProfileDbRow

  const since = addCalendarDays(calendarDateInTimeZone(Date.now(), 'UTC'), -29)
  const { data: dailyRows, error: dailyError } = await supabase
    .from('cursor_profile_daily')
    .select('tokens')
    .eq('user_id', userId)
    .gte('day', since)

  if (dailyError) {
    console.error('[CursorProfile] Daily read failed:', dailyError.message)
    return { ok: false }
  }
  const tokens30d = ((dailyRows ?? []) as { tokens: number | string | null }[]).reduce(
    (sum, daily) => addExactIntegers(sum, exactInteger(String(daily.tokens ?? '0'))),
    '0'
  )

  return {
    ok: true,
    body: {
      success: true,
      linked: true,
      profile: {
        cursorUsername: row.cursor_username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        boardEnabled: row.board_enabled === true,
        lastSyncedAt: row.last_synced_at,
        lastSyncStatus: row.last_sync_status,
        stats: {
          tokens30d,
          agentsLocal: count(row.agents_local),
          agentsCloud: count(row.agents_cloud),
          currentStreak: count(row.current_streak),
          longestStreak: count(row.longest_streak),
          longestAgentSeconds: count(row.longest_agent_seconds),
          topModels: cleanCursorTopModels(row.top_models)
        }
      }
    }
  }
}

function failure(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: NO_STORE_HEADERS }
  )
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) return failure(session.error, session.status)

    const state = await loadLinkedState(session.userId)
    if (!state.ok) return failure('Failed to load cursor profile status', 500)
    return NextResponse.json(state.body, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[CursorProfile] GET error:', error)
    return failure('Internal server error', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Process-local prefilter on the general allowance — cheap first
    // line against anonymous floods before the session read.
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) return failure(session.error, session.status)

    // The durable budget: cross-instance, per-account. Every allowed
    // claim live-fetches cursor.com, and the in-memory prefilter above
    // resets on every cold serverless instance — keep retries
    // human-paced no matter how wide the fan-out.
    const distributedLimit = await checkDistributedRateLimit(
      request,
      rateLimitConfigs.auth,
      `cursor-profile-claim:${session.userId}`
    )
    if (!distributedLimit.success) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(distributedLimit) }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure('Invalid JSON body', 400)
    }
    const parsed = claimSchema.safeParse(body)
    if (!parsed.success) return failure('Invalid payload', 400)

    const username = normalizeCursorUsername(parsed.data.username)
    if (!username) {
      return failure('That does not look like a cursor.com username', 400)
    }

    // Trust-based claim: first come, first served.
    const { data: claimant, error: claimError } = await supabase
      .from('cursor_profiles')
      .select('user_id')
      .eq('cursor_username', username)
      .maybeSingle()
    if (claimError) {
      console.error('[CursorProfile] Claim lookup failed:', claimError.message)
      return failure('Failed to claim cursor profile', 500)
    }
    if (claimant && Number(claimant.user_id) !== session.userId) {
      return failure(`@${username} is already claimed by another Cribble account`, 409)
    }

    const result = await fetchCursorProfile(username)
    switch (result.status) {
      case 'ok':
        break
      case 'not_found':
        // cursor.com streams the same soft 404 for a handle that does
        // not exist and a profile that is not public — cover both.
        return failure(
          `No public cursor.com profile found for @${username}. Check the handle, and make sure the profile is set to public on cursor.com.`,
          404
        )
      case 'private':
        return failure(
          'That cursor.com profile is not public. Set it to public on cursor.com and try again.',
          400
        )
      case 'parse_error':
      case 'fetch_error':
        console.error(`[CursorProfile] Claim fetch failed for @${username}:`, result.message)
        return failure('Could not read the cursor.com profile page. Try again later.', 502)
      default: {
        const exhaustive: never = result
        return exhaustive
      }
    }

    // Switching handles starts a fresh history — the accumulated daily
    // rows belong to the previously linked profile, not this one. Read
    // the current link now; the delete itself must wait until the
    // upsert below has actually won the claim.
    const { data: existing, error: existingError } = await supabase
      .from('cursor_profiles')
      .select('cursor_username')
      .eq('user_id', session.userId)
      .maybeSingle()
    if (existingError) {
      console.error('[CursorProfile] Existing link read failed:', existingError.message)
      return failure('Failed to claim cursor profile', 500)
    }

    const now = new Date().toISOString()
    // board_enabled rides the column default on first claim and keeps
    // the user's existing toggle on a re-claim.
    const { error: upsertError } = await supabase.from('cursor_profiles').upsert(
      {
        user_id: session.userId,
        cursor_username: username,
        ...cursorProfileSnapshotColumns(result.profile, now)
      },
      { onConflict: 'user_id' }
    )
    if (upsertError) {
      // Unique-violation: someone else won the claim between our lookup
      // and this write. The user stays linked to their OLD handle, so
      // the old handle's history must survive — which is why the
      // handle-switch reset below runs only after this write succeeds.
      if (upsertError.code === '23505') {
        return failure(`@${username} is already claimed by another Cribble account`, 409)
      }
      console.error('[CursorProfile] Claim upsert failed:', upsertError.message)
      return failure('Failed to claim cursor profile', 500)
    }

    // The claim is durably ours: drop the old handle's history before
    // writing the new handle's first daily rows below.
    if (existing && existing.cursor_username !== username) {
      const { error: resetError } = await supabase
        .from('cursor_profile_daily')
        .delete()
        .eq('user_id', session.userId)
      if (resetError) {
        console.error('[CursorProfile] History reset failed:', resetError.message)
        return failure('Failed to claim cursor profile', 500)
      }
    }

    const dailyError = await upsertCursorProfileDaily(supabase, session.userId, result.profile, now)
    if (dailyError) {
      console.error('[CursorProfile] Daily upsert failed:', dailyError)
      return failure('Failed to store cursor profile history', 500)
    }

    const state = await loadLinkedState(session.userId)
    if (!state.ok) return failure('Failed to load cursor profile status', 500)
    return NextResponse.json(state.body, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[CursorProfile] POST error:', error)
    return failure('Internal server error', 500)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) return failure(session.error, session.status)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure('Invalid JSON body', 400)
    }
    const parsed = toggleSchema.safeParse(body)
    if (!parsed.success) return failure('Invalid payload', 400)

    const { data, error } = await supabase
      .from('cursor_profiles')
      .update({
        board_enabled: parsed.data.boardEnabled,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', session.userId)
      .select('user_id')
      .maybeSingle()
    if (error) {
      console.error('[CursorProfile] Toggle failed:', error.message)
      return failure('Failed to update cursor profile', 500)
    }
    if (!data) return failure('No cursor.com profile linked', 404)

    const state = await loadLinkedState(session.userId)
    if (!state.ok) return failure('Failed to load cursor profile status', 500)
    return NextResponse.json(state.body, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[CursorProfile] PATCH error:', error)
    return failure('Internal server error', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) return failure(session.error, session.status)

    // Unlink erases the accumulated history too: it was scraped for this
    // link, and keeping it would leak into a future claim's windows.
    const { error: dailyError } = await supabase
      .from('cursor_profile_daily')
      .delete()
      .eq('user_id', session.userId)
    if (dailyError) {
      console.error('[CursorProfile] History delete failed:', dailyError.message)
      return failure('Failed to unlink cursor profile', 500)
    }

    const { error } = await supabase
      .from('cursor_profiles')
      .delete()
      .eq('user_id', session.userId)
    if (error) {
      console.error('[CursorProfile] Unlink failed:', error.message)
      return failure('Failed to unlink cursor profile', 500)
    }

    return NextResponse.json(
      { success: true, linked: false },
      { headers: NO_STORE_HEADERS }
    )
  } catch (error) {
    console.error('[CursorProfile] DELETE error:', error)
    return failure('Internal server error', 500)
  }
}
