import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createServiceClient } from '@/lib/supabaseServer'

// Backup trigger for the season lifecycle. pg_cron (migration 025) runs
// season_tick() every 15 minutes inside the database; this route exists
// for manual/CI triggering when the scheduler needs a nudge. The tick is
// idempotent and takes an advisory lock, so overlapping calls are safe.
//
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" https://…/api/cron/season

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

function secretMatches(supplied: string | null): boolean {
  const expected = env.CRON_SECRET
  if (!expected || !supplied) return false
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  )
}

export async function POST(request: NextRequest) {
  const supplied =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null

  if (!secretMatches(supplied)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data, error } = await supabase.rpc('season_tick')
    if (error) {
      console.error('[SeasonCron] Tick failed:', error)
      return NextResponse.json(
        { success: false, error: 'Season tick failed' },
        { status: 500 }
      )
    }
    return NextResponse.json({ success: true, tick: data })
  } catch (error) {
    console.error('[SeasonCron] POST error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
