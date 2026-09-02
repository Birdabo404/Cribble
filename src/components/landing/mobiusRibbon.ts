// MÖBIUS RIBBON — the Touchdown sheet's ∞, drawn instead of typeset.
//
// A lime ribbon traced along a lemniscate of Bernoulli (the ∞ curve, lobes
// fattened to the typographic proportion) carrying one real Möbius
// half-twist: its width vector turns 180° over the loop, so the strip
// closes onto itself flipped, turns edge-on twice, and its lit face slides
// around the loop as the twist phase rolls. It is real 3D — quads rotated
// by the caller's pitch/yaw and perspective-projected — painted back to
// front (painter's sort) with a 1px sheet-colored hairline along each
// long edge. The near strand's fill covers the far strand's hairlines at
// the crossing, which is exactly a knot diagram's over/under gap; nothing
// is special-cased there. Shading is |n·view| quantized to four flat
// bands, lime mixed toward the sheet color and never a second hue; the two
// darkest bands get a 1-bit dot screen in the sheet color, echoing the
// dithered globe.
//
// Why Canvas 2D: a WebGL context and a shader compile for one glyph is
// disproportionate, and SVG would mean ~128 `d` attribute writes per frame.
// 128 quads plus hairlines on a small transparent canvas is well under half
// a millisecond, and the dither comes free as a CanvasPattern.
//
// Two geometric notes. The strip's seam (t = 0 ≡ 2π) is invisible because
// the width vector flips sign there — edgeA(2π) = edgeB(0) — and shading
// reads |n_z|, which is continuous through a sign flip of the normal. And
// the centerline is lifted out of the plane (z = LIFT·sin t) so the two
// strands through the crossing sit ±LIFT apart: a real ribbon can't pass
// through itself, and the depth sort needs a definite over/under there
// rather than a coin toss on equal depths.
//
// Pure TS, React-free, no DOM access at module load; createMobiusRibbon
// degrades to a no-op object when there is no 2D context, so the pure
// helpers (lemniscate, mobiusFrame, shadeBand) import cleanly under node.

export type Vec3 = { x: number; y: number; z: number }

export type RibbonColors = {
  /** The lime — any CSS color string the browser resolves. */
  signal: string
  /** Page/sheet background: the shade target, the dither dots, the hairlines. */
  sheet: string
  /** Crosshair ink. */
  ink: string
}

export type RibbonPose = {
  /** Radians; the Möbius twist roll. Any real, wraps naturally. */
  phase: number
  /** 0..1 draw-in progress along the loop, measured from the crossing. */
  drawn: number
  /** Radians about X. Positive tips the top of the loop away from the viewer. */
  pitch: number
  /** Radians about Y. Positive brings the right lobe nearer. */
  yaw: number
}

export interface MobiusRibbon {
  /** Sets canvas.width/height = css × dpr. No draw. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void
  /** Recomputes band colors and dither patterns. No draw. */
  setColors(colors: RibbonColors): void
  /** Clears and paints one frame. */
  draw(pose: RibbonPose): void
  /** Clears the canvas and drops cached patterns; further calls are no-ops. */
  dispose(): void
}

/* ────────────────────────────────────────────────────────────────────────
   Geometry — unit lemniscate (a = 1), all lengths in that space.
   ──────────────────────────────────────────────────────────────────────── */

/** Lobe fattening on y: the bare lemniscate is too slender for an ∞ glyph. */
export const SQUASH = 1.35
/** Out-of-plane lift at the crossing; must beat HALF_WIDTH·sin 45° so an
 *  edge-on strand never reaches the one passing under it (2·LIFT > √2·HALF_WIDTH). */
export const LIFT = 0.12
export const HALF_WIDTH = 0.16

const FOCAL = 3.2
const MARGIN = 0.04
const DEFAULT_SEGMENTS = 128
const MIN_SEGMENTS = 8
const TAU = Math.PI * 2
/** Draw-in starts here (the crossing), runs forward and wraps. */
const CROSSING_T = Math.PI / 2
/** Each quad's far rib is extrapolated this fraction of a segment into its
 *  neighbor so antialiased fills don't leave a faint sheet-colored seam at
 *  every rib. Sub-2px at the default segment count; invisible. */
