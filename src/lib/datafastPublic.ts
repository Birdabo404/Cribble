// Client-safe DataFast constants. Keep the API key and server fetches
// in datafast.ts so this module can ship to the browser.

/** Public share page (Website Settings → General → Public Dashboard).
 *  The settings URL is `/dashboard/<id>/settings`; visitors need `/share/<id>`.
 *  Override with NEXT_PUBLIC_DATAFAST_STATS_URL without a rebuild of
 *  this file. */
const HARDCODED_SHARE_URL =
  'https://datafa.st/share/6a87f87b9edaa5d87fb85c63'

export function datafastStatsUrl(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_DATAFAST_STATS_URL?.trim()
  if (fromEnv) return fromEnv
  const hardcoded = HARDCODED_SHARE_URL.trim()
  return hardcoded || null
}
