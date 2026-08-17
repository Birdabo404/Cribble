// Feed I/O for the status aggregator. Every provider request funnels
// through here: callers pass fixed vendor hostnames (nothing in this
// folder accepts a user-controlled URL), a short abort keeps one slow
// feed from stalling the whole aggregate, and `cache: 'no-store'` opts
// out of the Next.js Data Cache — the 60-second cache layer belongs to
// /api/status's unstable_cache, not to the inner fetches.

export const FEED_TIMEOUT_MS = 4_000

export async function fetchFeed(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: {
      accept,
      'user-agent': 'cribble-status/1.0 (+https://cribble.dev/status)'
    }
  })
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`)
  }
  return response
}

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchFeed(url, 'application/json')
  return response.json()
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetchFeed(url, 'application/rss+xml, application/xml, text/xml, */*;q=0.1')
  return response.text()
}