const SEAM_OVERLAP = 0.5
/** Registration mark arm length as a fraction of canvas height. */
const CROSSHAIR_ARM = 0.06

/** Untilted analytic extents — what the canvas fit is authored against.
 *  The lemniscate's y peaks at a/(2√2). */
const EXTENT_X = 1 + HALF_WIDTH
const EXTENT_Y = SQUASH / (2 * Math.SQRT2) + HALF_WIDTH

/* ────────────────────────────────────────────────────────────────────────
   Shading — |n_z| thresholds, lime → sheet mix per band, dot screens.
   ──────────────────────────────────────────────────────────────────────── */

const SHADE_LIT = 0.85
const SHADE_MID = 0.6
const SHADE_DIM = 0.3
const BAND_MIX = [0, 0.18, 0.4, 0.62] as const

/** Dot screens in device pixels on a DITHER_TILE square: none for the two
 *  lit bands, a sparse 2-of-16 for band 2, a staggered 4-of-16 for band 3. */
const DITHER_TILE = 4
const DITHER_DOTS: ReadonlyArray<ReadonlyArray<readonly [number, number]> | null> = [
  null,
  null,
  [[0, 0], [2, 2]],
  [[0, 0], [2, 0], [1, 2], [3, 2]]
]

type Rgb = readonly [number, number, number]

const DEFAULT_COLORS: RibbonColors = {
  signal: '#ccff00',
  sheet: '#05060a',
  ink: '#a1a1aa'
}
const FALLBACK_SIGNAL: Rgb = [204, 255, 0]
const FALLBACK_SHEET: Rgb = [5, 6, 10]

/* ────────────────────────────────────────────────────────────────────────
   Pure helpers
   ──────────────────────────────────────────────────────────────────────── */

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})

/** Centerline: lemniscate of Bernoulli with the lobes fattened by SQUASH
 *  and lifted out of the plane by LIFT·sin t. The crossing is t = π/2 and
 *  3π/2 (x = y = 0, z = ±LIFT). */
export function lemniscate(t: number): Vec3 {
  const c = Math.cos(t)
  const s = Math.sin(t)
  const d = 1 + s * s
  return { x: c / d, y: (SQUASH * s * c) / d, z: LIFT * s }
}

/** dC/dt by hand: x' = −s(3 − s²)/d², y' = SQUASH·(1 − 3s²)/d², z' = LIFT·c. */
function lemniscateTangent(t: number): Vec3 {
  const c = Math.cos(t)
  const s = Math.sin(t)
  const d = 1 + s * s
  const dd = d * d
  return {
    x: (-s * (3 - s * s)) / dd,
    y: (SQUASH * (1 - 3 * s * s)) / dd,
    z: LIFT * c
  }
}

type Basis = { center: Vec3; tangent: Vec3; inPlane: Vec3; binormal: Vec3 }

/** Frame at t: T = unit tangent, N = normalize(Z × T) (the in-plane normal
 *  — T never runs parallel to Z, so it is always defined), B = T × N. */
function basisAt(t: number): Basis {
  const tangent = normalize(lemniscateTangent(t))
  const inPlane = normalize({ x: -tangent.y, y: tangent.x, z: 0 })
  return {
    center: lemniscate(t),
    tangent,
    inPlane,
    binormal: cross(tangent, inPlane)
  }
}

/** The ribbon's cross-section at t. Width vector W = cosθ·N + sinθ·B with
 *  θ = t/2 + phase: half a turn per loop, so W(2π) = −W(0) and the strip
 *  closes with the Möbius flip. Corners are center ± HALF_WIDTH·W; the
 *  surface normal is T × W (unit, ⟂ W). */
export function mobiusFrame(
  t: number,
  phase: number
): { center: Vec3; edgeA: Vec3; edgeB: Vec3; normal: Vec3 } {
  const { center, tangent, inPlane, binormal } = basisAt(t)
  const theta = t / 2 + phase
  const ct = Math.cos(theta)
  const st = Math.sin(theta)
  const w: Vec3 = {
    x: ct * inPlane.x + st * binormal.x,
    y: ct * inPlane.y + st * binormal.y,
    z: ct * inPlane.z + st * binormal.z
  }
  return {
    center,
    edgeA: {
      x: center.x + HALF_WIDTH * w.x,
      y: center.y + HALF_WIDTH * w.y,
      z: center.z + HALF_WIDTH * w.z
    },
    edgeB: {
      x: center.x - HALF_WIDTH * w.x,
      y: center.y - HALF_WIDTH * w.y,
      z: center.z - HALF_WIDTH * w.z
    },
    normal: cross(tangent, w)
  }
}

