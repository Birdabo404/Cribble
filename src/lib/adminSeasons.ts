// Input validators shared by the /api/admin/seasons routes.

export const SEASON_NAME_MAX = 40

/** Parse an incoming timestamp into a normalized ISO string, or null. */
export function parseSeasonInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/** Collapse whitespace and bound length; null when too short to be real. */
export function cleanSeasonName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, SEASON_NAME_MAX)
  return cleaned.length >= 3 ? cleaned : null
}
