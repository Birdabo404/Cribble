// Live readings for the landing hero: how many players are on the board,
// how many synced today, where the season stands, and a set of real
// handles pinned to the globe. Server-only (service-role client) — the
// hero's server component calls getLandingLive() and hands the plain JSON
// result to the client, which falls back to the static roster in
// src/components/landing/pilots.ts when pins come back empty.
//
// One Data Cache entry for five minutes, the same unstable_cache pattern
// as src/app/(app)/leaderboard/page.tsx. Every field degrades on its own:
// a failed pins query can never blank the player count. Only a total
// outage (every read failed) throws inside the cached loader, so an
// unreachable database is not remembered for the whole window.

import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { countryPoint, type CountryPoint } from '@/lib/countryCentroids'
import {
  resolveCohortCountry,
  resolveCohortOptOut,
  type CohortDeviceRow
} from '@/lib/insightsRollup'
import { readAccountIsPrivate } from '@/lib/publicProfile'
import { daysUntil, type ApiSeason } from '@/lib/season'
import { fetchSeasonState } from '@/lib/seasonServer'
import { createServiceClient } from '@/lib/supabaseServer'

export interface GlobePin {
  /** twitter_username without a leading @ — the client adds it. */
  handle: string
  /** ISO 3166-1 alpha-2, as stored on user_devices.country_code. */
  country: string
  countryName: string
  lat: number
  lng: number
}

export interface LandingLive {
  /** Accounts on the public board — see RANKED_DEFINITION. null = fetch failed. */
  playerCount: number | null
  /** Eligible users whose extension synced in the last 24h. null on failure. */
  activeToday: number | null
  /** The current season (live, or the just-finished one during intermission,
   *  when daysLeft reads 0). null when no season exists or the read failed. */
  season: { label: string; daysLeft: number | null } | null
  /** Real players for the globe. Empty on failure — the client falls back. */
  pins: GlobePin[]
  fetchedAt: string
}

/**
 * How "players" is counted, in one place: every user_scores row whose
 * users.status is null or 'active' — the exact eligibility the
 * leaderboard_standings RPC applies (migration 060, INNER JOIN users WHERE
 * status IS NULL OR status = 'active'). Score does not matter: an account
 * on the board with 0 points is still a player, so this is the board's
 * length, not the count of scorers.
 */
export const RANKED_DEFINITION =
  'user_scores rows whose users.status is null or active — the leaderboard_standings eligibility, regardless of score'

const LANDING_REVALIDATE_SECONDS = 300
const DAY_MS = 86_400_000

/** Ranks scanned for pins. Deep enough that 60 pins survive the eligibility
 *  and per-country filters even with the top of the board US-heavy. */
const PIN_RANK_WINDOW = 300
export const MAX_PINS_PER_COUNTRY = 6
export const MAX_PINS = 60

/** Jitter around the capital so several players in one country do not
 *  stack on one dot. Continental countries get a wider scatter. */
const COMPACT_SPREAD = { lat: 1.6, lng: 2.4 }
const WIDE_SPREAD = { lat: 5, lng: 8 }
const WIDE_COUNTRIES = new Set(['US', 'BR', 'IN', 'AU', 'CA', 'RU', 'CN'])
/** Keeps pins off the poles, where the globe projection pinches. */
const LAT_LIMIT = 80

/** Thrown (never returned) by the cached loader only when EVERY read
 *  failed, so a total outage is not cached for the whole window. Partial
 *  degradation IS cached — the fields that worked are still worth sharing. */
const LANDING_LIVE_UNAVAILABLE = 'LANDING_LIVE_UNAVAILABLE'

// ── season ──────────────────────────────────────────────────────────────

/** "SEASON 01" as seeded; a season renamed to a codename reads
 *  "SEASON 01 · IGNITION" so the ordinal never disappears from the rail. */
export function seasonLabel(season: Pick<ApiSeason, 'number' | 'name'>): string {
  const ordinal = `SEASON ${String(season.number).padStart(2, '0')}`
  const name = season.name.trim().toUpperCase()
  if (!name) return ordinal
  if (/^SEASON\s+\d+/.test(name)) return name
  return `${ordinal} · ${name}`
}

async function loadSeason(
  supabase: SupabaseClient,
  nowMs: number
): Promise<LandingLive['season']> {
  try {
    // fetchSeasonState already swallows table errors into an empty calendar.
    const state = await fetchSeasonState(supabase)
    const current = state.current
    if (!current) return null
    const daysLeft = Number.isFinite(Date.parse(current.endsAt))
      ? daysUntil(current.endsAt, nowMs)
      : null
    return { label: seasonLabel(current), daysLeft }
  } catch (err) {
    console.warn('[LandingLive] Season read failed:', err)
    return null
  }
}

// ── counts ──────────────────────────────────────────────────────────────

/** Eligible accounts, expressed as a PostgREST filter usable on `users`. */
const ELIGIBLE_STATUS_FILTER = 'status.is.null,status.eq.active'

