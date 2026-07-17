import { describe, expect, it } from 'vitest'
import {
  detectAnimatedImage,
  isPublicHostname,
  isPublicIpAddress,
  sniffAnimatedImage
} from './imageAnimation'

// Pure byte-sniffing tests — synthetic file headers, no network.

const bytes = (...parts: (string | number[] | Uint8Array)[]): Uint8Array => {
  const encoded = parts.map((p) => {
    if (typeof p === 'string') return Uint8Array.from(p, (c) => c.charCodeAt(0))
    if (Array.isArray(p)) return Uint8Array.from(p)
    return p
  })
  const out = new Uint8Array(encoded.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of encoded) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/* ---------------------------- GIF fixtures -------------------------- */

// 1×1 logical screen, no global color table.
const GIF_HEADER = bytes('GIF89a', [1, 0, 1, 0, 0x00, 0x00, 0x00])

// Image descriptor (1×1, no local color table) + LZW min code size +
// one 2-byte data sub-block + terminator.
const GIF_FRAME = bytes(
  [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00],
  [0x02],
  [0x02, 0xaa, 0xbb],
  [0x00]
)

const GIF_TRAILER = bytes([0x3b])

const GIF_NETSCAPE_EXT = bytes(
  [0x21, 0xff, 0x0b],
  'NETSCAPE2.0',
  [0x03, 0x01, 0x00, 0x00, 0x00]
)

/* ---------------------------- PNG fixtures -------------------------- */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const pngChunk = (type: string, data: number[]) =>
  bytes(
    [
      (data.length >>> 24) & 0xff,
      (data.length >>> 16) & 0xff,
      (data.length >>> 8) & 0xff,
      data.length & 0xff
    ],
    type,
    data,
    [0, 0, 0, 0] // CRC — the sniffer never checks it
  )

const IHDR = pngChunk('IHDR', Array(13).fill(0))
const ACTL = pngChunk('acTL', Array(8).fill(0))
const IDAT = pngChunk('IDAT', [0x78, 0x9c, 0x00])

/* ---------------------------- WebP fixtures ------------------------- */

const webp = (fourcc: string, payload: number[]) =>
  bytes('RIFF', [0x40, 0, 0, 0], 'WEBP', fourcc, [10, 0, 0, 0], payload)

/* -------------------------------------------------------------------- */

describe('sniffAnimatedImage', () => {
  it('single-frame GIF with a clean trailer is static', () => {
    expect(sniffAnimatedImage(bytes(GIF_HEADER, GIF_FRAME, GIF_TRAILER))).toBe(false)
  })

  it('two image descriptors mean animated GIF', () => {
    expect(
      sniffAnimatedImage(bytes(GIF_HEADER, GIF_FRAME, GIF_FRAME, GIF_TRAILER))
    ).toBe(true)
  })

  it('NETSCAPE looping extension means animated GIF, before any frame', () => {
    expect(
      sniffAnimatedImage(bytes(GIF_HEADER, GIF_NETSCAPE_EXT, GIF_FRAME, GIF_TRAILER))
    ).toBe(true)
  })

  it('walks a global color table without misreading it as blocks', () => {
    // packed 0x80 | size 0 → 2-entry GCT (6 bytes)
    const headerWithGct = bytes(
      'GIF89a',
      [1, 0, 1, 0, 0x80, 0x00, 0x00],
      [1, 2, 3, 4, 5, 6]
    )
    expect(sniffAnimatedImage(bytes(headerWithGct, GIF_FRAME, GIF_TRAILER))).toBe(false)
  })

  it('truncated GIF (no trailer inside the sniff window) counts as animated', () => {
    // documented conservative choice: undecidable GIFs fail toward the gate
    const truncated = bytes(GIF_HEADER, [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, 0x02, 0xff])
    expect(sniffAnimatedImage(truncated)).toBe(true)
  })

  it('animated WebP sets the VP8X ANIM flag', () => {
    expect(sniffAnimatedImage(webp('VP8X', [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true)
  })

  it('extended WebP without the ANIM flag is static', () => {
    expect(sniffAnimatedImage(webp('VP8X', [0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false)
  })

  it('simple lossy/lossless WebP containers are static', () => {
    expect(sniffAnimatedImage(webp('VP8 ', Array(10).fill(0)))).toBe(false)
    expect(sniffAnimatedImage(webp('VP8L', Array(10).fill(0)))).toBe(false)
  })

  it('APNG carries acTL before IDAT', () => {
    expect(sniffAnimatedImage(bytes(PNG_SIG, IHDR, ACTL, IDAT))).toBe(true)
  })

  it('plain PNG reaches IDAT with no acTL', () => {
    expect(sniffAnimatedImage(bytes(PNG_SIG, IHDR, IDAT))).toBe(false)
  })

  it('PNG truncated before acTL/IDAT is unknown', () => {
    expect(sniffAnimatedImage(bytes(PNG_SIG, [0, 0]))).toBeNull()
  })

  it('JPEG can never animate', () => {
    expect(sniffAnimatedImage(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'))).toBe(false)
  })

  it('unrecognized bytes are unknown', () => {
    expect(sniffAnimatedImage(bytes('<html>not an image</html>'))).toBeNull()
    expect(sniffAnimatedImage(new Uint8Array(0))).toBeNull()
  })
})

describe('banner SSRF destination policy', () => {
  it('allows globally routable IPv4 and IPv6 addresses', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true)
    expect(isPublicIpAddress('1.1.1.1')).toBe(true)
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true)
  })

  it('blocks loopback, private, link-local, metadata and reserved IPv4 ranges', () => {
    for (const address of [
      '0.0.0.1',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255'
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false)
    }
  })

  it('blocks loopback, unique-local, link-local and mapped IPv6 ranges', () => {
    for (const address of [
      '::',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1'
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false)
    }
  })

  it('blocks internal host suffixes while allowing normal public hosts', () => {
    for (const hostname of [
      'localhost',
      'api.localhost',
      'printer.local',
      'metadata.google.internal',
      'router.lan',
      'server.home'
    ]) {
      expect(isPublicHostname(hostname), hostname).toBe(false)
    }
    expect(isPublicHostname('media.klipy.com')).toBe(true)
    expect(isPublicHostname('images.example.com')).toBe(true)
  })

  it('refuses literal loopback and metadata fetches before opening a socket', async () => {
    await expect(detectAnimatedImage('http://127.0.0.1/banner.gif')).resolves.toBeNull()
    await expect(
      detectAnimatedImage('http://169.254.169.254/latest/meta-data/')
    ).resolves.toBeNull()
    await expect(detectAnimatedImage('http://[::1]/banner.gif')).resolves.toBeNull()
  })
})
