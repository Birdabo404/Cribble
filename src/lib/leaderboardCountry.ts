// Country boards follow where a player is. The country is the latest
// synced device's ISO code (user_devices.country_code, the same source
// as the landing globe). It is on unless users.metadata.
// leaderboardCountryOff is true. The old leaderboardCountry picker
// value is no longer a placement; a stored null from that picker still
// counts as off until the player turns the board back on.

import { COUNTRY_POINTS, countryPoint } from '@/lib/countryCentroids'

export const LEADERBOARD_COUNTRY_KEY = 'leaderboardCountry'
export const LEADERBOARD_COUNTRY_OFF_KEY = 'leaderboardCountryOff'

export interface CountryOption {
  code: string
  name: string
}

export interface DeviceCountryRow {
  country_code: string | null
  last_sync_at: string | null
}

/** A known ISO code, uppercased, or null for anything else. */
export function parseLeaderboardCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return null
  return countryPoint(code) ? code : null
}

export function countryName(code: string): string | null {
  return countryPoint(code)?.name ?? null
}

/** Every country the table knows, by display name. */
export function countryOptions(): CountryOption[] {
  return Object.entries(COUNTRY_POINTS)
    .map(([code, point]) => ({ code, name: point.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** On by default. An explicit off flag wins. A null left by the old
 *  country picker also stays off, until the player turns the board on. */
export function countryBoardEnabled(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return true
  const meta = metadata as Record<string, unknown>
  if (meta[LEADERBOARD_COUNTRY_OFF_KEY] === true) return false
  if (meta[LEADERBOARD_COUNTRY_OFF_KEY] === false) return true
  if (
    Object.prototype.hasOwnProperty.call(meta, LEADERBOARD_COUNTRY_KEY) &&
    meta[LEADERBOARD_COUNTRY_KEY] == null
  ) {
    return false
  }
  return true
}

/** The most recently synced device with a country this board can name. */
export function latestDeviceCountry(devices: readonly DeviceCountryRow[]): string | null {
  let best: { code: string; syncMs: number } | null = null
  for (const device of devices) {
    const code = parseLeaderboardCountry(device.country_code)
    if (!code) continue
    const syncMs = Date.parse(device.last_sync_at ?? '')
    const rank = Number.isFinite(syncMs) ? syncMs : 0
    if (!best || rank > best.syncMs) best = { code, syncMs: rank }
  }
  return best?.code ?? null
}

/** The country a public row may show. Off, or no known device country,
 *  publishes nothing. */
export function publishedBoardCountry(
  metadata: unknown,
  devices: readonly DeviceCountryRow[]
): string | null {
  if (!countryBoardEnabled(metadata)) return null
  return latestDeviceCountry(devices)
}
