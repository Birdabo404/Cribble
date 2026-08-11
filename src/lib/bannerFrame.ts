import type { CSSProperties } from 'react'

// Banner framing (reposition + zoom), shared by the profile API write path
// and every banner surface. Banners render at several aspect ratios (hero,
// podium, player card), so the crop is stored as a focal point + zoom and
// applied via CSS: object-position `x% y%` plus scale(zoom) with a matching
// transform-origin. Anchoring both to the same point makes the pan linear
// over the cover overflow at any zoom and never exposes blank edges while
// x/y stay in 0–100.

export interface BannerFrame {
  x: number
  y: number
  zoom: number
}

export const DEFAULT_BANNER_FRAME: BannerFrame = { x: 50, y: 50, zoom: 1 }

export function isDefaultBannerFrame(frame: BannerFrame): boolean {
  return (
    frame.x === DEFAULT_BANNER_FRAME.x &&
    frame.y === DEFAULT_BANNER_FRAME.y &&
    frame.zoom === DEFAULT_BANNER_FRAME.zoom
  )
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const clampRound2 = (value: number, min: number, max: number): number =>
  Math.round(Math.min(max, Math.max(min, value)) * 100) / 100

/**
 * Parse unknown JSON (a users.metadata value or request body field) into a
 * sanitized frame. Only plain objects with finite numeric x, y and zoom are
 * accepted; x/y clamp to 0–100, zoom to 1–3, everything rounded to 2
 * decimals. Anything invalid — and any frame equal to the default — returns
 * null, so metadata never carries a redundant default frame.
 */
export function parseBannerFrame(v: unknown): BannerFrame | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const { x, y, zoom } = v as Record<string, unknown>
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom)) return null

  const frame: BannerFrame = {
    x: clampRound2(x, 0, 100),
    y: clampRound2(y, 0, 100),
    zoom: clampRound2(zoom, 1, 3)
  }
  return isDefaultBannerFrame(frame) ? null : frame
}

/**
 * CSS for an object-cover banner <img>. objectPosition is always set; the
 * scale(zoom) + transformOrigin pair is added only when zoom !== 1, so pure
 * repositioning never pays for a transform layer. null/undefined frames
 * yield undefined.
 */
export function bannerFrameStyle(frame?: BannerFrame | null): CSSProperties | undefined {
  if (!frame) return undefined
  const focalPoint = `${frame.x}% ${frame.y}%`
  if (frame.zoom === 1) return { objectPosition: focalPoint }
  return {
    objectPosition: focalPoint,
    transform: `scale(${frame.zoom})`,
    transformOrigin: focalPoint
  }
}
