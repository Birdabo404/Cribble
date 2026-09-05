// Resolvers turn a pinned URL into the card a HANGAR bay renders. A
// small registry, first match wins:
//
//   github — github.com/owner/repo → one call to the REST API for
//            stars, forks, language, last push, archived, homepage.
//            GITHUB_TOKEN (optional) lifts the 60/h/IP anonymous limit
//            to 5000/h; cards are cached in link_cards and shared, so
//            anonymous is acceptable at beta.
//   site   — every other public http(s) URL → fetch the page, read the
//            Open Graph / twitter / <title> meta and the favicon.
//
// Every failure (timeout, non-2xx, wrong content-type, unparseable
// JSON, private redirect target) collapses to a `pending` card: the
// bay still renders as an honest link, and cards.ts records the miss
// so the next viewer retries after an hour instead of on every page
// load. resolveCard never throws.
//
// Outbound safety: pins already passed isPublicHostname on write, but
// the site resolver follows redirects by hand so EVERY hop is checked
// again — a public URL must not be able to bounce us into loopback,
// LAN or cloud-metadata space. Bodies are read through the stream and
// cut at SITE_MAX_BYTES; a page is never buffered whole.

import { isPublicHostname } from '@/lib/imageAnimation'
import { languageColor } from '@/lib/hangar/languageColors'
import { githubRepoOf, hostOf } from '@/lib/hangar/normalize'
import type {
  HangarCardData,
  HangarGithubCard,
  HangarPendingCard,
  HangarSiteCard,
  HangarStoredKind
} from '@/lib/hangar/types'
import { cleanInlineText } from '@/lib/profileText'

const FETCH_TIMEOUT_MS = 5_000
const SITE_MAX_REDIRECTS = 3
const SITE_MAX_BYTES = 256 * 1024
const TITLE_MAX = 80
const DESCRIPTION_MAX = 160

const GITHUB_API = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'

/** What a bay shows before its card exists or after a failed fetch. */
export const pendingCard = (url: string): HangarPendingCard => ({
  kind: 'pending',
  url,
  host: hostOf(url)
})

interface Resolver {
  kind: HangarStoredKind
  matches(url: URL): boolean
  resolve(url: URL): Promise<HangarCardData>
}

const parseUrl = (raw: string): URL | null => {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** http(s), no embedded credentials, public host — the gate applied to
 *  the pin itself and to every redirect hop. */
const isSafeHttpUrl = (url: URL): boolean =>
  (url.protocol === 'http:' || url.protocol === 'https:') &&
  !url.username &&
  !url.password &&
  isPublicHostname(url.hostname)

/** A string that is a safe absolute http(s) URL, serialised; else null. */
const safeHttpString = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v.trim()) return null
  const parsed = parseUrl(v.trim())
  return parsed && isSafeHttpUrl(parsed) ? parsed.toString() : null
}

const nonNegativeInt = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0

const isoOrNull = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

/**
 * Map a GET /repos/{owner}/{repo} payload onto a card. Pure so tests can
 * feed fixtures; null when the payload lacks the two fields a card
 * cannot render without (owner.login, name).
 */
export function githubCardFromApi(json: unknown, fallbackUrl: string): HangarGithubCard | null {
  if (!json || typeof json !== 'object') return null
  const repo = json as Record<string, unknown>
  const ownerObj =
    repo.owner && typeof repo.owner === 'object' ? (repo.owner as Record<string, unknown>) : null
  const owner = ownerObj && typeof ownerObj.login === 'string' ? ownerObj.login.trim() : ''
  const name = typeof repo.name === 'string' ? repo.name.trim() : ''
  if (!owner || !name) return null

  const language =
    typeof repo.language === 'string' && repo.language.trim() ? repo.language.trim() : null

  return {
    kind: 'github',
    url: safeHttpString(repo.html_url) ?? fallbackUrl,
    owner,
    repo: name,
    description: cleanInlineText(repo.description, DESCRIPTION_MAX),
    stars: nonNegativeInt(repo.stargazers_count),
    forks: nonNegativeInt(repo.forks_count),
    language,
    languageColor: languageColor(language),
    pushedAt: isoOrNull(repo.pushed_at),
    archived: repo.archived === true,
    homepage: safeHttpString(repo.homepage)
  }
}

