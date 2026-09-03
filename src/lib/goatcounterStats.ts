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
  const digits = raw.trim().replace(/[\s,.\u00a0_]/g, '')
  if (!/^\d+$/.test(digits)) return null
  const n = Number(digits)
  if (!Number.isSafeInteger(n) || n < 0) return null
  return n
}

export async function readResponseTextBounded(
  response: Response,
  maxBytes = TRACKER_MAX_HTML_BYTES
): Promise<string> {
  const advertisedLength = response.headers.get('content-length')
  if (advertisedLength !== null) {
    if (!/^\d+$/.test(advertisedLength) || Number(advertisedLength) > maxBytes) {
      throw new Error('Tracker payload too large')
    }
  }

  if (!response.body) throw new Error('Tracker response body missing')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error('Tracker payload too large')
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function canonicalPublicPath(rawPath: string): string | null {
  const path = rawPath.split(/[?#]/, 1)[0]
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (path.length > TRACKER_PATH_MAX) return null
  // Referral codes are bearer-like values. Preserve the route shape, never the code.
  if (/^\/join\/[^/]+\/?$/.test(path)) return '/join/[code]'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return null
  return path
}

export function parseTrackerApiSnapshot(input: unknown): TrackerStats | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  if (record.success !== true || record.schemaVersion !== TRACKER_STATS_SCHEMA_VERSION) return null
  if (!Number.isSafeInteger(record.periodVisits) || (record.periodVisits as number) < 0) return null
  if (!Number.isSafeInteger(record.pagesShown)) return null
  if (!Array.isArray(record.pages) || record.pages.length === 0) return null
  if (record.pages.length > TRACKER_MAX_PAGES || record.pagesShown !== record.pages.length) return null

  const seen = new Set<string>()
  const pages: TrackerPage[] = []
  for (const item of record.pages) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (typeof row.path !== 'string' || canonicalPublicPath(row.path) !== row.path) return null
    if (!Number.isSafeInteger(row.count) || (row.count as number) < 0) return null
    if (seen.has(row.path)) return null
    seen.add(row.path)
    pages.push({ path: row.path, count: row.count as number })
  }

  return {
    schemaVersion: TRACKER_STATS_SCHEMA_VERSION,
    periodVisits: record.periodVisits as number,
    pagesShown: pages.length,
    pages
  }
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

  const pageCounts = new Map<string, number>()
  const candidateRows = html.match(/<tr\s+id=/g)?.length ?? 0
  const rowRe = /<tr id="([^"]+)" data-id="\d+" data-count="(\d+)"/g
  let parsedRows = 0
  let match: RegExpExecArray | null
  while ((match = rowRe.exec(html)) !== null) {
    parsedRows += 1
    const path = canonicalPublicPath(decodeEntities(match[1]))
    const count = parseNonNegInt(match[2])
    if (count === null || path === null) return null
    const aggregate = (pageCounts.get(path) ?? 0) + count
    if (!Number.isSafeInteger(aggregate)) return null
    pageCounts.set(path, aggregate)
  }
  if (parsedRows !== candidateRows) return null

  const pages = [...pageCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, TRACKER_MAX_PAGES)

  if (pages.length === 0) return null

  return {
    schemaVersion: TRACKER_STATS_SCHEMA_VERSION,
    periodVisits,
    pagesShown: pages.length,
    pages
  }
}
