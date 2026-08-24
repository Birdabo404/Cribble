import { NextRequest, NextResponse } from 'next/server'
import { fetchSeasonState } from '@/lib/seasonServer'
import { createServiceClient } from '@/lib/supabaseServer'
import { getAffiliatedTeamsBatch } from '@/lib/teams'
import {
  buildTokenBoard,
  parseTokenBoardWindow,
  resolveTokenBoardWindow,
  type TokenBoard,
  type TokenLeaderboardRpcRow
} from '@/lib/tokenLeaderboard'
import { normalizeIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0'
}

function missingLeaderboardFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883'
}

/**
 * Decorate ranked rows with the Pro check + affiliate logo inputs — one
 * users select and one team_affiliations join for the whole board.
 * Purely additive: ranks come out exactly as buildTokenBoard assigned
 * them, and any failure degrades to null tier/team instead of taking
 * the board down (same contract as getAffiliatedTeamsBatch).
 */
async function hydrateRowIdentity(board: TokenBoard): Promise<void> {
  const userIds = board.rows.map((row) => row.userId)
  if (userIds.length === 0) return

  try {
    const [tiersResult, teamsByUser] = await Promise.all([
      supabase.from('users').select('id, subscription_tier').in('id', userIds),
      getAffiliatedTeamsBatch(supabase, userIds)
    ])

    const tierByUser = new Map<number, string | null>()
    if (tiersResult.error) {
      console.warn('[TokenLeaderboard] Tier hydration failed:', tiersResult.error.message)
    } else {
      for (const row of (tiersResult.data ?? []) as {
        id: number | string
        subscription_tier: string | null
      }[]) {
        tierByUser.set(Number(row.id), row.subscription_tier)
      }
    }

    board.rows = board.rows.map((row) => {
      const team = teamsByUser.get(row.userId)
      return {
        ...row,
        tier: tierByUser.get(row.userId) ?? null,
        team: team
          ? { username: team.username, name: team.name, logo: team.avatar }
          : null
      }
    })
  } catch (error) {
    console.warn('[TokenLeaderboard] Identity hydration failed:', error)
  }
}

export async function GET(request: NextRequest) {
  try {
    const requestedWindow = parseTokenBoardWindow(request.nextUrl.searchParams.get('window'))
    if (!requestedWindow) {
      return NextResponse.json(
        { success: false, error: 'Window must be season, 7d, or all' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    const requestedTimezone = request.nextUrl.searchParams.get('timezone') ?? 'UTC'
    const timezone = normalizeIanaTimeZone(requestedTimezone)
    if (!timezone) {
      return NextResponse.json(
        { success: false, error: 'Timezone must be a valid IANA timezone' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    const season = await fetchSeasonState(supabase)
    const window = resolveTokenBoardWindow(requestedWindow, season, Date.now(), timezone)
    const absoluteSince =
      requestedWindow === 'season' ? season.current?.startsAt ?? null : null
    const absoluteUntil =
      requestedWindow === 'season' ? season.current?.endsAt ?? null : null
    let { data, error } = await supabase.rpc('agent_token_leaderboard', {
      p_since: window.since,
      p_until: window.until,
      p_timezone: timezone,
      p_since_at: absoluteSince,
      p_until_at: absoluteUntil
    })

    // Keep local/preview app changes usable while migration 047 is waiting to
    // deploy. PostgREST resolves functions by their argument names, so the new
    // five-argument call returns PGRST202 against the existing two-argument
    // function. Retry only that known compatibility case; ordinary database
    // failures must still surface instead of being disguised as an empty board.
    if (error && missingLeaderboardFunction(error)) {
      const legacy = await supabase.rpc('agent_token_leaderboard', {
        p_since: window.since,
        p_until: window.until
      })
      data = legacy.data
      error = legacy.error
    }

    if (error) {
      // This keeps a preview deploy readable before the leaderboard
      // function exists. It is not a fake board: the API returns a
      // marked, empty dataset.
      if (missingLeaderboardFunction(error)) {
        const empty = buildTokenBoard([])
        return NextResponse.json(
          {
            success: true,
            ...empty,
            window,
            season,
            schemaReady: false,
            generatedAt: new Date().toISOString()
          },
          { headers: NO_STORE_HEADERS }
        )
      }

      console.error('[TokenLeaderboard] Aggregate failed:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to load the token leaderboard' },
        { status: 500, headers: NO_STORE_HEADERS }
      )
    }

    const board = buildTokenBoard((data ?? []) as TokenLeaderboardRpcRow[])
    await hydrateRowIdentity(board)
    return NextResponse.json(
      {
        success: true,
        ...board,
        window,
        season,
        schemaReady: true,
        generatedAt: new Date().toISOString()
      },
      { headers: NO_STORE_HEADERS }
    )
  } catch (error) {
    console.error('[TokenLeaderboard] GET error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
