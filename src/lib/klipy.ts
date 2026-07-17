// Klipy GIF search client for the Banner Studio picker — server-side
// only. Klipy embeds the API key in the request *path*, so the browser
// must never call it directly; GET /api/gifs proxies these helpers.
//
// Klipy is a lifetime-free GIF API (the Giphy/Tenor alternative built by
// ex-Tenor folks). Obligations: visible "Powered by KLIPY" attribution
// in the picker UI, and test keys are rate-limited to 100 calls/min —
// request a free production key at https://partner.klipy.com before
// launch. Ads only appear when ad-* params are sent; we never send them.
//
// Response shape (verified against Klipy's official demo apps):
//   { result: true, data: { data: [item…], current_page, per_page, has_next } }
// where each item is { slug, title, type, file } and `file` is a
// size × format matrix:
//   { hd|md|sm|xs: { gif|webp|mp4: { url, width, height, size } } }

const KLIPY_BASE = 'https://api.klipy.com/api/v1'
const FETCH_TIMEOUT_MS = 8_000
const PER_PAGE = 24
// Public profile banners — keep the library's raciest tier out.
const RATING = 'pg-13'

export interface KlipyGif {
  /** Klipy slug — stable id for the item. */
  id: string
  title: string
  /** Small variant for picker grid tiles. */
  previewUrl: string
  /** Large variant that gets saved as the banner URL. */
  fullUrl: string
  /** Dimensions of the preview variant (0 when Klipy omits them). */
  width: number
  height: number
}

export interface KlipyPage {
  items: KlipyGif[]
  page: number
  hasNext: boolean
}

export function isKlipyConfigured(): boolean {
  return Boolean(process.env.KLIPY_API_KEY)
}

/**
 * Fetch a page of GIFs — search when `query` is non-empty, the trending
 * feed otherwise. Returns null on any failure (missing key, network,
 * non-2xx, malformed payload); the proxy route maps that to a 502.
 */
export async function fetchKlipyGifs({
  query,
  page
}: {
  query: string
  page: number
}): Promise<KlipyPage | null> {
  const key = process.env.KLIPY_API_KEY
  if (!key) return null

  const q = query.trim()
  const safePage = Math.max(1, Math.trunc(page) || 1)

  const endpoint = q ? 'search' : 'trending'
  const url = new URL(`${KLIPY_BASE}/${encodeURIComponent(key)}/gifs/${endpoint}`)
  url.searchParams.set('page', String(safePage))
  url.searchParams.set('per_page', String(PER_PAGE))
  url.searchParams.set('rating', RATING)
  url.searchParams.set('locale', 'en_US')
  if (q) url.searchParams.set('q', q)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return null
    return normalizeKlipyResponse(await res.json(), safePage)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* Normalization — pure functions, unit-tested without any network.    */
/* ------------------------------------------------------------------ */

// Banners render as <img>, so only image formats qualify (mp4/webm are
// skipped). WebP is preferred over GIF at every size: Klipy's animated
// WebP re-encodes run ~5x smaller and the Pro-gate sniffer
// (imageAnimation.ts) detects animated WebP just like GIF.
const FULL_SIZE_ORDER = ['hd', 'md', 'sm', 'xs'] as const
const PREVIEW_SIZE_ORDER = ['sm', 'xs', 'md', 'hd'] as const
const FORMAT_ORDER = ['webp', 'gif'] as const

interface KlipyFileMeta {
  url: string
  width: number
  height: number
}

const finiteOrZero = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0

function readFileMeta(value: unknown): KlipyFileMeta | null {
  if (!value || typeof value !== 'object') return null
  const meta = value as Record<string, unknown>
  if (typeof meta.url !== 'string' || !/^https?:\/\//i.test(meta.url.trim())) return null
  return {
    url: meta.url.trim(),
    width: finiteOrZero(meta.width),
    height: finiteOrZero(meta.height)
  }
}

function pickVariant(
  file: Record<string, unknown>,
  sizeOrder: readonly string[]
): KlipyFileMeta | null {
  for (const size of sizeOrder) {
    const bucket = file[size]
    if (!bucket || typeof bucket !== 'object') continue
    for (const format of FORMAT_ORDER) {
      const meta = readFileMeta((bucket as Record<string, unknown>)[format])
      if (meta) return meta
    }
  }
  return null
}

function normalizeItem(raw: unknown): KlipyGif | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  // Ad slots share the feed array ({ type: 'ad', content: html }) when
  // ad-* params are sent. We never request ads, but drop them anyway.
  if (item.type === 'ad') return null
  if (typeof item.slug !== 'string' || item.slug.trim() === '') return null
  if (!item.file || typeof item.file !== 'object') return null

  const file = item.file as Record<string, unknown>
  const full = pickVariant(file, FULL_SIZE_ORDER)
  if (!full) return null
  const preview = pickVariant(file, PREVIEW_SIZE_ORDER) ?? full

  return {
    id: item.slug.trim(),
    title: typeof item.title === 'string' ? item.title : '',
    previewUrl: preview.url,
    fullUrl: full.url,
    width: preview.width,
    height: preview.height
  }
}

/**
 * Turn a raw Klipy search/trending payload into a KlipyPage. Malformed
 * items are dropped individually; a payload that isn't a successful
 * Klipy envelope at all returns null.
 */
export function normalizeKlipyResponse(json: unknown, fallbackPage: number): KlipyPage | null {
  if (!json || typeof json !== 'object') return null
  const root = json as Record<string, unknown>
  if (root.result !== true) return null

  const data =
    root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : {}
  const rawItems = Array.isArray(data.data) ? data.data : []
  const items = rawItems
    .map(normalizeItem)
    .filter((gif): gif is KlipyGif => gif !== null)

  const currentPage = finiteOrZero(data.current_page)
  return {
    items,
    page: currentPage >= 1 ? currentPage : fallbackPage,
    hasNext: data.has_next === true
  }
}
