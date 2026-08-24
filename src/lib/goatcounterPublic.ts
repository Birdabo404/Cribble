// Client-safe GoatCounter constants. The count endpoint is public
// (pageviews only); there is no API key.

const HARDCODED_ENDPOINT = 'https://birdabo.goatcounter.com/count'
const HARDCODED_STATS_URL = 'https://birdabo.goatcounter.com'
export const GOATCOUNTER_SCRIPT_SRC = 'https://gc.zgo.at/count.js'

export function goatcounterEndpoint(): string {
  return process.env.NEXT_PUBLIC_GOATCOUNTER_ENDPOINT?.trim() || HARDCODED_ENDPOINT
}

export function goatcounterStatsUrl(): string {
  return process.env.NEXT_PUBLIC_GOATCOUNTER_STATS_URL?.trim() || HARDCODED_STATS_URL
}
