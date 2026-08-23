// Client-safe DataFast constants. Keep the API key and server fetches
// in datafast.ts so this module can ship to the browser.

/** Public share page (Website Settings → General → Public Dashboard).
 *  `/dashboard/<id>` is the owner view and sends everyone else to
 *  sign-in. Override with NEXT_PUBLIC_DATAFAST_STATS_URL. */
const HARDCODED_STATS_URL =
  'https://datafa.st/share/6a87f87b9edaa5d87fb85c63'

export function datafastStatsUrl(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_DATAFAST_STATS_URL?.trim()
  if (fromEnv) return fromEnv
  const hardcoded = HARDCODED_STATS_URL.trim()
  return hardcoded || null
}
