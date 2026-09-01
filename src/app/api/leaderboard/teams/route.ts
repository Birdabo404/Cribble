import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { assembleTeamBoard } from '@/lib/teamBoardServer'

// THE TEAMS BOARD is the same payload for every viewer (no session, no
// cookies), so like the AI board it caches hard: the handler stays
// force-dynamic (never prerendered at build, where no DB should be
// hit), while the assembled board lives in the Data Cache for a minute
// via unstable_cache — every roster is embedded, so expanding a row
// never fetches. The s-maxage header adds a CDN layer with the same
// lifetime. The queries + assembly live in teamBoardServer, shared
// with the team dashboard and the public teams directory.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

const loadTeamBoard = unstable_cache(
  async () => {
    const supabase = createServiceClient()
    const { rows, totals, season } = await assembleTeamBoard(supabase)

    return {
      rows,
      totals,
      season,
      generatedAt: new Date().toISOString()
    }
  },
  // v4: rows/members carry burnSource + burnIncludesEstimate (the
  // Cursor house-rate fold) — bumped so cached v3 payloads without the
  // fields never reach the new UI.
  ['team-leaderboard-v4'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  try {
    const { rows, totals, season, generatedAt } = await loadTeamBoard()

    return NextResponse.json(
      {
        success: true,
        data: rows,
        totals,
        season,
        generatedAt,
        serverTime: new Date().toISOString()
      },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`
        }
      }
    )
  } catch (err) {
    console.error('[Team Leaderboard] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Failed to load the team leaderboard' },
      { status: 500 }
    )
  }
}
