import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  buildAiBoard,
  buildAiToolDomainMap,
  type AiToolTotalsRow
} from '@/lib/aiLeaderboard'
import { createServiceClient } from '@/lib/supabaseServer'

// THE AI LEADERBOARD is the same payload for every viewer (no session,
// no cookies), so unlike the per-viewer global board it caches hard:
// the handler stays force-dynamic (never prerendered at build, where no
// DB should be hit), while the aggregate itself lives in the Data Cache
// for 5 minutes via unstable_cache — one site-wide GROUP BY serves
// every request in the window, whether Cribble has 2 pilots or 100M.
// The s-maxage header adds a CDN layer on top with the same lifetime.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 300

const loadAiBoard = unstable_cache(
  async () => {
    const supabase = createServiceClient()
    const toolMap = buildAiToolDomainMap()

    const [allTimeRes, weekRes] = await Promise.all([
      supabase.rpc('ai_tool_totals', { p_tool_map: toolMap }),
      supabase.rpc('ai_tool_totals', {
        p_tool_map: toolMap,
        p_since: new Date(Date.now() - 7 * 86400_000).toISOString()
      })
    ])

    if (allTimeRes.error) {
      throw new Error(`ai_tool_totals failed: ${allTimeRes.error.message}`)
    }
    // The week window only decorates rows (7D column) — its failure must
    // not sink the board.
    if (weekRes.error) {
      console.warn('[AI Leaderboard] Week window failed:', weekRes.error.message)
    }

    const board = buildAiBoard(
      (allTimeRes.data || []) as AiToolTotalsRow[],
      weekRes.error ? [] : ((weekRes.data || []) as AiToolTotalsRow[])
    )

    return { ...board, generatedAt: new Date().toISOString() }
  },
  ['ai-leaderboard'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  try {
    const { tools, totals, generatedAt } = await loadAiBoard()

    return NextResponse.json(
      {
        success: true,
        data: tools,
        totals,
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
    console.error('[AI Leaderboard] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Failed to load the AI leaderboard' },
      { status: 500 }
    )
  }
}
