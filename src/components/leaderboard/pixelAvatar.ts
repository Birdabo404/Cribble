// Avatar → coarse luminance grid for the CRT attract screen. Cells map to
// block glyphs (' ' ░ ▒ ▓ █) rendered in phosphor amber, so any avatar
// becomes monochrome terminal art. Sampling happens on an offscreen canvas
// with crossOrigin='anonymous'; a tainted canvas or a load failure resolves
// null so the caller can fall back to a plain pixelated <img>. Players with
// no avatar at all get a deterministic identicon sprite instead.

export type PixelGrid = {
  cols: number
  rows: number
  /** Row-major luminance, contrast-stretched to 0..1. */
  lum: Float32Array
}

// 30×18 cells ≈ square on screen: a mono glyph box is ~0.6em wide × 1em
// tall, so the vertical squash applied here (18 rows for 30 cols) cancels
// against the glyph aspect when drawn at line-height 1.
export const AVATAR_COLS = 30
export const AVATAR_ROWS = 18

const GLYPHS = [' ', '░', '▒', '▓', '█'] as const

export function glyphFor(lum: number): string {
  if (lum < 0.14) return GLYPHS[0]
  if (lum < 0.36) return GLYPHS[1]
  if (lum < 0.58) return GLYPHS[2]
  if (lum < 0.8) return GLYPHS[3]
  return GLYPHS[4]
}

const LOAD_TIMEOUT_MS = 4000

function sampleGrid(
  img: HTMLImageElement,
  cols: number,
  rows: number
): PixelGrid | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = cols
    canvas.height = rows
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, cols, rows)
    const data = ctx.getImageData(0, 0, cols, rows).data
    const lum = new Float32Array(cols * rows)
    let min = 1
    let max = 0
    for (let i = 0; i < lum.length; i++) {
      const o = i * 4
      const alpha = data[o + 3] / 255
      const y =
        ((0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) /
          255) *
        alpha
      lum[i] = y
      if (y < min) min = y
      if (y > max) max = y
    }
    // Contrast stretch so dark or washed-out avatars still read on phosphor.
    const range = max - min
    if (range > 0.001) {
      for (let i = 0; i < lum.length; i++) lum[i] = (lum[i] - min) / range
    }
    return { cols, rows, lum }
  } catch {
    return null
  }
}

export type ImageGridResult = {
  grid: PixelGrid | null
  /** True when the image request itself failed — the URL is dead (e.g. a
   *  rotted twimg avatar), so an <img> fallback would paint a broken box
   *  too. False on timeout or tainted canvas, where the image may still
   *  render fine as a plain <img>. */
  dead: boolean
}

/** Downsample an image to a luminance grid. grid is null when the image
 *  fails to load, hangs past the timeout (a wedged request must not stall
 *  awaited callers like the attract loop's advance()), or the canvas is
 *  tainted (host without CORS headers) — `dead` tells those apart. If the
 *  load succeeds after the timeout already resolved null, `onLate`
 *  delivers the grid so callers can repair a cached failure. */
export async function imageGrid(
  src: string,
  cols: number = AVATAR_COLS,
  rows: number = AVATAR_ROWS,
  onLate?: (grid: PixelGrid) => void
): Promise<ImageGridResult> {
  if (typeof document === 'undefined') return { grid: null, dead: false }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  const loaded = new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = src
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const winner = await Promise.race([
    loaded,
    new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), LOAD_TIMEOUT_MS)
    })
  ])
  clearTimeout(timer)
  if (winner === 'timeout') {
    if (onLate) {
      void loaded.then((ok) => {
        if (!ok) return
        const grid = sampleGrid(img, cols, rows)
        if (grid) onLate(grid)
      })
    }
    return { grid: null, dead: false }
  }
  if (!winner) return { grid: null, dead: true }
  return { grid: sampleGrid(img, cols, rows), dead: false }
}

/* Deterministic sprite for players without an avatar: a chunky,
   horizontally-symmetric pattern seeded from the callsign, like a CRT-era
   identicon. Pattern cells are 3×3 grid cells so the sprite reads as fat
   pixels rather than noise. */

function hashString(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function identiconGrid(
  seed: string,
  cols: number = AVATAR_COLS,
  rows: number = AVATAR_ROWS
): PixelGrid {
  const rand = mulberry32(hashString(seed))
  const lum = new Float32Array(cols * rows)
  const scale = 3
  const pcols = Math.floor(cols / scale)
  const prows = Math.floor(rows / scale)
  const half = Math.ceil(pcols / 2)
  for (let pr = 0; pr < prows; pr++) {
    for (let pc = 0; pc < half; pc++) {
      const on = rand() < 0.52
      const v = on ? 0.55 + rand() * 0.45 : 0
      if (!on) continue
      const mirror = pcols - 1 - pc
      for (let dy = 0; dy < scale; dy++) {
        const r = pr * scale + dy
        if (r >= rows) continue
        for (let dx = 0; dx < scale; dx++) {
          const cA = pc * scale + dx
          const cB = mirror * scale + dx
          if (cA < cols) lum[r * cols + cA] = v
          if (cB < cols) lum[r * cols + cB] = v
        }
      }
    }
  }
  return { cols, rows, lum }
}
