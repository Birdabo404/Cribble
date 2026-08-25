// SERVER-ONLY billboard helpers: URL validation (cleanBillboardUrl),
// inline-logo validation (parseBillboardLogoDataUri) and the logo
// accent-color extraction (extractAccentColor / the buffer-level
// extractAccentFromImageBuffer). The pinned accent fetch pulls in
// node:dns / node:net / node:http(s) and sharp is a native module, so
// this module must never be imported from a 'use client' file — the
// isomorphic billboard contract (types, constants, isLiveAd) lives in
// @/lib/billboard instead.

import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'

import {
  isPublicHostname,
  resolvePublicAddress,
  type ResolvedPublicAddress
} from '@/lib/imageAnimation'

const URL_MAX_DEFAULT = 300

const stripControl = (v: string) =>
  // eslint-disable-next-line no-control-regex
  v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')

/**
 * Ad link/logo URL validation, same rules as the profile route's
 * cleanHttpUrl: strip control chars, coerce to https, require a dotted
 * hostname, drop credentialed URLs, and reject non-public hosts.
 * isPublicHostname is a NAME-level screen only (IP literals, localhost
 * and .local-style suffixes) for URLs that ship to every viewer's
 * browser — it never resolves DNS, so a public-looking domain can still
 * point at a private address. The server-side accent fetch below layers
 * the resolve-and-pin guard on top before it opens any connection.
 * Returns the normalized URL, or null when the value isn't storable.
 */
