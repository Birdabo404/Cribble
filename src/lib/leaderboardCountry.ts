// The opt-in country a player ranks under on GLOBAL's country cut.
// Stored on users.metadata.leaderboardCountry as an ISO 3166-1 alpha-2
// code the country table knows. Device IP country (user_devices.
// country_code) only ever suggests a value in settings; it never
// places anyone on a country board by itself.

import { COUNTRY_POINTS, countryPoint } from '@/lib/countryCentroids'

export const LEADERBOARD_COUNTRY_KEY = 'leaderboardCountry'

export interface CountryOption {
  code: string
  name: string
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