/**
 * RANKED_DEFINITION as two cheap head-counts. supabase-js cannot express
 * "count user_scores INNER JOIN users WHERE eligible" as a head request, so
 * count every score row, then subtract the rows belonging to ineligible
 * (banned/suspended) users — a list that stays tiny, so the `in` filter is
 * safe as a query string.
 */
async function loadPlayerCount(supabase: SupabaseClient): Promise<number | null> {
  try {
    const [scores, ineligible] = await Promise.all([
      supabase.from('user_scores').select('user_id', { count: 'exact', head: true }),
      supabase.from('users').select('id').not('status', 'is', null).neq('status', 'active')
    ])
    if (scores.error || scores.count === null) {
      console.warn('[LandingLive] Player count failed:', scores.error?.message)
      return null
    }
    if (ineligible.error) {
      console.warn('[LandingLive] Ineligible users read failed:', ineligible.error.message)
      return null
    }
    const ineligibleIds = (ineligible.data || []).map((row) => Number(row.id))
    if (ineligibleIds.length === 0) return scores.count

    const excluded = await supabase
      .from('user_scores')
      .select('user_id', { count: 'exact', head: true })
      .in('user_id', ineligibleIds)
    if (excluded.error || excluded.count === null) {
      console.warn('[LandingLive] Ineligible score count failed:', excluded.error?.message)
      return null
    }
    return Math.max(0, scores.count - excluded.count)
  } catch (err) {
    console.warn('[LandingLive] Player count unavailable:', err)
    return null
  }
}

/** Eligible users whose extension synced inside the trailing 24 hours —
 *  the same "active" window the leaderboard's green dot uses. */
async function loadActiveToday(
  supabase: SupabaseClient,
  nowMs: number
): Promise<number | null> {
  try {
    const since = new Date(nowMs - DAY_MS).toISOString()
    const { count, error } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .or(ELIGIBLE_STATUS_FILTER)
      .gt('last_extension_sync', since)
    if (error || count === null) {
      console.warn('[LandingLive] Active-today count failed:', error?.message)
      return null
    }
    return count
  } catch (err) {
    console.warn('[LandingLive] Active-today count unavailable:', err)
    return null
  }
}

// ── pins ────────────────────────────────────────────────────────────────

/** One ranked account with everything the pin filter needs, joined in JS
 *  from leaderboard_ranks + users + user_devices. */
export interface GlobePinCandidate {
  userId: number
  rank: number
  /** Raw twitter_username — may still carry a leading @ or be null. */
  handle: string | null
  status: string | null
  metadata: Record<string, unknown> | null
  /** Every device with a country_code; the most recently synced one wins. */
  devices: CohortDeviceRow[]
}

export interface SelectGlobePinsOptions {
  maxPerCountry?: number
  maxTotal?: number
}

interface RankRow {
  user_id: number | string
  rank: number | string
}

interface PinUserRow {
  id: number | string
  twitter_username: string | null
  metadata: Record<string, unknown> | null
  status: string | null
}

interface PinDeviceRow {
  user_id: number | string
  country_code: string | null
  last_sync_at: string | null
}

export function joinPinCandidates(
  ranks: RankRow[],
  users: PinUserRow[],
  devices: PinDeviceRow[]
): GlobePinCandidate[] {
  const usersById = new Map<number, PinUserRow>()
  for (const user of users) usersById.set(Number(user.id), user)

  const devicesByUser = new Map<number, CohortDeviceRow[]>()
  for (const device of devices) {
    const userId = Number(device.user_id)
    const list = devicesByUser.get(userId) ?? []
    list.push({ country_code: device.country_code, last_sync_at: device.last_sync_at })
    devicesByUser.set(userId, list)
  }

  const candidates: GlobePinCandidate[] = []
  for (const row of ranks) {
    const userId = Number(row.user_id)
    const user = usersById.get(userId)
    // A rank row without its user is a snapshot racing a deletion — skip.
    if (!user) continue
    candidates.push({
      userId,
      rank: Number(row.rank),
      handle: user.twitter_username,
      status: user.status,
      metadata: user.metadata,
      devices: devicesByUser.get(userId) ?? []
    })
  }
  return candidates
}

/** 32-bit integer mix (murmur3 finalizer) → [0, 1). Two salts give two
 *  independent axes from one user_id, so a pin's position is a pure
 *  function of the account — SSR and ISR output never shimmers. */
