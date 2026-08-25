import { NextResponse } from 'next/server'
import {
  LEADERBOARD_SPONSOR_OPENING_CENTS,
  leaderboardMinTargetCents,
  type LeaderboardSponsorBoard
} from '@/lib/leaderboardSponsor'
import { loadSponsorBoard } from '@/lib/leaderboardSponsorServer'
import { createServiceClient } from '@/lib/supabaseServer'

// GET /api/billboard/leaderboard — the public sponsor board
// (migration 055): every APPROVED 'leaderboard' creative with active
// (non-refunded, non-expired) contributions, ranked by total with
// earlier first payment breaking ties, plus the current #1 and the
// fresh minimum target that takes it. Viewer-agnostic — the signed-in
// owner's view lives at /api/billboard/leaderboard/mine. Cards must
// link through GET /api/billboard/[id]/click, never to link_url.
//
// The payload is derived per request against the server clock (the
// rolling 24h window makes it time-dependent), with a short CDN layer
// so the ~15s polling of every leaderboard visitor collapses to a few
// origin hits — a rank change after a payment shows within seconds
// either way.

export const dynamic = 'force-dynamic'

const CACHE_SECONDS = 10

const supabase = createServiceClient()

export async function GET() {
  try {
    const now = new Date()
    const board = await loadSponsorBoard(supabase, now)
    const top = board[0] ?? null

    const payload: LeaderboardSponsorBoard = {
      board,
      top,
      minTargetCents: leaderboardMinTargetCents(top?.activeCents ?? 0),
      openingCents: LEADERBOARD_SPONSOR_OPENING_CENTS,
      serverTime: now.toISOString()
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`
      }
    })
  } catch (error) {
    console.error('[LeaderboardSponsorBoard] GET error:', error)
    return NextResponse.json({ error: 'Failed to load the sponsor board' }, { status: 500 })
  }
}