/** Quantizes |n_z| (view ≈ +Z) to a band: 0 fully lit … 3 edge-on. */
export function shadeBand(nz: number): 0 | 1 | 2 | 3 {
  const a = Math.abs(nz)
  if (a >= SHADE_LIT) return 0
  if (a >= SHADE_MID) return 1
  if (a >= SHADE_DIM) return 2
  return 3
}

/* ────────────────────────────────────────────────────────────────────────
   Colors — parse what the browser hands back so bands can be mixed.
   ──────────────────────────────────────────────────────────────────────── */

const HEX_RE = /^#([0-9a-f]{3,8})$/i
const FUNC_RE = /^(rgba?|color)\((.*)\)$/i

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() in comma or space form
 *  (with optional `/ alpha`, percentages allowed), and color(srgb r g b).
 *  Alpha is ignored — bands are opaque mixes. */
function parseCssColor(input: string): Rgb | null {
  const str = input.trim()
  const hex = HEX_RE.exec(str)
  if (hex) {
    const h = hex[1]
    if (h.length === 3 || h.length === 4) {
      return [
        17 * parseInt(h[0], 16),
        17 * parseInt(h[1], 16),
        17 * parseInt(h[2], 16)
      ]
    }
    if (h.length === 6 || h.length === 8) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16)
      ]
    }
    return null
  }
  const fn = FUNC_RE.exec(str)
  if (!fn) return null
  const parts = fn[2].split('/')[0].trim().split(/[\s,]+/)
  let rgb: number[]
  if (fn[1].toLowerCase() === 'color') {
    if (parts.length < 4 || parts[0].toLowerCase() !== 'srgb') return null
    rgb = parts.slice(1, 4).map((p) => 255 * parseFloat(p))
  } else {
    if (parts.length < 3) return null
    rgb = parts
      .slice(0, 3)
      .map((p) => (p.endsWith('%') ? (255 * parseFloat(p)) / 100 : parseFloat(p)))
  }
  if (!rgb.every(Number.isFinite)) return null
  return [rgb[0], rgb[1], rgb[2]]
}

const mixRgb = (a: Rgb, b: Rgb, k: number): string => {
  const ch = (i: number) =>
    Math.max(0, Math.min(255, Math.round(a[i] + (b[i] - a[i]) * k)))
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
}

/* ────────────────────────────────────────────────────────────────────────
   Renderer
   ──────────────────────────────────────────────────────────────────────── */

const NOOP_RIBBON: MobiusRibbon = {
  resize() {},
  setColors() {},
  draw() {},
  dispose() {}
}

