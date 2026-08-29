import { NextRequest, NextResponse } from 'next/server'
import {
  buildCursorBoard,
  type CursorBoard,
  type CursorLeaderboardRpcRow
} from '@/lib/cursorProfileBoard'
import { fetchSeasonState } from '@/lib/seasonServer'
import { createServiceClient } from '@/lib/supabaseServer'
import { getAffiliatedTeamsBatch } from '@/lib/teams'
import { parseTokenBoardWindow, resolveTokenBoardWindow } from '@/lib/tokenLeaderboard'
import { normalizeIanaTimeZone } from '@/lib/timeZone'

// Public CURSOR source of THE BURN board: opted-in users ranked by the
// window token sums of their scraped cursor.com profile history.
// Window semantics (?window=season|7d|all&timezone=…) are the token
// board's, resolved by the same helpers.

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
 * users select and one team_affiliations join for the whole board, the
 * same additive contract as the token board's hydrateRowIdentity: ranks
 * stay exactly as buildCursorBoard assigned them and any failure
 * degrades to null tier/team instead of taking the board down.
 */
async function hydrateRowIdentity(board: CursorBoard): Promise<void> {
  const userIds = board.rows.map((row) => row.userId)
  if (userIds.length === 0) return

  try {
    const [tiersResult, teamsByUser] = await Promise.all([
      supabase.from('users').select('id, subscription_tier').in('id', userIds),
      getAffiliatedTeamsBatch(supabase, userIds)
    ])

    const tierByUser = new Map<number, string | null>()
    if (tiersResult.error) {
      console.warn('[CursorBoard] Tier hydration failed:', tiersResult.error.message)
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
    console.warn('[CursorBoard] Identity hydration failed:', error)
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

    const { data, error } = await supabase.rpc('cursor_profile_leaderboard', {
      p_start: window.since,
      p_end: window.until
    })

    if (error) {
      // Keeps a preview deploy readable before migration 062 lands: a
      // marked, empty dataset — not a fake board.
      if (missingLeaderboardFunction(error)) {
        const empty = buildCursorBoard([])
        return NextResponse.json(
          {
            success: true,
            ...empty,
            window,
            schemaReady: false,
            generatedAt: new Date().toISOString()
          },
          { headers: NO_STORE_HEADERS }
        )
      }

      console.error('[CursorBoard] Aggregate failed:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to load the cursor leaderboard' },
        { status: 500, headers: NO_STORE_HEADERS }
      )
    }

    const board = buildCursorBoard((data ?? []) as CursorLeaderboardRpcRow[])
    await hydrateRowIdentity(board)
    return NextResponse.json(
      {
        success: true,
        ...board,
        window,
        schemaReady: true,
        generatedAt: new Date().toISOString()
      },
      { headers: NO_STORE_HEADERS }
    )
  } catch (error) {
    console.error('[CursorBoard] GET error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
