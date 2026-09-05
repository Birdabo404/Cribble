// Text and URL sanitisers shared by the self-service profile writer
// (PATCH /api/user/profile) and the HANGAR pin normaliser. They used to
// be private to the route; the hangar needs the exact same http(s)-URL
// rules for pins, so they live here and the route imports them back.
// Behaviour is byte-identical to the route's original helpers — every
// other profile field still cleans exactly as before.

import { isPublicHostname } from '@/lib/imageAnimation'

/** Drop C0 control characters (except \t and \n) and DEL. */
export const stripControl = (v: string): string =>
  // eslint-disable-next-line no-control-regex
  v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')

/**
 * Normalise a user-supplied URL for storage: bare domains get https://,
 * only http(s) survives, embedded credentials and dotless hosts are
 * rejected, and the host must be public so a saved link can never turn
 * a viewer's browser (or our own resolvers) into a requester for
 * loopback, LAN or cloud-metadata destinations. Returns the serialised
 * URL, or null when the value is unusable.
 */
export const cleanHttpUrl = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  let raw = stripControl(v).trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`
  if (raw.length > max) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    if (!url.hostname.includes('.')) return null
    if (!isPublicHostname(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * One-line display text from an untrusted source (page titles, API
 * descriptions): control characters out, all whitespace runs collapsed
 * to a single space, trimmed and capped. Empty results read as null so
 * callers can fall through to the next candidate.
 */
export const cleanInlineText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const flat = stripControl(v).replace(/\s+/g, ' ').trim().slice(0, max).trim()
  return flat.length > 0 ? flat : null
}
