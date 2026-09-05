// Pin normalisation for the HANGAR. Two ideas live here:
//
//   urlKey(url)   — the identity of a link. Two pastes of "the same
//                   page" (www./no-www., trailing slash, hash, tracking
//                   params, GitHub deep paths and .git suffixes) must
//                   collapse to one key so they dedupe inside a pilot's
//                   bays AND share one link_cards row across pilots.
//   cleanPins(raw) — what PATCH /api/user/profile stores in
//                   users.metadata.pins: the route's http(s)-URL rules,
//                   public hosts only, tracking noise stripped, deduped
//                   on urlKey, capped at HANGAR_MAX. Invalid entries are
//                   dropped silently — a bad paste costs one bay, never
//                   the whole save. The profile reader runs the same
//                   function over stored metadata so hand-edited rows
//                   can never surface a private or malformed URL.
//
// Server-only: cleanPins reaches isPublicHostname, which lives next to
// the node:dns / node:http banner sniffer. Client code should read
// host/url off the resolved card instead of importing this module.

import { HANGAR_MAX } from '@/lib/hangar/types'
import { cleanHttpUrl } from '@/lib/profileText'

/** Longest URL a bay accepts — generous for deep repo links, short
 *  enough that metadata.pins stays a few hundred bytes. */
export const PIN_URL_MAX = 200

/** Query parameters that identify a campaign or a clicker, never a
 *  page. Dropped from keys and stored pins alike. */
const TRACKING_PARAM_RE =
  /^(utm_[a-z0-9_]+|ref|ref_src|ref_url|source|fbclid|gclid|gclsrc|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|mkt_tok|oly_anon_id|oly_enc_id|vero_id|wickedid|s_kwcid)$/i

export interface GithubRepoRef {
  owner: string
  repo: string
}

const parseHttpUrl = (raw: string): URL | null => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url
}

/** Hostname lowercased with a leading www. removed — what the telemetry
 *  strip shows for a site card. Empty string for unparseable input. */
export function hostOf(url: string): string {
  const parsed = parseHttpUrl(url)
  if (!parsed) return ''
  return parsed.hostname.toLowerCase().replace(/^www\./, '')
}

/**
 * owner/repo for a github.com URL whose path has at least those two
 * segments (deeper paths — /tree/main, /issues/4 — still resolve to the
 * repo). Null for any other host or a bare /owner page. The trailing
 * .git some people paste from a clone box is dropped from repo.
 */
export function githubRepoOf(url: string | URL): GithubRepoRef | null {
  const parsed = typeof url === 'string' ? parseHttpUrl(url) : url
  if (!parsed) return null
  if (parsed.hostname.toLowerCase().replace(/^www\./, '') !== 'github.com') return null
  const [owner, repoRaw] = parsed.pathname.split('/').filter(Boolean)
  if (!owner || !repoRaw) return null
  const repo = repoRaw.replace(/\.git$/i, '')
  if (!repo) return null
  return { owner, repo }
}

/** Rebuild a URL's query without tracking params, sorted for stability. */
const canonicalQuery = (url: URL): string => {
  const kept: Array<[string, string]> = []
  url.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAM_RE.test(key)) kept.push([key, value])
  })
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const params = new URLSearchParams()
  for (const [key, value] of kept) params.append(key, value)
  const serialised = params.toString()
  return serialised ? `?${serialised}` : ''
}

/**
 * Canonical identity for a pin. Lowercase scheme and host, no www., no
 * hash, no tracking params (other query params kept, sorted), no
 * trailing slash. GitHub repos collapse to /owner/repo lowercased with
 * .git removed, because GitHub treats both as case-insensitive and any
 * deeper path is still "that repo". Null when the input is not an
 * http(s) URL.
 */
export function urlKey(url: string): string | null {
  const parsed = parseHttpUrl(url)
  if (!parsed) return null

  const scheme = parsed.protocol.toLowerCase()
  const host = parsed.host.toLowerCase().replace(/^www\./, '')
  if (!host) return null

  const repo = githubRepoOf(parsed)
  if (repo) {
    return `${scheme}//${host}/${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`
  }

  const path = parsed.pathname.replace(/\/+$/, '')
  return `${scheme}//${host}${path}${canonicalQuery(parsed)}`
}

/**
 * The stored form of a pin: cleanHttpUrl's rules (https:// default,
 * public host, no credentials, ≤ PIN_URL_MAX), then the same noise
 * removal as urlKey without touching case or www. — GitHub repos are
 * cut back to /owner/repo (the card links to the canonical html_url
 * anyway), everything else keeps its path and non-tracking query.
 */
export function cleanPinUrl(raw: unknown): string | null {
  const cleaned = cleanHttpUrl(raw, PIN_URL_MAX)
  if (!cleaned) return null
  const parsed = parseHttpUrl(cleaned)
  if (!parsed) return null

  parsed.hash = ''
  const repo = githubRepoOf(parsed)
  if (repo) {
    parsed.pathname = `/${repo.owner}/${repo.repo}`
    parsed.search = ''
  } else {
    parsed.search = canonicalQuery(parsed)
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  }
  return parsed.toString()
}

/**
 * Sanitise a pins payload (request body or stored metadata) into the
 * ordered list the profile serves. Non-arrays read as no pins.
 */
export function cleanPins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const pins: string[] = []
  for (const item of raw) {
    if (pins.length >= HANGAR_MAX) break
    const url = cleanPinUrl(item)
    if (!url) continue
    const key = urlKey(url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    pins.push(url)
  }
  return pins
}
