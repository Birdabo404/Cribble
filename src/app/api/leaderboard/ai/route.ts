import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  assembleAiBoards,
  buildAiToolDomainMap,
  type AgentBurnRpcRow,
  type AiToolTotalsRow
} from '@/lib/aiLeaderboard'
import { fetchSeasonState } from '@/lib/seasonServer'
import { createServiceClient } from '@/lib/supabaseServer'

// THE AI LEADERBOARD is the same payload for every viewer (no session,
// no cookies), so unlike the per-viewer global board it caches hard:
// the handler stays force-dynamic (never prerendered at build, where no
// DB should be hit), while the aggregate itself lives in the Data Cache
// for 5 minutes via unstable_cache — one set of site-wide GROUP BYs
// serves every request in the window, whether Cribble has 2 pilots or
// 100M. The s-maxage header adds a CDN layer on top with the same
// lifetime. The payload carries BOTH ranking windows (current season +
// all-time) so the client toggles locally without refetching.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 300

// Migration 048 may not be deployed yet — PostgREST answers PGRST202
// (or Postgres 42883) for the unknown function. Burn is display-only,
// so that case (and any other burn failure) degrades to no burn rows.
function missingBurnFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883'
}

const loadAiBoard = unstable_cache(
  async () => {
    const supabase = createServiceClient()
    const toolMap = buildAiToolDomainMap()

    // The calendar decides whether a SEASON window is rankable at all:
    // ai_tool_totals has no upper bound, so only a live season (now is
    // the implicit end) can be windowed. Intermission or no calendar →
    // no season board, ALL-TIME fronts the page.
    const seasonState = await fetchSeasonState(supabase)
    const seasonRankable =
      seasonState.phase === 'active' && seasonState.current !== null

    const noRows = Promise.resolve({ data: null, error: null })
    const [allTimeRes, weekRes, seasonRes, allTimeBurnRes, seasonBurnRes] =
      await Promise.all([
        supabase.rpc('ai_tool_totals', { p_tool_map: toolMap }),
        supabase.rpc('ai_tool_totals', {
          p_tool_map: toolMap,
          p_since: new Date(Date.now() - 7 * 86400_000).toISOString()
        }),
        seasonRankable
          ? supabase.rpc('ai_tool_totals', {
              p_tool_map: toolMap,
              p_since: seasonState.current!.startsAt
            })
          : noRows,
        supabase.rpc('agent_burn_by_agent', { p_since_at: null }),
        seasonRankable
          ? supabase.rpc('agent_burn_by_agent', {
              p_since_at: seasonState.current!.startsAt
            })
          : noRows
      ])

    if (allTimeRes.error) {
      throw new Error(`ai_tool_totals failed: ${allTimeRes.error.message}`)
    }
    // The week window only decorates rows (7D column) — its failure must
    // not sink the board.
    if (weekRes.error) {
      console.warn('[AI Leaderboard] Week window failed:', weekRes.error.message)
    }
    // A failed season window hides the SEASON pill instead of erroring:
    // the all-time board is always servable.
    if (seasonRes.error) {
      console.warn('[AI Leaderboard] Season window failed:', seasonRes.error.message)
    }
    // Burn is a display-only column: a missing migration 048 (or any
    // other failure) means empty burn maps, never a dead board.
    for (const burnRes of [allTimeBurnRes, seasonBurnRes]) {
      if (!burnRes.error) continue
      if (missingBurnFunction(burnRes.error)) {
        console.warn('[AI Leaderboard] Burn RPC not deployed yet:', burnRes.error.message)
      } else {
        console.warn('[AI Leaderboard] Burn aggregate failed:', burnRes.error.message)
      }
    }

    const boards = assembleAiBoards({
      seasonState,
      allTimeRows: (allTimeRes.data || []) as AiToolTotalsRow[],
      weekRows: weekRes.error ? [] : ((weekRes.data || []) as AiToolTotalsRow[]),
      seasonRows:
        seasonRankable && !seasonRes.error
          ? ((seasonRes.data || []) as AiToolTotalsRow[])
          : null,
      allTimeBurnRows: allTimeBurnRes.error
        ? []
        : ((allTimeBurnRes.data || []) as AgentBurnRpcRow[]),
      seasonBurnRows: seasonBurnRes.error
        ? []
        : ((seasonBurnRes.data || []) as AgentBurnRpcRow[])
    })

    return { boards, season: seasonState, generatedAt: new Date().toISOString() }
  },
  // v2: the payload shape changed (embedded season/all-time boards) —
  // a fresh key prevents serving a stale single-board cache entry.
  ['ai-leaderboard-v2'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  try {
    const { boards, season, generatedAt } = await loadAiBoard()

    return NextResponse.json(
      {
        success: true,
        boards,
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
    console.error('[AI Leaderboard] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Failed to load the AI leaderboard' },
      { status: 500 }
    )
  }
}
