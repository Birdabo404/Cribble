// Season model shared by client and server. The seasons table (migration
// 025) is the single source of truth for the calendar; these types mirror
// the API wire shape, and the pure helpers keep countdown/progress math
// identical on the dashboard, the leaderboard, and in tests. No Supabase
// imports here — server-side fetchers live in seasonServer.ts.

export type SeasonStatus = 'upcoming' | 'active' | 'complete'

/** What the product is doing right now: a live season, or the gap between
 *  a close and the next start (frozen standings + countdown). */
export type SeasonPhase = 'active' | 'intermission'

export interface ApiSeason {
  id: number
  number: number
  name: string
  startsAt: string
  endsAt: string
  status: SeasonStatus
}

export interface SeasonState {
  phase: SeasonPhase
  /** The live season while active; the just-finished one during
   *  intermission; null when no season exists yet. */
  current: ApiSeason | null
  /** The next scheduled season, when the calendar has one. */
  next: ApiSeason | null
}

/** Raw seasons-table row, as selected by the API routes. */
export interface SeasonRow {
  id: number
  number: number
  name: string
  starts_at: string
  ends_at: string
  status: string
}

export function toApiSeason(row: SeasonRow): ApiSeason {
  const status: SeasonStatus =
    row.status === 'active' || row.status === 'complete'
      ? row.status
      : 'upcoming'
  return {
    id: Number(row.id),
    number: Number(row.number),
    name: String(row.name),
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    status
  }
}

/**
 * Derive the product phase from the season calendar. At most one season is
 * active during play (season_tick enforces it). With none active, the
 * latest completed season fronts the frozen board and the earliest
 * upcoming one is the countdown target.
 */
export function deriveSeasonState(rows: SeasonRow[]): SeasonState {
  const seasons = rows.map(toApiSeason)
  const byNumberAsc = (a: ApiSeason, b: ApiSeason) => a.number - b.number

  const active = seasons.filter((s) => s.status === 'active').sort(byNumberAsc)[0] ?? null
  const upcoming = seasons.filter((s) => s.status === 'upcoming').sort(byNumberAsc)[0] ?? null

  if (active) {
    return { phase: 'active', current: active, next: upcoming }
  }

  const complete =
    seasons.filter((s) => s.status === 'complete').sort((a, b) => b.number - a.number)[0] ?? null
  return { phase: 'intermission', current: complete, next: upcoming }
}

const DAY_MS = 86_400_000

export interface SeasonProgress {
  /** Percent of the season elapsed, 0–100. */
  pct: number
  /** Whole days remaining (ceil), never negative. */
  daysLeft: number
}

export function seasonProgress(
  startsAtIso: string,
  endsAtIso: string,
  nowMs: number = Date.now()
): SeasonProgress {
  const start = Date.parse(startsAtIso)
  const end = Date.parse(endsAtIso)
  const total = end - start
  const elapsed = Math.max(0, Math.min(nowMs - start, total))
  const pct = total > 0 ? Math.round((elapsed / total) * 100) : 0
  const daysLeft = Math.max(0, Math.ceil((end - nowMs) / DAY_MS))
  return { pct, daysLeft }
}

export interface SeasonCountdown {
  d: number
  h: number
  m: number
  s: number
  ended: boolean
}

/** Live-ticking countdown segments toward an ISO instant. */
export function countdownTo(iso: string, nowMs: number = Date.now()): SeasonCountdown {
  const diff = Date.parse(iso) - nowMs
  if (!Number.isFinite(diff) || diff <= 0) return { d: 0, h: 0, m: 0, s: 0, ended: true }
  return {
    d: Math.floor(diff / DAY_MS),
    h: Math.floor((diff % DAY_MS) / 3600_000),
    m: Math.floor((diff % 3600_000) / 60_000),
    s: Math.floor((diff % 60_000) / 1000),
    ended: false
  }
}

/** Whole days (ceil) until an ISO instant, never negative. */
export function daysUntil(iso: string, nowMs: number = Date.now()): number {
  const diff = Date.parse(iso) - nowMs
  if (!Number.isFinite(diff) || diff <= 0) return 0
  return Math.ceil(diff / DAY_MS)
}
