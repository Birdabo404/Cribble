import { NextRequest, NextResponse } from 'next/server'
import { getEventsIdentityColumn } from '@/lib/eventsIdentity'
import {
  SCORE_POLICY,
  sessionizeEvents,
  type ScoreEventWithTimestamp
} from '@/lib/scoring'
import { fetchActiveSeasonWindow } from '@/lib/seasonServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  ensureUserStatsRollup,
  type UserStatsRollupColumns
} from '@/lib/userStats'

export const dynamic = 'force-dynamic'

const supabase = supabaseAdmin || createServiceClient()

// Precomputed buckets (written by the extension-sync recalculation) are
// only trustworthy while their window still covers last_calculated_at.
// The zeroing below reproduces exactly what a live recomputation would
// return for a user with no events since that write:
//  - today: calculateScoreBuckets buckets "today" as timestamp >= UTC
//    midnight of now, so a row calculated before today's UTC start can
//    only be carrying yesterday's total → 0.
//  - week/month: rolling windows anchored at now (7/30 days). Once
//    last_calculated_at falls out of the window, everything the stored
//    value counted has aged out → 0. (Partial aging inside the window is
//    tolerated, same as the leaderboard render.)
//  - season: the bucket is bounded to [starts_at, ends_at); during
//    intermission the live recompute yields 0, and a row calculated
//    before the season started can only carry a previous season's value.
interface ScoreRow extends UserStatsRollupColumns {
  total_score?: number | null
  today_score?: number | null
  week_score?: number | null
  month_score?: number | null
  season_score?: number | null
  bonus_score?: number | null
  last_calculated_at?: string | null
}

const roundedScore = (value: number | null | undefined) => {
  const n = Math.round(Number(value ?? 0))
  return Number.isFinite(n) ? n : 0
}

interface TodayAggregates {
  visits: number
  activeMs: number
  wallMs: number
}

/**
 * Today-window aggregates for the KPI strip, from ONE bounded events
 * query: only rows since UTC midnight (a handful, served by the
 * user+timestamp index) — never the full history replay this route used
 * to do. The subset is sessionized exactly like the old
 * calculateScoreBuckets "today" bucket (aggregateWindow over events with
 * timestamp >= UTC day start): normalizeLegacyEventValues semantics ride
 * inside sessionizeEvents, so visit rows count one visit and no active
 * time, heartbeats count verified active time, and wallMs is real
 * per-session wall-clock. Null = query failed → caller serves zeros,
 * same degradation as a failed replay before.
 */
