import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { fetchCursorProfile } from '@/lib/cursorProfile'
import {
  cursorProfileSnapshotColumns,
  recordCursorProfileSyncFailure,
  upsertCursorProfileDaily
} from '@/lib/cursorProfileServer'
import { createServiceClient } from '@/lib/supabaseServer'

// Re-scrapes every linked cursor.com profile: refreshes the headline
// stats and upserts the rolling daily series into cursor_profile_daily
// so history accumulates beyond cursor.com's ~30-day window.
//
// Vercel cron (vercel.json) invokes GET every 6 hours and sends
// Authorization: Bearer $CRON_SECRET automatically. POST exists for
// manual runs:
//
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//     "https://…/api/cron/cursor-profile-sync"
//
// Profiles are fetched sequentially with a small delay — polite to
// cursor.com. One profile failing (gone, private, reshaped page)
// records its own last_sync_status and never aborts the run; the
// leaderboard RPC stops ranking non-ok rows on its own. When the queue
// outgrows the function budget the run stops CLEANLY before the
// platform kills it, and because profiles are ordered stalest-first
// (last_synced_at ASC NULLS FIRST) the unfinished tail is first in
// line next run instead of starving forever.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const supabase = createServiceClient()

const DELAY_BETWEEN_PROFILES_MS = 300
// Stop dispatching new scrapes once fewer than ~20s of the maxDuration
// remain: a worst-case fetch (15s timeout) plus its writes must still
// land inside the budget, or the function dies mid-run reporting
// nothing.
const RUN_BUDGET_MS = maxDuration * 1000 - 20_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function secretMatches(supplied: string | null): boolean {
  // Read at request time so Next's page-data collection and every
  // build/boot do not hard-require CRON_SECRET. An absent secret keeps
  // the endpoint locked (401), never a build failure.
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

interface LinkedProfileRow {
  user_id: number | string
  cursor_username: string
}

async function syncProfile(userId: number, cursorUsername: string): Promise<boolean> {
  const result = await fetchCursorProfile(cursorUsername)
  const now = new Date().toISOString()

  switch (result.status) {
    case 'ok': {
      const { error: profileError } = await supabase
        .from('cursor_profiles')
        .update(cursorProfileSnapshotColumns(result.profile, now))
        .eq('user_id', userId)
      if (profileError) {
        console.error(
          `[CursorProfileSync] Profile update failed for @${cursorUsername}:`,
          profileError.message
        )
        return false
      }

      const dailyError = await upsertCursorProfileDaily(supabase, userId, result.profile, now)
      if (dailyError) {
        console.error(
          `[CursorProfileSync] Daily upsert failed for @${cursorUsername}:`,
          dailyError
        )
        return false
      }
      return true
    }
    case 'not_found':
    case 'private':
    case 'parse_error':
    case 'fetch_error': {
      const message =
        result.status === 'parse_error' || result.status === 'fetch_error'
          ? result.message
          : null
      const recordError = await recordCursorProfileSyncFailure(
        supabase,
        userId,
        result.status,
        message,
        now
      )
      if (recordError) {
        console.error(
          `[CursorProfileSync] Failure record failed for @${cursorUsername}:`,
          recordError
        )
      }
      console.warn(
        `[CursorProfileSync] @${cursorUsername}: ${result.status}${message ? ` (${message})` : ''}`
      )
      return false
    }
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

async function handle(request: NextRequest) {
  const supplied =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null

  if (!secretMatches(supplied)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  try {
    // Stalest first: never-synced profiles lead, then oldest
    // last_synced_at — so a budget-stopped run rotates the tail
    // forward instead of re-scraping the same head every 6 hours.
    const { data, error } = await supabase
      .from('cursor_profiles')
      .select('user_id, cursor_username')
      .order('last_synced_at', { ascending: true, nullsFirst: true })

    if (error) {
      console.error('[CursorProfileSync] Profile list read failed:', error.message)
      return NextResponse.json(
        { success: false, error: 'Failed to list linked profiles' },
        { status: 500 }
      )
    }

    const profiles = (data ?? []) as LinkedProfileRow[]
    let synced = 0
    let failed = 0
    let skipped = 0

    for (let index = 0; index < profiles.length; index++) {
      if (Date.now() - startedAt >= RUN_BUDGET_MS) {
        skipped = profiles.length - index
        console.warn(
          `[CursorProfileSync] Budget reached after ${index} profiles — skipping ${skipped}`
        )
        break
      }
      if (index > 0) await sleep(DELAY_BETWEEN_PROFILES_MS)
      const profile = profiles[index]
      try {
        const ok = await syncProfile(Number(profile.user_id), profile.cursor_username)
        if (ok) synced++
        else failed++
      } catch (error) {
        // Belt and braces: syncProfile maps expected failures itself, so
        // this only catches surprises — which must not end the run.
        failed++
        console.error(
          `[CursorProfileSync] Unexpected error for @${profile.cursor_username}:`,
          error
        )
      }
    }

    console.log(
      `[CursorProfileSync] ${profiles.length} profiles: ${synced} synced, ${failed} failed, ${skipped} skipped`
    )
    return NextResponse.json({ success: true, synced, failed, skipped })
  } catch (error) {
    console.error('[CursorProfileSync] Run failed:', error)
    return NextResponse.json(
      { success: false, error: 'Cursor profile sync failed' },
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
