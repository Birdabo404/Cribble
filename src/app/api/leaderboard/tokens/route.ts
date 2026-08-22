import { NextRequest, NextResponse } from 'next/server'
import { fetchSeasonState } from '@/lib/seasonServer'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  buildTokenBoard,
  parseTokenBoardWindow,
  resolveTokenBoardWindow,
  type TokenLeaderboardRpcRow
} from '@/lib/tokenLeaderboard'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0'
}

function missingLeaderboardFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883'
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

    const season = await fetchSeasonState(supabase)
    const window = resolveTokenBoardWindow(requestedWindow, season)
    const { data, error } = await supabase.rpc('agent_token_leaderboard', {
      p_since: window.since,
      p_until: window.until
    })

    if (error) {
      // This keeps a preview deploy readable before migration 042 lands.
      // It is not a fake board: the API returns a marked, empty dataset.
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