async function fetchTodayAggregates(
  userId: number,
  todayStartIso: string
): Promise<TodayAggregates | null> {
  const column = await getEventsIdentityColumn(supabase)
  if (!column) {
    console.warn('[API] /user/me - No compatible events_raw user column found')
    return null
  }

  const { data, error } = await supabase
    .from('events_raw')
    .select('timestamp, domain, visits, active_ms, total_ms')
    .eq(column, userId)
    .gte('timestamp', todayStartIso)
    .order('timestamp', { ascending: true })

  if (error) {
    console.error('[API] /user/me - Today events query failed:', error.message)
    return null
  }

  const sessions = sessionizeEvents((data || []) as ScoreEventWithTimestamp[])
  const aggregates: TodayAggregates = { visits: 0, activeMs: 0, wallMs: 0 }
  for (const session of sessions) {
    aggregates.visits += session.visits
    aggregates.activeMs += session.activeMs
    aggregates.wallMs += session.wallMs
  }
  return aggregates
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const now = new Date()
    const userId = Number(session.userId)

    // Same UTC-midnight boundary calculateScoreBuckets uses for its
    // "today" bucket — it gates both the staleness zeroing below and the
    // today-window events query.
    const todayStartMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )

    // Everything is independent — one parallel wave. The only events_raw
    // touch is the bounded today-window read (rows since UTC midnight);
    // user_scores is read with * so deployments that lag an additive
    // migration (bonus/season/rollup columns) keep working unchanged.
    const [userRes, scoreRes, deviceRes, seasonLookup, rankRes, rankCountRes, todayAgg] =
      await Promise.all([
        supabase
          .from('users')
          // is_admin is deliberately NOT selected: no client code consumes it and
          // admin checks happen server-side (adminAuth), so exposing the flag
          // here would only fingerprint admin accounts. team_review_status IS
          // selected: paired with subscription_tier it tells the client whether
          // this session may use team surfaces (e.g. INVITE TO TEAM on profiles).
          .select(
            'id, twitter_username, twitter_name, twitter_profile_image, created_at, last_login, subscription_tier, team_review_status, user_type, active_device_uuid, last_extension_sync'
          )
          .eq('id', session.userId)
          .single(),
        supabase
          .from('user_scores')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('user_devices')
          .select('*')
          .eq('user_id', session.userId)
          .eq('is_active', true)
          .maybeSingle(),
        fetchActiveSeasonWindow(supabase),
        supabase
          .from('leaderboard_ranks')
          .select('rank')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('leaderboard_ranks')
          .select('user_id', { count: 'exact', head: true }),
        fetchTodayAggregates(userId, new Date(todayStartMs).toISOString())
      ])

    if (userRes.error || !userRes.data) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    const user = userRes.data

    if (scoreRes.error) {
      console.error('[API] /user/me - user_scores read failed:', scoreRes.error.message)
    }
    const scoreRow = (scoreRes.error ? null : scoreRes.data) as ScoreRow | null

    const lastCalcIso = scoreRow?.last_calculated_at
      ? String(scoreRow.last_calculated_at)
      : null
    const lastCalcMs = lastCalcIso ? Date.parse(lastCalcIso) : NaN
    const hasCalc = Number.isFinite(lastCalcMs)

    const todayFresh = hasCalc && lastCalcMs >= todayStartMs
    const weekFresh = hasCalc && now.getTime() - lastCalcMs < 7 * 86400_000
    const monthFresh = hasCalc && now.getTime() - lastCalcMs < 30 * 86400_000
    const seasonFresh =
      seasonLookup.window !== null &&
      hasCalc &&
      lastCalcMs >= seasonLookup.window.startMs

    // total_score already carries the referral bonus: the recalculation
    // writes events-total + bonus_score into the column, so re-adding the
    // bonus here would double-count it.
    const scores = {
      total_score: roundedScore(scoreRow?.total_score),
      today_score: todayFresh ? roundedScore(scoreRow?.today_score) : 0,
      week_score: weekFresh ? roundedScore(scoreRow?.week_score) : 0,
      month_score: monthFresh ? roundedScore(scoreRow?.month_score) : 0,
      season_score: seasonFresh ? roundedScore(scoreRow?.season_score) : 0,
      last_calculated_at: lastCalcIso ?? now.toISOString()
    }

    // Lifetime stats come from the rollup columns (lazy backfill pays one
    // events read for pre-migration rows, then never again); the today_*
    // aggregates come from the bounded today-window query above, so the
    // KPI strip's "+N TODAY" chips stay live.
    const rollup = await ensureUserStatsRollup(
      supabase,
      userId,
      scoreRes.error ? undefined : ((scoreRes.data as ScoreRow | null) ?? null)
    )
    if (rollup === null) {
      console.warn('[API] /user/me - stats rollup unavailable, serving zeros')
    }
    const totalActiveMs = rollup?.totalActiveMs ?? 0
    const totalVisits = (rollup?.topTools ?? []).reduce(
      (sum, tool) => sum + tool.visits,
      0
    )

    // Session aggregates, same semantics as the old full-replay code:
    // active time is verified heartbeat time only, total time is real
    // session wall-clock, and efficiency is today's active/wall ratio.
    const today = todayAgg ?? { visits: 0, activeMs: 0, wallMs: 0 }
    const efficiency =
      today.wallMs > 0
        ? Math.min(100, Math.round((today.activeMs / today.wallMs) * 100))
        : 0

    const stats = {
      total_visits: totalVisits,
      today_visits: today.visits,
      total_time: totalActiveMs,
      today_time: today.wallMs,
      active_time: totalActiveMs,
      today_active_time: today.activeMs,
      efficiency
    }

    // Board standing from the persisted rank snapshots (maintained on the
    // score-write path): position within however many players hold a rank
    // row. Null when this user hasn't been ranked yet.
    const rankPosition =
      !rankRes.error && rankRes.data?.rank != null
        ? Number(rankRes.data.rank)
        : null
    const rankTotal =
      !rankCountRes.error && rankCountRes.count !== null
        ? Number(rankCountRes.count)
        : null
    const rank =
      rankPosition !== null && rankTotal !== null
        ? { position: rankPosition, total: rankTotal }
        : null

    const activeDevice = deviceRes.error ? null : deviceRes.data

    return NextResponse.json({
      user,
      scores,
      stats,
      scoring: {
        version: SCORE_POLICY.version,
        activeMsPerPoint: SCORE_POLICY.activeMsPerPoint,
        visitPoints: SCORE_POLICY.visitPoints
      },
      rank,
      activeDevice: activeDevice
        ? {
            device_uuid: activeDevice.device_uuid,
            device_name: activeDevice.device_name,
            last_sync_at: activeDevice.last_sync_at
          }
        : null
    })
  } catch (error) {
    console.error('Get user API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
