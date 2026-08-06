import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

// Server-side animated-image detection for the Pro banner gate.
//
// PATCH /api/user/profile runs this when a banner URL is set or changed:
// animated banners are a Pro perk. Detection is best-effort by design —
// only the head of the file is fetched (Range request first, capped
// stream read for origins that ignore Range) and the container is
// byte-sniffed. `null` means "couldn't tell" (network failure, timeout,
// unknown format) and callers fail OPEN: blocking a profile save over a
// flaky image host would hurt more than one slipped GIF.

const FETCH_TIMEOUT_MS = 4_000
const SNIFF_BYTES = 512 * 1024
const MAX_REDIRECTS = 5

// Keep families separate: Node's BlockList maps IPv4 checks into
// ::ffff:0:0/96 when IPv4 and IPv6 rules share one instance.
const BLOCKED_IPV4 = new BlockList()
const BLOCKED_IPV6 = new BlockList()

// IPv4 addresses that are not globally routable: unspecified, private,
// carrier-grade NAT, loopback, link-local/metadata, protocol/test ranges,
// multicast and reserved space.
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4')
}

// IPv6 unspecified/compatible, loopback, discard, documentation,
// transition, unique-local, link-local and multicast ranges.
for (const [network, prefix] of [
  ['::', 96],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['100::', 64],
  ['2001:10::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6')
}

/** Public for outbound banner fetch purposes (strictly globally routable). */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !BLOCKED_IPV4.check(address, 'ipv4')
  if (family === 6) return !BLOCKED_IPV6.check(address, 'ipv6')
  return false
}

/** Hostnames commonly resolved only inside a machine/private network. */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost') return false
  if (
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home')
  ) {
    return false
  }
  if (isIP(host)) return isPublicIpAddress(host)
  return true
}

export interface ResolvedPublicAddress {
  address: string
  family: 4 | 6
}

/**
 * Resolve once, reject the whole hostname if ANY answer is private, then
 * pin the HTTP request to a validated answer. Rejecting mixed DNS answers
 * and pinning closes DNS-rebinding/TOCTOU pivots.
 */
export async function resolvePublicAddress(target: URL): Promise<ResolvedPublicAddress | null> {
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  if (!isPublicHostname(hostname)) return null

  const literalFamily = isIP(hostname)
  if (literalFamily === 4 || literalFamily === 6) {
    return { address: hostname, family: literalFamily }
  }

  const answers = await lookup(hostname, { all: true, verbatim: true })
  if (answers.length === 0 || answers.some((answer) => !isPublicIpAddress(answer.address))) {
    return null
  }

  const answer = answers[0]!
  if (answer.family !== 4 && answer.family !== 6) return null
  return { address: answer.address, family: answer.family }
}

/**
 * Fetch the first ~512KB of an image URL and byte-sniff for animation.
 * true = definitely animated · false = definitely static · null = unknown.
 * Only http/https URLs with public DNS destinations are fetched. Every
 * redirect is resolved and validated again, and each request is pinned to
 * the address that passed validation.
 */
export async function detectAnimatedImage(url: string): Promise<boolean | null> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  if (
    (target.protocol !== 'http:' && target.protocol !== 'https:') ||
    target.username ||
    target.password
  ) {
    return null
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const bytes = await fetchFirstBytes(target, controller.signal)
    return bytes && bytes.length > 0 ? sniffAnimatedImage(bytes) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchFirstBytes(initial: URL, signal: AbortSignal): Promise<Uint8Array | null> {
  let target = initial
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const resolved = await resolvePublicAddress(target)
    if (!resolved) return null

    const res = await requestPinned(target, resolved, signal)

    if (res.status >= 300 && res.status < 400) {
      const location = res.location
      if (!location) return null
      let next: URL
      try {
        next = new URL(location, target)
      } catch {
        return null
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return null
      if (next.username || next.password) return null
      target = next
      continue
    }

    if (res.status < 200 || res.status >= 300) return null
    return res.bytes
  }
  return null
}

interface PinnedResponse {
  status: number
  location: string | null
  bytes: Uint8Array | null
}

/**
 * Preserve the original hostname for Host/TLS SNI while forcing the
 * socket lookup to the already-validated address.
 */
async function requestPinned(
  target: URL,
  resolved: ResolvedPublicAddress,
  signal: AbortSignal
): Promise<PinnedResponse> {
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'GET',
        signal,
        headers: {
          Range: `bytes=0-${SNIFF_BYTES - 1}`,
          Accept: 'image/*,*/*;q=0.8'
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.address, resolved.family)
        }
      },
      resolve
    )
    req.once('error', reject)
    req.end()
  })

  const status = response.statusCode ?? 0
  const locationHeader = response.headers.location
  const location = Array.isArray(locationHeader) ? locationHeader[0] ?? null : locationHeader ?? null

  if (status >= 300 && status < 400) {
    response.destroy()
    return { status, location, bytes: null }
  }
  if (status < 200 || status >= 300) {
    response.destroy()
    return { status, location: null, bytes: null }
  }

  return { status, location: null, bytes: await readUpTo(response, SNIFF_BYTES) }
}