function unitHash(userId: number, salt: number): number {
  let h = (userId ^ Math.imul(salt, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 0x1_0000_0000
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4

/** Normalise to (-180, 180] so a scatter east of Fiji does not overshoot. */
const wrapLng = (lng: number) => {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
}

export function jitterPosition(
  userId: number,
  country: string,
  point: Pick<CountryPoint, 'lat' | 'lng'>
): { lat: number; lng: number } {
  const spread = WIDE_COUNTRIES.has(country) ? WIDE_SPREAD : COMPACT_SPREAD
  const lat = point.lat + (unitHash(userId, 1) * 2 - 1) * spread.lat
  const lng = point.lng + (unitHash(userId, 2) * 2 - 1) * spread.lng
  return {
    lat: round4(Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat))),
    lng: round4(wrapLng(lng))
  }
}

/** The handle the client will prefix with @; null when there is nothing
 *  presentable (no username, or only the @ itself). */
const presentableHandle = (raw: string | null): string | null => {
  const handle = (raw ?? '').trim().replace(/^@+/, '')
  return handle.length > 0 ? handle : null
}

/**
 * Pure pin selection. Walks candidates in rank order and keeps an account
 * when it is on the board (status null/active), public, not opted out of
 * the insights cohort data that its country comes from, has a handle, and
 * its most recently synced device reports a country the centroid table
 * knows. Caps per country and in total so one region cannot own the globe.
 */
export function selectGlobePins(
  rows: GlobePinCandidate[],
  opts: SelectGlobePinsOptions = {}
): GlobePin[] {
  const maxPerCountry = opts.maxPerCountry ?? MAX_PINS_PER_COUNTRY
  const maxTotal = opts.maxTotal ?? MAX_PINS
  const perCountry = new Map<string, number>()
  const pins: GlobePin[] = []

  const ordered = rows.slice().sort((a, b) => a.rank - b.rank)
  for (const row of ordered) {
    if (pins.length >= maxTotal) break
    if (row.status !== null && row.status !== 'active') continue
    if (readAccountIsPrivate(row.metadata) || resolveCohortOptOut(row.metadata)) continue

    const handle = presentableHandle(row.handle)
    if (!handle) continue

    const country = resolveCohortCountry(row.devices)
    const point = countryPoint(country)
    if (!point) continue

    const used = perCountry.get(country) ?? 0
    if (used >= maxPerCountry) continue
    perCountry.set(country, used + 1)

    const { lat, lng } = jitterPosition(row.userId, country, point)
    pins.push({ handle, country, countryName: point.name, lat, lng })
  }
  return pins
}

async function loadPins(supabase: SupabaseClient): Promise<GlobePin[]> {
  try {
    // The persisted rank snapshot (leaderboard_ranks) rather than the
    // ranking RPC: pins only need "who is near the top", and the snapshot
    // is one indexed read the score-write path keeps fresh.
    const ranks = await supabase
      .from('leaderboard_ranks')
      .select('user_id, rank')
      .order('rank', { ascending: true })
      .limit(PIN_RANK_WINDOW)
    if (ranks.error) {
      console.warn('[LandingLive] Rank snapshot read failed:', ranks.error.message)
      return []
    }
    const rankRows = (ranks.data || []) as RankRow[]
    const userIds = rankRows.map((row) => Number(row.user_id))
    if (userIds.length === 0) return []

    const [users, devices] = await Promise.all([
      supabase
        .from('users')
        .select('id, twitter_username, metadata, status')
        .in('id', userIds),
      supabase
        .from('user_devices')
        .select('user_id, country_code, last_sync_at')
        .in('user_id', userIds)
        .not('country_code', 'is', null)
    ])
    if (users.error || devices.error) {
      console.warn(
        '[LandingLive] Pin profile read failed:',
        users.error?.message ?? devices.error?.message
      )
      return []
    }

    return selectGlobePins(
      joinPinCandidates(
        rankRows,
        (users.data || []) as PinUserRow[],
        (devices.data || []) as PinDeviceRow[]
      )
    )
  } catch (err) {
    console.warn('[LandingLive] Pins unavailable:', err)
    return []
  }
}

// ── loader ──────────────────────────────────────────────────────────────

const unavailable = (): LandingLive => ({
  playerCount: null,
  activeToday: null,
  season: null,
  pins: [],
  fetchedAt: new Date().toISOString()
})

async function assembleLandingLive(): Promise<LandingLive> {
  const supabase = createServiceClient()
  const nowMs = Date.now()
  const [playerCount, activeToday, season, pins] = await Promise.all([
    loadPlayerCount(supabase),
    loadActiveToday(supabase, nowMs),
    loadSeason(supabase, nowMs),
    loadPins(supabase)
  ])
  if (playerCount === null && activeToday === null && season === null && pins.length === 0) {
    throw new Error(LANDING_LIVE_UNAVAILABLE)
  }
  return { playerCount, activeToday, season, pins, fetchedAt: new Date(nowMs).toISOString() }
}

const loadLandingLiveCached = unstable_cache(assembleLandingLive, ['landing-live'], {
  revalidate: LANDING_REVALIDATE_SECONDS
})

/** Never throws and never rejects: every failure path is the all-null
 *  shape, so the hero renders (with its static roster) no matter what. */
export async function getLandingLive(): Promise<LandingLive> {
  // Build-time renders without secrets skip the read instead of letting
  // createServiceClient throw on a missing URL.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return unavailable()
  }
  try {
    return await loadLandingLiveCached()
  } catch (err) {
    if (!(err instanceof Error && err.message === LANDING_LIVE_UNAVAILABLE)) {
      console.error('[LandingLive] Unexpected failure:', err)
    }
    return unavailable()
  }
}
