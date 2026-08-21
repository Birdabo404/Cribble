// Client-safe DataFast constants. Keep the API key and server fetches
// in datafast.ts so this module can ship to the browser.

/** Owner dashboard for cribble.dev. `/share/<id>` only stays on the
 *  charts when Public Dashboard is on; otherwise DataFast 307s to `/`
 *  (the account home). `/dashboard/<id>` is the page that actually
 *  shows the site. Override with NEXT_PUBLIC_DATAFAST_STATS_URL. */
const HARDCODED_STATS_URL =
  'https://datafa.st/dashboard/6a87f87b9edaa5d87fb85c63'

export function datafastStatsUrl(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_DATAFAST_STATS_URL?.trim()
  if (fromEnv) return fromEnv
  const hardcoded = HARDCODED_STATS_URL.trim()
  return hardcoded || null
}