const githubResolver: Resolver = {
  kind: 'github',
  matches: (url) => githubRepoOf(url) !== null,
  async resolve(url) {
    const input = url.toString()
    const ref = githubRepoOf(url)
    if (!ref) return pendingCard(input)

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Cribble',
      'X-GitHub-Api-Version': GITHUB_API_VERSION
    }
    const token = process.env.GITHUB_TOKEN
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    )
    // 404 (gone/private), 403 (rate limited) and 5xx all read the same:
    // no card this time, retry after the failed-row cooldown.
    if (!res.ok) return pendingCard(input)
    const json: unknown = await res.json()
    return githubCardFromApi(json, input) ?? pendingCard(input)
  }
}

/* ------------------------------------------------------------------ */
/* Site (Open Graph / favicon)                                         */
/* ------------------------------------------------------------------ */

export interface SiteMeta {
  title: string | null
  description: string | null
  icon: string | null
}

// The entities that show up in real-world <title> and og: content.
// Anything else stays literal rather than guessing.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  laquo: '\u00ab',
  raquo: '\u00bb',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bull: '\u2022',
  middot: '\u00b7',
  times: '\u00d7'
}

/** Single-pass HTML entity decode (named subset + numeric). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

/** Lowercased attribute map for the inside of one <meta …> / <link …>. */
function attrsOf(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of tagBody.matchAll(ATTR_RE)) {
    const key = match[1].toLowerCase()
    if (key in attrs) continue
    attrs[key] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attrs
}

const META_TAG_RE = /<meta\b([^>]*)>/gi
const LINK_TAG_RE = /<link\b([^>]*)>/gi
const TITLE_TAG_RE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i
const ICON_RELS = new Set(['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'])

const textOrNull = (raw: string | undefined, max: number): string | null =>
  raw === undefined ? null : cleanInlineText(decodeEntities(raw), max)

const firstText = (candidates: Array<string | undefined>, max: number): string | null => {
  for (const candidate of candidates) {
    const text = textOrNull(candidate, max)
    if (text) return text
  }
  return null
}

/**
 * Pull title / description / icon out of a page. Pure — the fetch side
 * hands in at most SITE_MAX_BYTES of HTML plus the URL it was served
 * from (post-redirect) so relative icon hrefs absolutise correctly.
 *
 *   title       og:title → twitter:title → <title>            (≤ 80)
 *   description og:description → description → twitter:description (≤ 160)
 *   icon        first <link rel=icon|shortcut icon|apple-touch-icon>
 *               absolutised, else {origin}/favicon.ico. Must be http(s)
 *               on a public host — data: URIs and LAN hosts fall back.
 */
export function parseSiteMeta(html: string, baseUrl: string): SiteMeta {
  // First occurrence wins; property (og:*) beats name when both exist.
  const meta = new Map<string, string>()
  for (const match of html.matchAll(META_TAG_RE)) {
    const attrs = attrsOf(match[1])
    const key = (attrs.property ?? attrs.name ?? '').trim().toLowerCase()
    if (!key || attrs.content === undefined || meta.has(key)) continue
    meta.set(key, attrs.content)
  }

  const titleTag = TITLE_TAG_RE.exec(html)?.[1]
  const title = firstText(
    [meta.get('og:title'), meta.get('twitter:title'), titleTag],
    TITLE_MAX
  )
  const description = firstText(
    [meta.get('og:description'), meta.get('description'), meta.get('twitter:description')],
    DESCRIPTION_MAX
  )

  let icon: string | null = null
  for (const match of html.matchAll(LINK_TAG_RE)) {
    const attrs = attrsOf(match[1])
    const rels = (attrs.rel ?? '').toLowerCase().split(/\s+/)
    if (!rels.some((rel) => ICON_RELS.has(rel))) continue
    const href = decodeEntities(attrs.href ?? '').trim()
    if (!href) continue
    let absolute: URL
    try {
      absolute = new URL(href, baseUrl)
    } catch {
      continue
    }
    if (!isSafeHttpUrl(absolute)) continue
    icon = absolute.toString()
    break
  }
  if (!icon) {
    const base = parseUrl(baseUrl)
    icon = base && isSafeHttpUrl(base) ? `${base.origin}/favicon.ico` : null
  }

  return { title, description, icon }
}