export function cleanBillboardUrl(value: unknown, maxLen: number = URL_MAX_DEFAULT): string | null {
  if (typeof value !== 'string') return null
  let raw = stripControl(value).trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`
  if (raw.length > maxLen) return null
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

/* ------------------------------------------------------------------ */
/* Inline (uploaded) logo validation — the data-URI counterpart of the */
/* URL bar above, for logos minted by POST /api/billboard/logo.        */
/* ------------------------------------------------------------------ */

export const BILLBOARD_LOGO_DATA_URI_PREFIX = 'data:image/webp;base64,'
/** Decoded-byte ceiling the submit routes admit. The upload route
 *  encodes to 48KB, so the gap is headroom for its own output — never
 *  a target for clients to fill. */
const LOGO_DATA_MAX_DECODED_BYTES = 64 * 1024
/** base64 spends 4 chars per 3 bytes, so oversize payloads are refused
 *  on string length before paying for a decode. */
const LOGO_DATA_MAX_BASE64_CHARS = Math.ceil(LOGO_DATA_MAX_DECODED_BYTES / 3) * 4
/** Hard cap on an inline logo's pixel dimensions — exactly what the
 *  upload route emits at its largest. */
export const BILLBOARD_LOGO_MAX_DIM = 256

/**
 * Validate an uploaded-logo data URI down to its decoded bytes, or null
 * when the value isn't storable. This is the submit-side gate, NOT a
 * convenience parser: clients can bypass POST /api/billboard/logo and
 * PATCH any string into logo_url, so a data URI is never trusted as
 * that route's output — it must independently prove it is exactly the
 * shape the route mints. Strict on every axis:
 *   - the literal `data:image/webp;base64,` prefix (no parameters, no
 *     other mime, no unencoded payloads);
 *   - base64 that decodes cleanly — charset/padding-checked and
 *     round-trip compared, so non-canonical encodings are refused;
 *   - decoded size <= 64KB;
 *   - sharp's header read confirms real webp within 256x256.
 */
export async function parseBillboardLogoDataUri(value: unknown): Promise<Buffer | null> {
  if (typeof value !== 'string') return null
  if (!value.startsWith(BILLBOARD_LOGO_DATA_URI_PREFIX)) return null
  const base64 = value.slice(BILLBOARD_LOGO_DATA_URI_PREFIX.length)
  if (base64.length === 0 || base64.length > LOGO_DATA_MAX_BASE64_CHARS) return null
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null

  const image = Buffer.from(base64, 'base64')
  // Node's decoder is lenient; the re-encode round trip is what makes
  // "decodes cleanly" strict (canonical padding and trailing bits).
  if (image.toString('base64') !== base64) return null
  if (image.byteLength > LOGO_DATA_MAX_DECODED_BYTES) return null

  try {
    // Lazy sharp import, same stance as the accent extractors below.
    const { default: sharp } = await import('sharp')
    // metadata() only reads the container header — cheap, no pixel
    // decode — which is exactly enough to prove format and dimensions.
    const meta = await sharp(image).metadata()
    if (meta.format !== 'webp') return null
    if (!meta.width || !meta.height) return null
    if (meta.width > BILLBOARD_LOGO_MAX_DIM || meta.height > BILLBOARD_LOGO_MAX_DIM) return null
    return image
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Accent color extraction — the sub-banner tint behind each live ad.  */
/* ------------------------------------------------------------------ */

const ACCENT_FETCH_TIMEOUT_MS = 5_000
const ACCENT_MAX_BYTES = 2 * 1024 * 1024
// Bound the DECODE as well as the download: 2MB of PNG can inflate to
// hundreds of megapixels under sharp's default ~268MP ceiling.
const ACCENT_MAX_PIXELS = 4096 * 4096
// The dominant color comes from a coarse 4096-bin histogram, so a small
// sample loses nothing while keeping stats cheap on huge logos.
const ACCENT_SAMPLE_PX = 64
// Legibility clamp: enough chroma to read as a brand tint, never so
// vivid or so close to black/white that the sub-banner text drowns on
// either theme.
const ACCENT_SATURATION: readonly [number, number] = [0.35, 0.85]
const ACCENT_LIGHTNESS: readonly [number, number] = [0.42, 0.62]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** r/g/b 0-255 -> [h, s, l], each in [0, 1]. */
function rgbToHsl(r255: number, g255: number, b255: number): [number, number, number] {
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l] // achromatic
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function hueToChannel(p: number, q: number, t: number): number {
  let x = t
  if (x < 0) x += 1
  if (x > 1) x -= 1
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

/** [h, s, l] each in [0, 1] -> r/g/b 0-255. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    Math.round(hueToChannel(p, q, h) * 255),
    Math.round(hueToChannel(p, q, h - 1 / 3) * 255)
  ]
}

/** Read a response body up to maxBytes; null = the cap was exceeded. */
async function readBodyCapped(body: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of body) {
      const bytes: Buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      total += bytes.byteLength
      if (total > maxBytes) return null
      chunks.push(bytes)
    }
  } finally {
    body.destroy()
  }
  return Buffer.concat(chunks, total)
}

/**
 * Same connection pinning as imageAnimation's banner fetch: the request
 * keeps the original hostname for the Host header and TLS SNI, but the
 * socket lookup is forced to the DNS answer that already passed
 * resolvePublicAddress, so nothing re-resolves between check and connect.
 */
function requestPinned(
  target: URL,
  resolved: ResolvedPublicAddress,
  signal: AbortSignal
): Promise<IncomingMessage> {
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'GET',
        signal,
        headers: { Accept: 'image/*' },
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.address, resolved.family)
        }
      },
      resolve
    )
    req.once('error', reject)
    req.end()
  })
}

/**
 * Buffer-level tail of the accent pipeline: sharp's dominant color from
 * image bytes already in hand, clamped to the legibility ranges above.
 * Shared by the URL fetch below and the logo-upload path, which holds
 * the uploaded bytes in memory and must never turn them back into a
 * fetch. Returns lowercase '#rrggbb' (the exact shape migration 031's
 * CHECK admits); best-effort like its caller — any decode or sharp
 * import failure returns null, never throws.
 */
export async function extractAccentFromImageBuffer(image: Buffer): Promise<string | null> {
  try {
    // Lazy import — deliberate exception to the imports-at-top rule:
    // sharp is a heavy native module, and loading it per call keeps it
    // out of the route modules' import graph, so a missing platform
    // binary degrades only accent extraction instead of the routes.
    const { default: sharp } = await import('sharp')

    // sharp's stats() reads the ORIGINAL input and ignores pipeline
    // operations, so downsampling must materialize a small buffer first.
    const sample = await sharp(image, { limitInputPixels: ACCENT_MAX_PIXELS })
      .resize(ACCENT_SAMPLE_PX, ACCENT_SAMPLE_PX, { fit: 'inside', withoutEnlargement: true })
      .toBuffer()
    const { dominant } = await sharp(sample).stats()

    const [h, s, l] = rgbToHsl(dominant.r, dominant.g, dominant.b)
    const [r, g, b] = hslToRgb(h, clamp(s, ...ACCENT_SATURATION), clamp(l, ...ACCENT_LIGHTNESS))
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  } catch {
    return null
  }
}

/**
 * Derive an ad's sub-banner accent from its logo (or the owner-avatar
 * fallback): fetch the image, take sharp's dominant color, then clamp
 * saturation to [0.35, 0.85] and lightness to [0.42, 0.62] in HSL so
 * the tint stays legible on both themes. Returns lowercase '#rrggbb' —
 * the exact shape migration 031's CHECK admits.
 *
 * Best-effort by design: ANY failure (invalid URL, private or mixed
 * DNS answers, redirect, timeout, non-image response, oversize body,
 * decode error, sharp import failure) returns null — never throws —
 * and the ad renders neutral.
 *
 * Fetch defenses, since the URL is attacker-supplied content fetched
 * from the server: it is re-validated with cleanBillboardUrl at call
 * time (not just at submit validation), then routed through the same
 * resolve-and-pin guard as the profile-banner fetch —
 * resolvePublicAddress resolves the hostname once, rejects it if ANY
 * DNS answer is a private/metadata address, and requestPinned connects
 * the socket to that vetted address only, so a rebinding DNS record
 * can't swap in an internal IP between validation and connect.
 * Redirect responses are refused outright so a 30x can't bounce the
 * request to a host that never faced validation, the request is cut
 * off after 5s, and the body is capped at 2MB — up front via
 * content-length AND while the stream is read, because content-length
 * is client-controlled.
 */
export async function extractAccentColor(logoUrl: string): Promise<string | null> {
  const url = cleanBillboardUrl(logoUrl)
  if (!url) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ACCENT_FETCH_TIMEOUT_MS)
  try {
    const target = new URL(url)
    const resolved = await resolvePublicAddress(target)
    if (!resolved) return null

    const res = await requestPinned(target, resolved, controller.signal)

    const status = res.statusCode ?? 0
    const contentType = (res.headers['content-type'] ?? '').trim().toLowerCase()
    const declaredBytes = res.headers['content-length']
    if (
      status < 200 ||
      status >= 300 || // 3xx lands here: redirects are refused, never followed
      !contentType.startsWith('image/') ||
      (declaredBytes !== undefined && Number(declaredBytes) > ACCENT_MAX_BYTES)
    ) {
      res.destroy() // drop the connection, don't drain the body
      return null
    }

    const image = await readBodyCapped(res, ACCENT_MAX_BYTES)
    if (!image) return null

    return await extractAccentFromImageBuffer(image)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
