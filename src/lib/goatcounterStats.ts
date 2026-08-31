// Bounded, versioned snapshot of the public GoatCounter dashboard.
// Fail closed: oversized HTML, missing totals, or malformed paths are
// rejected rather than guessed. This never enables extra tracking.

export const TRACKER_STATS_SCHEMA_VERSION = 1 as const
export const TRACKER_MAX_HTML_BYTES = 256_000
export const TRACKER_MAX_PAGES = 10
export const TRACKER_PATH_MAX = 200
export const TRACKER_FETCH_MS = 5_000

export type TrackerPage = {
  path: string
  count: number
}

export type TrackerStats = {
  schemaVersion: typeof TRACKER_STATS_SCHEMA_VERSION
  periodVisits: number
  pagesShown: number
  pages: TrackerPage[]
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
}

function parseNonNegInt(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return null
  const n = Number(digits)
  if (!Number.isSafeInteger(n) || n < 0) return null
  return n
}

function isSafePath(path: string): boolean {
  if (!path.startsWith('/')) return false
  if (path.length > TRACKER_PATH_MAX) return false
  if (path.includes('\n') || path.includes('\r') || path.includes('\0')) return false
  return true
}

/**
 * Parse the public GoatCounter HTML into a bounded stats snapshot.
 * Returns null when the contract cannot be satisfied.
 */
export function parseGoatcounterDashboard(html: string): TrackerStats | null {
  if (html.length > TRACKER_MAX_HTML_BYTES) return null

  const totalMatch = html.match(/class="hide js-total">([^<]+)</)
  if (!totalMatch) return null
  const periodVisits = parseNonNegInt(decodeEntities(totalMatch[1]))
  if (periodVisits === null) return null

  const pages: TrackerPage[] = []
  const rowRe = /<tr id="([^"]+)" data-id="\d+" data-count="(\d+)"/g
  let match: RegExpExecArray | null
  while ((match = rowRe.exec(html)) !== null) {
    const path = decodeEntities(match[1])
    const count = parseNonNegInt(match[2])
    if (count === null || !isSafePath(path)) continue
    pages.push({ path, count })
    if (pages.length >= TRACKER_MAX_PAGES) break
  }

  if (pages.length === 0) return null

  return {
    schemaVersion: TRACKER_STATS_SCHEMA_VERSION,
    periodVisits,
    pagesShown: pages.length,
    pages
  }
}
