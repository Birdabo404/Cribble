import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  BILLBOARD_LOGO_DATA_URI_PREFIX,
  parseBillboardLogoDataUri
} from './billboardServer'

// The submit-side gate for uploaded logos. Clients can bypass
// POST /api/billboard/logo and PATCH any string into logo_url, so the
// validator must independently prove a data URI is exactly the shape
// that route mints: the literal webp prefix, canonical base64, a 64KB
// decoded ceiling and a real webp container within 256x256. Fixtures
// are generated with sharp so every accept/reject decision is exercised
// against real containers, never hand-rolled magic bytes.

const PREFIX = BILLBOARD_LOGO_DATA_URI_PREFIX

/** A flat-color webp of the given dimensions, alpha channel included. */
const webpFixture = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } }
  })
    .webp()
    .toBuffer()

const toDataUri = (image: Buffer) => `${PREFIX}${image.toString('base64')}`

describe('parseBillboardLogoDataUri', () => {
  it('accepts a small webp and returns its exact decoded bytes', async () => {
    const webp = await webpFixture(64, 48)
    const parsed = await parseBillboardLogoDataUri(toDataUri(webp))
    expect(parsed).not.toBeNull()
    expect(parsed!.equals(webp)).toBe(true)
  })

  it('accepts the 256x256 boundary exactly', async () => {
    const webp = await webpFixture(256, 256)
    await expect(parseBillboardLogoDataUri(toDataUri(webp))).resolves.not.toBeNull()
  })

  it('rejects non-strings, URLs and empty payloads', async () => {
    await expect(parseBillboardLogoDataUri(undefined)).resolves.toBeNull()
    await expect(parseBillboardLogoDataUri(42)).resolves.toBeNull()
    await expect(parseBillboardLogoDataUri('https://example.com/logo.webp')).resolves.toBeNull()
    await expect(parseBillboardLogoDataUri('')).resolves.toBeNull()
    // The bare prefix with nothing behind it.
    await expect(parseBillboardLogoDataUri(PREFIX)).resolves.toBeNull()
  })

  it('rejects any mime label other than the exact webp prefix', async () => {
    // Real png bytes wearing their honest png label — wrong mime.
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } }
    })
      .png()
      .toBuffer()
    await expect(
      parseBillboardLogoDataUri(`data:image/png;base64,${png.toString('base64')}`)
    ).resolves.toBeNull()
    // A parameterized webp prefix is not the literal prefix.
    const webp = await webpFixture(8, 8)
    await expect(
      parseBillboardLogoDataUri(
        `data:image/webp;charset=utf-8;base64,${webp.toString('base64')}`
      )
    ).resolves.toBeNull()
  })

  it('rejects corrupt and non-canonical base64', async () => {
    // Characters outside the base64 alphabet.
    await expect(parseBillboardLogoDataUri(`${PREFIX}!!!!`)).resolves.toBeNull()
    // Length not a multiple of 4.
    await expect(parseBillboardLogoDataUri(`${PREFIX}abcde`)).resolves.toBeNull()
    // Decodes under Node's lenient decoder, but the trailing bits are
    // non-canonical ('aaa=' re-encodes as 'aaY=') — refused by the
    // round-trip check.
    await expect(parseBillboardLogoDataUri(`${PREFIX}aaa=`)).resolves.toBeNull()
  })

  it('rejects payloads whose decoded size exceeds 64KB', async () => {
    const oversized = Buffer.alloc(64 * 1024 + 1, 7)
    await expect(parseBillboardLogoDataUri(toDataUri(oversized))).resolves.toBeNull()
  })

  it('rejects non-webp bytes hiding behind the webp prefix', async () => {
    // A real image in the wrong container...
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } }
    })
      .png()
      .toBuffer()
    await expect(parseBillboardLogoDataUri(toDataUri(png))).resolves.toBeNull()
    // ...and bytes that are no image at all.
    await expect(
      parseBillboardLogoDataUri(toDataUri(Buffer.from('definitely not an image')))
    ).resolves.toBeNull()
  })

  it('rejects dimension overflow on either axis', async () => {
    const wide = await webpFixture(300, 100)
    await expect(parseBillboardLogoDataUri(toDataUri(wide))).resolves.toBeNull()
    const tall = await webpFixture(100, 257)
    await expect(parseBillboardLogoDataUri(toDataUri(tall))).resolves.toBeNull()
  })
})
