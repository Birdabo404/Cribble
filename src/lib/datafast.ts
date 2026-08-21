// DataFast analytics client — server-side only. The tracking script in
// the root layout writes pageviews; this module reads them back for the
// leaderboard visitor ticker. The browser never sees DATAFAST_API_KEY.

const DATAFAST_API = 'https://datafa.st/api/v1'
const FETCH_TIMEOUT_MS = 4_000
const WINDOW_MS = 12 * 60 * 60 * 1000

export type VisitorPulse = {
  live: number
  last12h: number
}

export function isDatafastConfigured(): boolean {
  return Boolean(process.env.DATAFAST_API_KEY?.trim())
}

export function last12hRange(now = new Date()): { startAt: string; endAt: string } {
  return {
    startAt: new Date(now.getTime() - WINDOW_MS).toISOString(),
    endAt: now.toISOString()
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function finiteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

/** Pull a visitor count out of DataFast's `{ data: [{ visitors }] }`
 *  envelope (and the handful of adjacent shapes the docs have shown). */
export function readVisitorCount(payload: unknown): number | null {
  const root = asRecord(payload)
  if (!root) return null

  const fromRoot = finiteCount(root.visitors) ?? finiteCount(root.count)
  if (fromRoot !== null) return fromRoot

  const data = root.data
  if (Array.isArray(data)) {
    const first = asRecord(data[0])
    if (!first) return null
    return finiteCount(first.visitors) ?? finiteCount(first.count)
  }

  const rec = asRecord(data)
  if (!rec) return null
  return finiteCount(rec.visitors) ?? finiteCount(rec.count)
}

async function fetchDatafastJson(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${DATAFAST_API}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    }
  })
  if (!res.ok) {
    throw new Error(`DataFast ${path} answered ${res.status}`)
  }
  return res.json()
}

export async function fetchVisitorPulse(
  now = new Date(),
  apiKey = process.env.DATAFAST_API_KEY?.trim()
): Promise<VisitorPulse | null> {
  if (!apiKey) return null

  const { startAt, endAt } = last12hRange(now)
  const overviewQs = new URLSearchParams({
    fields: 'visitors',
    startAt,
    endAt
  })

  const [realtime, overview] = await Promise.all([
    fetchDatafastJson('/analytics/realtime', apiKey),
    fetchDatafastJson(`/analytics/overview?${overviewQs.toString()}`, apiKey)
  ])

  const live = readVisitorCount(realtime)
  const last12h = readVisitorCount(overview)
  if (live === null || last12h === null) return null
  return { live, last12h }
}