/** Read at most `limit` bytes from a response, then close the transfer. */
async function readUpTo(stream: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of stream) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk)
      const remaining = limit - total
      if (remaining <= 0) break
      const accepted = bytes.subarray(0, remaining)
      chunks.push(accepted)
      total += accepted.byteLength
      if (total >= limit) break
    }
  } finally {
    stream.destroy()
  }

  const out = new Uint8Array(Math.min(total, limit))
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= out.length) break
    const slice = chunk.subarray(0, out.length - offset)
    out.set(slice, offset)
    offset += slice.byteLength
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Byte sniffing — pure functions, unit-tested without any network.    */
/* ------------------------------------------------------------------ */

/**
 * Sniff an image header for animation.
 * true/false are definitive reads of the container; null = format we
 * don't recognize (AVIF & co.) or too little data to decide.
 */
export function sniffAnimatedImage(bytes: Uint8Array): boolean | null {
  if (isGif(bytes)) return sniffGif(bytes)
  if (isWebp(bytes)) return sniffWebp(bytes)
  if (isPng(bytes)) return sniffPng(bytes)
  // JPEG has no animation variant.
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return false
  }
  return null
}

const ascii = (bytes: Uint8Array, start: number, text: string): boolean => {
  if (start + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[start + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/* ---------------------------- GIF ---------------------------------- */

const isGif = (b: Uint8Array) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')

/** Advance past length-prefixed data sub-blocks to just after the 0x00 terminator. */
function skipSubBlocks(bytes: Uint8Array, pos: number): number {
  while (pos < bytes.length) {
    const len = bytes[pos]
    pos += 1
    if (len === 0) return pos
    pos += len
  }
  return bytes.length
}

/**
 * Walk the GIF block stream counting image descriptors. Animated when a
 * second frame or a NETSCAPE looping extension shows up; a clean parse to
 * the trailer with a single frame is static. Documented choice: if the
 * stream is truncated (single frame not fully inside the sniff window) or
 * corrupt, report animated — banner-sized static GIFs parse comfortably
 * within 512KB, and over-flagging an oversized static GIF (re-encode as
 * PNG) beats letting animated ones through the Pro gate.
 */
function sniffGif(bytes: Uint8Array): boolean {
  let pos = 6
  if (pos + 7 > bytes.length) return true
  const packed = bytes[pos + 4]
  pos += 7
  if (packed & 0x80) pos += 3 * 2 ** ((packed & 0x07) + 1) // global color table

  let frames = 0
  while (pos < bytes.length) {
    const block = bytes[pos]
    pos += 1

    if (block === 0x3b) return frames > 1 // trailer — complete parse

    if (block === 0x21) {
      if (pos >= bytes.length) break
      const label = bytes[pos]
      pos += 1
      if (label === 0xff && bytes[pos] === 11 && ascii(bytes, pos + 1, 'NETSCAPE2.0')) {
        return true // looping-animation application extension
      }
      pos = skipSubBlocks(bytes, pos)
    } else if (block === 0x2c) {
      frames += 1
      if (frames > 1) return true
      if (pos + 9 > bytes.length) break
      const localPacked = bytes[pos + 8]
      pos += 9
      if (localPacked & 0x80) pos += 3 * 2 ** ((localPacked & 0x07) + 1) // local color table
      pos += 1 // LZW minimum code size
      pos = skipSubBlocks(bytes, pos)
    } else {
      break // corrupt stream
    }
  }
  return true // truncated/corrupt — undecided GIFs count as animated
}

/* ---------------------------- WebP --------------------------------- */

const isWebp = (b: Uint8Array) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')

/** Animated WebP = extended (VP8X) header with the ANIM flag (bit 1) set. */
function sniffWebp(bytes: Uint8Array): boolean | null {
  if (bytes.length < 21) return null
  if (ascii(bytes, 12, 'VP8X')) return (bytes[20] & 0x02) !== 0
  // Simple lossy/lossless container — single image by definition.
  if (ascii(bytes, 12, 'VP8 ') || ascii(bytes, 12, 'VP8L')) return false
  return null
}

/* ---------------------------- PNG / APNG --------------------------- */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const isPng = (b: Uint8Array) =>
  b.length >= PNG_SIG.length && PNG_SIG.every((v, i) => b[i] === v)

/** APNG marks itself with an acTL chunk before the first IDAT. */
function sniffPng(bytes: Uint8Array): boolean | null {
  let pos = 8
  while (pos + 8 <= bytes.length) {
    const length =
      bytes[pos] * 0x1000000 + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3]
    const type = String.fromCharCode(
      bytes[pos + 4],
      bytes[pos + 5],
      bytes[pos + 6],
      bytes[pos + 7]
    )
    if (type === 'acTL') return true
    if (type === 'IDAT') return false
    pos += 12 + length // length + type + data + CRC
  }
  return null // truncated before acTL/IDAT could be seen
}