export function createMobiusRibbon(
  canvas: HTMLCanvasElement,
  opts: { segments?: number } = {}
): MobiusRibbon {
  const ctx = canvas.getContext('2d')
  if (!ctx) return { ...NOOP_RIBBON }

  const segments = Math.max(MIN_SEGMENTS, Math.floor(opts.segments ?? DEFAULT_SEGMENTS))
  // One extra sample at t = 2π: same C/T/N/B as t = 0, but θ = π + phase
  // there, so the last quad closes onto the first with the flip built in.
  const samples = segments + 1

  // Static frame per sample — only θ (and so W) depends on the phase.
  const cX = new Float64Array(samples)
  const cY = new Float64Array(samples)
  const cZ = new Float64Array(samples)
  const inX = new Float64Array(samples)
  const inY = new Float64Array(samples)
  const inZ = new Float64Array(samples)
  const biX = new Float64Array(samples)
  const biY = new Float64Array(samples)
  const biZ = new Float64Array(samples)
  const halfT = new Float64Array(samples)
  // Per-quad loop position from the crossing, 0..1, for the draw-in.
  const loopPos = new Float64Array(segments)
  for (let i = 0; i < samples; i++) {
    const t = (TAU * i) / segments
    const { center, inPlane, binormal } = basisAt(t)
    cX[i] = center.x
    cY[i] = center.y
    cZ[i] = center.z
    inX[i] = inPlane.x
    inY[i] = inPlane.y
    inZ[i] = inPlane.z
    biX[i] = binormal.x
    biY[i] = binormal.y
    biZ[i] = binormal.z
    halfT[i] = t / 2
    if (i < segments) loopPos[i] = ((((t - CROSSING_T) % TAU) + TAU) % TAU) / TAU
  }

  // Per-frame scratch, reused: projected corners, rotated center depth and
  // rotated |n_z| per sample, depth per quad and the paint order.
  const pAx = new Float64Array(samples)
  const pAy = new Float64Array(samples)
  const pBx = new Float64Array(samples)
  const pBy = new Float64Array(samples)
  const zC = new Float64Array(samples)
  const shade = new Float64Array(samples)
  const qDepth = new Float64Array(segments)
  const order: number[] = Array.from({ length: segments }, (_, i) => i)

  // Viewport. Until resize() the element's own backing store is used at
  // dpr 1, so an early draw is safe — just not crisp.
  let cssW = canvas.width
  let cssH = canvas.height
  let dpr = 1
  let disposed = false

  let fills: string[] = []
  let patterns: Array<CanvasPattern | null> = []
  let sheetStyle = DEFAULT_COLORS.sheet
  let inkStyle = DEFAULT_COLORS.ink

  /** Parses directly when the string is already rgb/hex; otherwise lets
   *  the browser resolve it (named colors, hsl(), oklch(), …) through
   *  fillStyle, which serializes to #rrggbb / rgba() / color(srgb). */
  const resolveColor = (str: string, fallback: Rgb): Rgb => {
    const direct = parseCssColor(str)
    if (direct) return direct
    ctx.fillStyle = '#010203'
    ctx.fillStyle = str
    const normalized = ctx.fillStyle
    if (typeof normalized !== 'string' || normalized === '#010203') return fallback
    return parseCssColor(normalized) ?? fallback
  }

  const makeDotPattern = (
    dots: ReadonlyArray<readonly [number, number]>,
    color: string
  ): CanvasPattern | null => {
    const tile = canvas.ownerDocument.createElement('canvas')
    tile.width = DITHER_TILE
    tile.height = DITHER_TILE
    const tctx = tile.getContext('2d')
    if (!tctx) return null
    tctx.fillStyle = color
    for (const [x, y] of dots) tctx.fillRect(x, y, 1, 1)
    return ctx.createPattern(tile, 'repeat')
  }

  const setColors = (colors: RibbonColors) => {
    if (disposed) return
    const signal = resolveColor(colors.signal, FALLBACK_SIGNAL)
    const sheet = resolveColor(colors.sheet, FALLBACK_SHEET)
    fills = BAND_MIX.map((k) => mixRgb(signal, sheet, k))
    patterns = DITHER_DOTS.map((dots) => (dots ? makeDotPattern(dots, colors.sheet) : null))
    sheetStyle = colors.sheet
    inkStyle = colors.ink
  }

  const resize = (cssWidth: number, cssHeight: number, ratio: number) => {
    if (disposed) return
    dpr = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
    cssW = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 0
    cssH = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 0
    // Setting the bitmap size resets the context state; draw() re-applies
    // the transform every frame for exactly that reason.
    canvas.width = Math.max(1, Math.round(cssW * dpr))
    canvas.height = Math.max(1, Math.round(cssH * dpr))
  }

  const draw = ({ phase, drawn, pitch, yaw }: RibbonPose) => {
    if (disposed) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    if (cssW < 1 || cssH < 1) return

    // Fit the untilted extents into the canvas with the margin, centered.
    const fit = Math.min(
      (cssW * (1 - 2 * MARGIN)) / (2 * EXTENT_X),
      (cssH * (1 - 2 * MARGIN)) / (2 * EXTENT_Y)
    )
    const ox = cssW / 2
    const oy = cssH / 2
    const hair = 1 / dpr
    ctx.lineWidth = hair

    // Registration mark at the projected origin — rotations fix it and
    // k(0) = 1, so it is the canvas center — snapped to device pixels.
    const arm = cssH * CROSSHAIR_ARM
    const mx = (Math.floor(ox * dpr) + 0.5) / dpr
    const my = (Math.floor(oy * dpr) + 0.5) / dpr
    ctx.strokeStyle = inkStyle
    ctx.beginPath()
    ctx.moveTo(mx - arm, my)
    ctx.lineTo(mx + arm, my)
    ctx.moveTo(mx, my - arm)
    ctx.lineTo(mx, my + arm)
    ctx.stroke()

    // Twist, rotate (pitch about X, then yaw about Y), project.
    const cp = Math.cos(pitch)
    const sp = Math.sin(pitch)
    const cw = Math.cos(yaw)
    const sw = Math.sin(yaw)
    const project = (
      x: number,
      y: number,
      z: number,
      outX: Float64Array,
      outY: Float64Array,
      i: number
    ) => {
      const y1 = y * cp - z * sp
      const z1 = y * sp + z * cp
      const x2 = x * cw + z1 * sw
      const z2 = -x * sw + z1 * cw
      const k = FOCAL / (FOCAL + z2)
      outX[i] = ox + x2 * k * fit
      outY[i] = oy - y1 * k * fit
    }
    for (let i = 0; i < samples; i++) {
      const theta = halfT[i] + phase
      const ct = Math.cos(theta)
      const st = Math.sin(theta)
      const wx = ct * inX[i] + st * biX[i]
      const wy = ct * inY[i] + st * biY[i]
      const wz = ct * inZ[i] + st * biZ[i]
      // n = T × W = cosθ·B − sinθ·N; only its rotated z is needed.
      const nx = ct * biX[i] - st * inX[i]
      const ny = ct * biY[i] - st * inY[i]
      const nz = ct * biZ[i] - st * inZ[i]
      shade[i] = Math.abs(-nx * sw + (ny * sp + nz * cp) * cw)
      zC[i] = -cX[i] * sw + (cY[i] * sp + cZ[i] * cp) * cw
      const hx = HALF_WIDTH * wx
      const hy = HALF_WIDTH * wy
      const hz = HALF_WIDTH * wz
      project(cX[i] + hx, cY[i] + hy, cZ[i] + hz, pAx, pAy, i)
      project(cX[i] - hx, cY[i] - hy, cZ[i] - hz, pBx, pBy, i)
    }

    // Painter's sort: larger z is farther (k = f / (f + z)), painted first.
    for (let q = 0; q < segments; q++) qDepth[q] = zC[q] + zC[q + 1]
    order.sort((a, b) => qDepth[b] - qDepth[a])

    ctx.strokeStyle = sheetStyle
    for (let n = 0; n < segments; n++) {
      const q = order[n]
      if (loopPos[q] >= drawn) continue
      const j = q + 1
      const band = shadeBand(0.5 * (shade[q] + shade[j]))
      const ax1 = pAx[j] + (pAx[j] - pAx[q]) * SEAM_OVERLAP
      const ay1 = pAy[j] + (pAy[j] - pAy[q]) * SEAM_OVERLAP
      const bx1 = pBx[j] + (pBx[j] - pBx[q]) * SEAM_OVERLAP
      const by1 = pBy[j] + (pBy[j] - pBy[q]) * SEAM_OVERLAP

      ctx.beginPath()
      ctx.moveTo(pAx[q], pAy[q])
      ctx.lineTo(ax1, ay1)
      ctx.lineTo(bx1, by1)
      ctx.lineTo(pBx[q], pBy[q])
      ctx.closePath()
      ctx.fillStyle = fills[band]
      ctx.fill()
      const pattern = patterns[band]
      if (pattern) {
        // The current path is already in device space; refilling it under
        // the identity transform locks the dot screen to device pixels.
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.fillStyle = pattern
        ctx.fill()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }

      // Long edges only — the ribs stay unstroked so the strand reads as
      // one surface, and a nearer quad's fill covers these at the crossing.
      ctx.beginPath()
      ctx.moveTo(pAx[q], pAy[q])
      ctx.lineTo(ax1, ay1)
      ctx.moveTo(pBx[q], pBy[q])
      ctx.lineTo(bx1, by1)
      ctx.stroke()
    }
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    patterns = []
    fills = []
  }

  setColors(DEFAULT_COLORS)
  return { resize, setColors, draw, dispose }
}
