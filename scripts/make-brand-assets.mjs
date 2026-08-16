// One-shot brand asset pipeline. Takes the Cribble hive mark (orange bars
// baked onto an opaque black square) and derives every size/format the site
// needs:
//
//   public/brand/cribble-mark.png       transparent-bg mark (1024, trimmed)
//   public/brand/cribble-mark-tile.png  original black tile, re-encoded (1024)
//   public/favicon.png                  256 transparent mark
//   public/apple-icon.png               180 black tile (iOS wants opaque)
//   src/app/favicon.ico                 16/32/48 PNG-compressed ICO
//
//   Do not also write public/favicon.ico. Next.js maps app/favicon.ico to
//   the /favicon.ico route, and a public file at the same path 500s with
//   conflicting-public-file-page.
//
//   node scripts/make-brand-assets.mjs <source-image>
//
// The black background is keyed out by treating the source as premultiplied-
// over-black: alpha = max(r,g,b), color = color/alpha. That reconstructs the
// antialiased edges exactly instead of leaving a dark halo.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.argv[2]
if (!SRC || !fs.existsSync(SRC)) {
  console.error('usage: node scripts/make-brand-assets.mjs <source-image>')
  process.exit(1)
}

// JPEG-black is noisy (values ~0-10), so anything at/below the floor is
// treated as fully transparent background.
const NOISE_FLOOR = 12
const PADDING_RATIO = 0.08

async function extractTransparentMark() {
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height, channels } = info
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = Math.max(r, g, b)
      if (a <= NOISE_FLOOR) {
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 0
        continue
      }
      // un-premultiply over black
      data[i] = Math.min(255, Math.round((r * 255) / a))
      data[i + 1] = Math.min(255, Math.round((g * 255) / a))
      data[i + 2] = Math.min(255, Math.round((b * 255) / a))
      data[i + 3] = a
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) throw new Error('source image appears to be fully black')

  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1
  const side = Math.max(cropW, cropH)
  const pad = Math.round(side * PADDING_RATIO)
  const canvas = side + pad * 2

  // Separate sharp passes: within one pipeline sharp reorders operations
  // (extract → resize → extend), which would stretch and clip the crop.
  const cropped = await sharp(data, { raw: { width, height, channels } })
    .extract({ left: minX, top: minY, width: cropW, height: cropH })
    .png()
    .toBuffer()

  const squared = await sharp(cropped)
    .extend({
      left: pad + Math.floor((side - cropW) / 2),
      right: pad + Math.ceil((side - cropW) / 2),
      top: pad + Math.floor((side - cropH) / 2),
      bottom: pad + Math.ceil((side - cropH) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer()

  const buf = await sharp(squared).resize(1024, 1024).png().toBuffer()
  return { buf, canvas }
}

// Minimal ICO container with PNG-compressed entries (supported by every
// modern browser; avoids pulling in an ico encoder dependency).
function buildIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const entries = []
  const blobs = []
  let offset = 6 + count * 16
  for (const { size, buf } of pngs) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2) // palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(buf.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += buf.length
    entries.push(entry)
    blobs.push(buf)
  }
  return Buffer.concat([header, ...entries, ...blobs])
}

async function main() {
  const brandDir = path.join(ROOT, 'public', 'brand')
  fs.mkdirSync(brandDir, { recursive: true })

  const { buf: markPng } = await extractTransparentMark()
  const write = (rel, buf) => {
    const abs = path.join(ROOT, rel)
    fs.writeFileSync(abs, buf)
    console.log(`${rel}  ${(buf.length / 1024).toFixed(1)}kb`)
  }

  write('public/brand/cribble-mark.png', markPng)

  const tile = await sharp(SRC).resize(1024, 1024).png().toBuffer()
  write('public/brand/cribble-mark-tile.png', tile)

  write(
    'public/favicon.png',
    await sharp(markPng).resize(256, 256).png().toBuffer()
  )
  write(
    'public/apple-icon.png',
    await sharp(SRC).resize(180, 180).png().toBuffer()
  )

  const icoSizes = [16, 32, 48]
  const icoPngs = await Promise.all(
    icoSizes.map(async (size) => ({
      size,
      buf: await sharp(markPng).resize(size, size).png().toBuffer()
    }))
  )
  write('src/app/favicon.ico', buildIco(icoPngs))

  // A leftover public copy collides with the app-route ICO above.
  const stalePublicIco = path.join(ROOT, 'public/favicon.ico')
  if (fs.existsSync(stalePublicIco)) fs.unlinkSync(stalePublicIco)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
