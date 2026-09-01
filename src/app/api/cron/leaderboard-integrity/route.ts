import { timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { BOARD_LIMIT } from '@/lib/leaderboardEngine'
import { sweepFraudSignals } from '@/lib/fraudDetectionServer'
import {
  alertLeaderboardIntegrity,
  assessLeaderboardIntegrity,
  leaderboardMonitorError,
  type IntegrityStanding
} from '@/lib/leaderboardIntegrity'
import { sweepFinishedLeaderboardSponsorAds } from '@/lib/leaderboardSponsorServer'
import { createServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

interface CanonicalRow {
  user_id: number | string
  rank: number | string
  score: number | string
}

interface SnapshotRow {
  user_id: number | string
  rank: number | string
  score?: number | string | null
}

function secretMatches(supplied: string | null): boolean {
  const expected =
    process.env.CRON_SECRET ??
    (process.env.NODE_ENV !== 'production' ? 'dev-cron-secret' : null)
  if (!expected || !supplied) return false

  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  )
}

function suppliedSecret(request: NextRequest): string | null {
  return (
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null
  )
}

function normalizeStanding(
  userIdValue: unknown,
  rankValue: unknown,
  scoreValue: unknown,
  source: string
): IntegrityStanding {
  const userId = Number(userIdValue)
  const rank = Number(rankValue)
  const score = Number(scoreValue ?? 0)
  if (
    !Number.isInteger(userId) ||
    userId <= 0 ||
    !Number.isInteger(rank) ||
    rank <= 0 ||
    !Number.isFinite(score)
  ) {
    throw new Error(`${source} returned a malformed standing`)
  }
  return { userId, rank, score }
}

async function loadCanonicalRows(
  supabase: SupabaseClient
): Promise<IntegrityStanding[]> {
  const { data, error } = await supabase.rpc('leaderboard_standings', {
    p_board: 'alltime',
    p_limit: BOARD_LIMIT
  })
  if (error) {
    throw new Error(`Canonical standings failed: ${error.message}`)
  }
  return ((data || []) as unknown as CanonicalRow[]).map((row) =>
    normalizeStanding(row.user_id, row.rank, row.score, 'Canonical ranker')
  )
}

async function loadSnapshotRows(
  supabase: SupabaseClient
): Promise<IntegrityStanding[]> {
  const { data, error } = await supabase
    .from('leaderboard_ranks')
    .select('user_id, rank, score')
    .order('rank', { ascending: true })
  if (error) {
    throw new Error(`Snapshot standings failed: ${error.message}`)
  }
  return ((data || []) as unknown as SnapshotRow[]).map((row) =>
    normalizeStanding(row.user_id, row.rank, row.score, 'Snapshot ledger')
  )
}

async function loadApiRows(
  request: NextRequest,
  cronSecret: string
): Promise<IntegrityStanding[]> {
  const endpoint = new URL('/api/leaderboard', request.url)
  endpoint.searchParams.set('board', 'alltime')
  endpoint.searchParams.set('integrity', '1')

  const response = await fetch(endpoint, {
    headers: { 'x-cron-secret': cronSecret },
    cache: 'no-store'
  })
  if (!response.ok) {
    throw new Error(`Leaderboard API probe returned HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    success?: unknown
    data?: unknown
  }
  if (payload.success !== true || !Array.isArray(payload.data)) {
    throw new Error('Leaderboard API probe returned a malformed payload')
  }

  return payload.data.map((value) => {
    if (!value || typeof value !== 'object') {
      throw new Error('Leaderboard API returned a malformed standing')
    }
    const row = value as Record<string, unknown>
    return normalizeStanding(row.userId, row.rank, row.score, 'Leaderboard API')
  })
}

async function handle(request: NextRequest) {
  const secret = suppliedSecret(request)
  if (!secretMatches(secret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const checkedAt = new Date()

  // Piggybacked daily sponsor sweep (Vercel Hobby caps cron jobs at 2,
  // so finished leaderboard runs archive here rather than on their own
  // schedule; the admin billboard GET also sweeps lazily). Never throws
  // and runs before the integrity check, so an unhealthy leaderboard
  // can't leave finished runs unarchived.
  const sponsorSweep = await sweepFinishedLeaderboardSponsorAds(supabase, checkedAt)

  // Piggybacked fraud sweep (same cron-budget reason). Scans the
  // competitive-board candidate set for leaderboard/token abuse and raises
  // deduped fraud_flags for staff. Never throws, so a detection outage can
  // neither block the integrity check nor 500 the cron.
  const fraudSweep = await sweepFraudSignals(supabase, { now: checkedAt })

  try {
    const [apiRows, canonicalRows, snapshotRows] = await Promise.all([
      loadApiRows(request, secret!),
      loadCanonicalRows(supabase),
      loadSnapshotRows(supabase)
    ])
    let report = assessLeaderboardIntegrity(apiRows, canonicalRows, snapshotRows)

    // A score can commit between the independent API and monitor reads.
    // Confirm a top mismatch once with two fresh reads before alerting;
    // duplicate-rank findings do not need a retry.
    if (report.issues.some((issue) => issue.code === 'top_mismatch')) {
      const [retriedApiRows, retriedCanonicalRows] = await Promise.all([
        loadApiRows(request, secret!),
        loadCanonicalRows(supabase)
      ])
      report = assessLeaderboardIntegrity(retriedApiRows, retriedCanonicalRows, snapshotRows)
    }

    if (!report.healthy) {
      console.error('[LeaderboardIntegrity] Check failed:', JSON.stringify(report))
      await alertLeaderboardIntegrity(supabase, report, checkedAt)
      return NextResponse.json(
        { success: false, checkedAt: checkedAt.toISOString(), ...report },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      checkedAt: checkedAt.toISOString(),
      healthy: true,
      playersChecked: apiRows.length,
      sponsorSweep,
      fraudSweep
    })
  } catch (error) {
    const report = leaderboardMonitorError(error)
    console.error('[LeaderboardIntegrity] Monitor failed:', error)
    await alertLeaderboardIntegrity(supabase, report, checkedAt)
    return NextResponse.json(
      { success: false, checkedAt: checkedAt.toISOString(), ...report },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
