import { NextRequest, NextResponse } from 'next/server'
import { fetchAllEventPages } from '@/lib/eventsFetch'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Aggregate usage trends for the admin panel — readable by ALL staff.
//
// ============================ ADMIN-ONLY ============================
// This endpoint serves aggregate rows with NO cohort floor: a single
// (date, domain, country, role) slice in daily_tool_aggregates can
// describe one user. Any FUTURE PUBLIC surface built on this data must
// enforce a minimum cohort floor of k >= 50 distinct users per slice at
// read time before exposing any row — do not relax the staff gate here;
// build a separate endpoint with the floor baked in.
// ====================================================================
//
// Reads ONLY the pre-aggregated tables (daily_tool_aggregates and
// model_releases), never events_raw or usage_sessions, so no per-user
// row ever crosses this boundary. The country/role slices are folded
// away server-side: the panel charts per-day per-tool totals plus
// window-level session-depth stats.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const DAY_MS = 86_400_000
const DEFAULT_DAYS = 90
const MIN_DAYS = 7
const MAX_DAYS = 365

// The chart plots ~8 tools; ship a couple dozen so the page can re-rank
// without an API change while the payload stays bounded (each entry
// carries a number per day of the window).
const SERIES_LIMIT = 24

interface AggregateRow {
  date: string
  domain: string
  vendor: string
  category: string
  distinct_users: number
  total_active_ms: number
  total_visits: number
  session_count: number
  median_session_ms: number | null
  median_focus_ratio: number | null
}

interface ReleaseRow {
  vendor: string
  product: string
  release_date: string
  notes: string | null
}

interface WeightedSample {
  value: number
  weight: number
}

interface ToolAccumulator {
  domain: string
  vendor: string
  category: string
  activeMsByDay: number[]
  usersByDay: number[]
  activeMs: number
  sessions: number
  visits: number
  sessionSamples: WeightedSample[]
  focusSamples: WeightedSample[]
}