const SITE_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  'Accept-Language': 'en',
  'User-Agent': 'Mozilla/5.0 (compatible; Cribble link preview)'
}

const charsetOf = (contentType: string): string | null =>
  /charset=["']?([^"';\s]+)/i.exec(contentType)?.[1] ?? null

const isHtmlType = (contentType: string): boolean =>
  contentType.includes('text/html') || contentType.includes('application/xhtml+xml')

const discardBody = (res: Response): void => {
  void res.body?.cancel().catch(() => undefined)
}

/** Read at most `limit` bytes from a fetch body, then cancel the rest. */
async function readBodyText(res: Response, limit: number, charset: string | null): Promise<string> {
  const body = res.body
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < limit) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const room = limit - total
      const slice = value.byteLength > room ? value.subarray(0, room) : value
      chunks.push(slice)
      total += slice.byteLength
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset ?? 'utf-8', { fatal: false })
  } catch {
    decoder = new TextDecoder('utf-8', { fatal: false })
  }
  return decoder.decode(bytes)
}

interface FetchedPage {
  html: string
  /** URL the HTML was actually served from (after redirects). */
  finalUrl: string
}

/**
 * Manual redirect loop: at most SITE_MAX_REDIRECTS hops, each Location
 * absolutised against the previous URL and re-checked against the same
 * public-host gate as the pin. Only text/html bodies are read, and only
 * up to SITE_MAX_BYTES. One timeout signal spans the whole chain.
 */
async function fetchHtml(initial: URL, signal: AbortSignal): Promise<FetchedPage | null> {
  let target = initial
  for (let hop = 0; hop <= SITE_MAX_REDIRECTS; hop++) {
    if (!isSafeHttpUrl(target)) return null

    const res = await fetch(target, { redirect: 'manual', headers: SITE_HEADERS, signal })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      discardBody(res)
      if (!location) return null
      let next: URL
      try {
        next = new URL(location, target)
      } catch {
        return null
      }
      target = next
      continue
    }

    if (!res.ok) {
      discardBody(res)
      return null
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    if (!isHtmlType(contentType)) {
      discardBody(res)
      return null
    }

    const html = await readBodyText(res, SITE_MAX_BYTES, charsetOf(contentType))
    return { html, finalUrl: target.toString() }
  }
  return null
}

const siteResolver: Resolver = {
  kind: 'site',
  matches: () => true,
  async resolve(url) {
    const input = url.toString()
    const page = await fetchHtml(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
    if (!page) return pendingCard(input)
    const meta = parseSiteMeta(page.html, page.finalUrl)
    const card: HangarSiteCard = {
      kind: 'site',
      // The pin as pasted stays the link target; redirects only decide
      // where the meta came from.
      url: input,
      host: hostOf(input),
      title: meta.title,
      description: meta.description,
      icon: meta.icon
    }
    return card
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

// Order matters: the site resolver matches everything, so it goes last.
// Phase 2 resolvers (App Store, npm, ...) slot in above it.
const RESOLVERS: readonly Resolver[] = [githubResolver, siteResolver]

/** Which resolver a URL routes to — the value link_cards.kind stores.
 *  Unparseable input reads as `site` (the catch-all). */
export function resolverKindFor(url: string): HangarStoredKind {
  const parsed = parseUrl(url)
  if (!parsed) return 'site'
  return RESOLVERS.find((resolver) => resolver.matches(parsed))?.kind ?? 'site'
}

/**
 * Resolve one pinned URL into card data. Never throws and never takes
 * longer than FETCH_TIMEOUT_MS (plus a JSON parse) — unsafe URLs and
 * every fetch failure come back as `pending`.
 */
export async function resolveCard(url: string): Promise<HangarCardData> {
  const parsed = parseUrl(url)
  if (!parsed || !isSafeHttpUrl(parsed)) return pendingCard(url)
  const resolver = RESOLVERS.find((candidate) => candidate.matches(parsed))
  if (!resolver) return pendingCard(url)
  try {
    return await resolver.resolve(parsed)
  } catch {
    return pendingCard(url)
  }
}
