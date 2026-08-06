import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  isValidRollupDate,
  previousUtcDate,
  runInsightsRollup
} from '@/lib/insightsRollup'

// Nightly insights rollup: sessionizes the previous UTC day of events_raw
// into usage_sessions and daily_tool_aggregates (see src/lib/insightsRollup).
// Runs in the app (not pg_cron) because the sessionization must be the same
// TypeScript sessionizeEvents the score policy uses.
//
// Vercel cron (vercel.json) invokes GET daily at 00:30 UTC and sends
// Authorization: Bearer $CRON_SECRET automatically. POST exists for manual
// runs and backfills; both accept ?date=YYYY-MM-DD:
//
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//     "https://…/api/cron/insights-rollup?date=2026-08-03"
//
// Idempotent per date: the day's derived rows are deleted and rewritten, so
// overlapping or repeated runs converge to the same state.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

function secretMatches(supplied: string | null): boolean {
  // Read at request time so Next's page-data collection and every build/boot
  // do not hard-require CRON_SECRET. An absent secret keeps the endpoint
  // locked (401), never a build failure.
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

async function handle(request: NextRequest) {
  const supplied =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null

  if (!secretMatches(supplied)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const dateParam = request.nextUrl.searchParams.get('date')
  if (dateParam !== null && !isValidRollupDate(dateParam)) {
    return NextResponse.json(
      { success: false, error: 'Invalid date — expected YYYY-MM-DD' },
      { status: 400 }
    )
  }
  const date = dateParam ?? previousUtcDate()

  try {
    const result = await runInsightsRollup(supabase, date)
    console.log(
      `[InsightsRollup] ${result.date}: ${result.usersProcessed} users, ` +
      `${result.sessionsWritten} sessions, ${result.aggregateRowsWritten} aggregate rows, ` +
      `${result.optedOutUsersExcluded} opted out`
    )
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[InsightsRollup] Rollup failed:', error)
    return NextResponse.json(
      { success: false, error: 'Insights rollup failed' },
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