function clampDays(raw: string | null): number {
  const value = Number(raw)
  if (!Number.isInteger(value)) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, value))
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// Weight-accumulating median over (value, weight) pairs. Applied to the
// daily per-slice medians with session_count as the weight, this is an
// APPROXIMATION of the true window median — computing the real one would
// need per-session rows, which this endpoint deliberately never reads.
// The response fields are named medianSessionMs/medianFocusRatio with
// that caveat documented here and in the page footer.
function weightedMedian(samples: WeightedSample[]): number | null {
  const usable = samples.filter((s) => Number.isFinite(s.value) && s.weight > 0)
  if (usable.length === 0) return null
  usable.sort((a, b) => a.value - b.value)
  const half = usable.reduce((sum, s) => sum + s.weight, 0) / 2
  let cumulative = 0
  for (const sample of usable) {
    cumulative += sample.weight
    if (cumulative >= half) return sample.value
  }
  return usable[usable.length - 1].value
}

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  // No action arg: read-only aggregates are open to every staff role.
  const staff = await getStaffUser(request)
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const days = clampDays(request.nextUrl.searchParams.get('days'))

  // Window: the last `days` COMPLETE UTC days, ending yesterday — the
  // nightly rollup covers through the previous day, so a today column
  // would always render as a misleading dip to zero.
  const todayStartMs = Math.floor(Date.now() / DAY_MS) * DAY_MS
  const startMs = todayStartMs - days * DAY_MS
  const endMs = todayStartMs - DAY_MS
  const start = isoDay(startMs)
  const end = isoDay(endMs)

  const dates: string[] = []
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    dates.push(isoDay(ms))
  }

  try {
    // A long window multiplies out past PostgREST's 1000-row cap
    // (days x domains x country/role slices), so page through with the
    // shared helper; the ORDER BY spans the table's unique key so pages
    // never overlap.
    const [aggregates, releasesResult] = await Promise.all([
      fetchAllEventPages<AggregateRow>((from, to) =>
        supabase
          .from('daily_tool_aggregates')
          .select(
            'date, domain, vendor, category, distinct_users, total_active_ms, total_visits, session_count, median_session_ms, median_focus_ratio'
          )
          .gte('date', start)
          .lte('date', end)
          .order('date', { ascending: true })
          .order('domain', { ascending: true })
          .order('country', { ascending: true })
          .order('role', { ascending: true })
          .range(from, to) as PromiseLike<{
            data: AggregateRow[] | null
            error: { message: string } | null
          }>
      ),
      supabase
        .from('model_releases')
        .select('vendor, product, release_date, notes')
        .gte('release_date', start)
        .lte('release_date', end)
        .order('release_date', { ascending: true })
    ])

    if (aggregates.error) {
      console.error('[AdminTrends] Aggregates query failed:', aggregates.error)
      return NextResponse.json({ error: 'Failed to load trends' }, { status: 500 })
    }
    if (releasesResult.error) {
      console.error('[AdminTrends] Releases query failed:', releasesResult.error)
      return NextResponse.json({ error: 'Failed to load trends' }, { status: 500 })
    }
    if (aggregates.truncated) {
      // 100k-row safety valve — should never trip with a bounded domain
      // allowlist; charts would silently understate the tail if it did.
      console.warn('[AdminTrends] Aggregate read truncated at page cap')
    }

    const totalActiveMs = dates.map(() => 0)
    const byDomain = new Map<string, ToolAccumulator>()

    for (const row of aggregates.rows) {
      const dayIndex = Math.round((Date.parse(row.date) - startMs) / DAY_MS)
      if (dayIndex < 0 || dayIndex >= dates.length) continue

      let tool = byDomain.get(row.domain)
      if (!tool) {
        tool = {
          domain: row.domain,
          vendor: row.vendor,
          category: row.category,
          activeMsByDay: dates.map(() => 0),
          usersByDay: dates.map(() => 0),
          activeMs: 0,
          sessions: 0,
          visits: 0,
          sessionSamples: [],
          focusSamples: []
        }
        byDomain.set(row.domain, tool)
      }

      const activeMs = Number(row.total_active_ms) || 0
      const sessions = Number(row.session_count) || 0

      tool.activeMsByDay[dayIndex] += activeMs
      tool.activeMs += activeMs
      tool.sessions += sessions
      tool.visits += Number(row.total_visits) || 0
      totalActiveMs[dayIndex] += activeMs

      // country/role slices partition a day's users (each user resolves
      // to exactly one slice at rollup time), so summing distinct_users
      // WITHIN a day is exact. Across days the same user repeats, hence
      // the window stat is the peak day, never a sum.
      tool.usersByDay[dayIndex] += Number(row.distinct_users) || 0

      if (row.median_session_ms !== null) {
        tool.sessionSamples.push({ value: Number(row.median_session_ms), weight: sessions })
      }
      if (row.median_focus_ratio !== null) {
        tool.focusSamples.push({ value: Number(row.median_focus_ratio), weight: sessions })
      }
    }

    const ranked = Array.from(byDomain.values()).sort((a, b) => b.activeMs - a.activeMs)

    const series = ranked.slice(0, SERIES_LIMIT).map((tool) => ({
      domain: tool.domain,
      vendor: tool.vendor,
      category: tool.category,
      activeMs: tool.activeMsByDay
    }))

    const tools = ranked.map((tool) => ({
      domain: tool.domain,
      vendor: tool.vendor,
      category: tool.category,
      activeMs: tool.activeMs,
      sessions: tool.sessions,
      visits: tool.visits,
      peakDailyUsers: Math.max(0, ...tool.usersByDay),
      medianSessionMs: weightedMedian(tool.sessionSamples),
      medianFocusRatio: weightedMedian(tool.focusSamples)
    }))

    const releases = (releasesResult.data ?? []).map((row: ReleaseRow) => ({
      vendor: row.vendor,
      product: row.product,
      releaseDate: row.release_date,
      notes: row.notes ?? null
    }))

    return NextResponse.json({
      success: true,
      days,
      start,
      end,
      dates,
      totalActiveMs,
      series,
      tools,
      releases
    })
  } catch (err) {
    console.error('[AdminTrends] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
