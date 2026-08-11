import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BANNER_FRAME,
  bannerFrameStyle,
  isDefaultBannerFrame,
  parseBannerFrame
} from './bannerFrame'

describe('parseBannerFrame', () => {
  it('accepts a valid frame and keeps in-range values', () => {
    expect(parseBannerFrame({ x: 25, y: 75, zoom: 2 })).toEqual({ x: 25, y: 75, zoom: 2 })
  })

  it('rounds to 2 decimals', () => {
    expect(parseBannerFrame({ x: 12.3456, y: 78.9012, zoom: 1.5678 })).toEqual({
      x: 12.35,
      y: 78.9,
      zoom: 1.57
    })
  })

  it('clamps x/y to 0–100 and zoom to 1–3', () => {
    expect(parseBannerFrame({ x: -20, y: 140.5, zoom: 9 })).toEqual({ x: 0, y: 100, zoom: 3 })
    expect(parseBannerFrame({ x: 10, y: 50, zoom: 0.25 })).toEqual({ x: 10, y: 50, zoom: 1 })
  })

  it('collapses the exact default frame to null', () => {
    expect(parseBannerFrame({ x: 50, y: 50, zoom: 1 })).toBeNull()
    expect(parseBannerFrame({ ...DEFAULT_BANNER_FRAME })).toBeNull()
  })

  it('collapses near-default values that round to the default', () => {
    expect(parseBannerFrame({ x: 50.004, y: 49.996, zoom: 1.0049 })).toBeNull()
  })

  it('collapses frames that clamp into the default', () => {
    expect(parseBannerFrame({ x: 50, y: 50, zoom: 0.5 })).toBeNull()
  })

  it('rejects non-objects and objects with missing keys', () => {
    for (const v of [
      null,
      undefined,
      'centered',
      '{"x":50,"y":50,"zoom":2}',
      42,
      true,
      [50, 50, 2],
      {},
      { x: 10 },
      { x: 10, y: 20 },
      { y: 20, zoom: 2 }
    ]) {
      expect(parseBannerFrame(v), JSON.stringify(v) ?? 'undefined').toBeNull()
    }
  })

  it('rejects non-finite and stringified coordinates', () => {
    expect(parseBannerFrame({ x: NaN, y: 50, zoom: 2 })).toBeNull()
    expect(parseBannerFrame({ x: 10, y: Infinity, zoom: 2 })).toBeNull()
    expect(parseBannerFrame({ x: 10, y: 20, zoom: -Infinity })).toBeNull()
    expect(parseBannerFrame({ x: '10', y: 20, zoom: 2 })).toBeNull()
    expect(parseBannerFrame({ x: 10, y: '20', zoom: 2 })).toBeNull()
    expect(parseBannerFrame({ x: 10, y: 20, zoom: '2' })).toBeNull()
  })
})

describe('isDefaultBannerFrame', () => {
  it('matches only the exact default values', () => {
    expect(isDefaultBannerFrame(DEFAULT_BANNER_FRAME)).toBe(true)
    expect(isDefaultBannerFrame({ x: 50, y: 50, zoom: 1 })).toBe(true)
    expect(isDefaultBannerFrame({ x: 50.01, y: 50, zoom: 1 })).toBe(false)
    expect(isDefaultBannerFrame({ x: 50, y: 50, zoom: 1.01 })).toBe(false)
  })
})

describe('bannerFrameStyle', () => {
  it('returns undefined when there is no frame to apply', () => {
    expect(bannerFrameStyle(null)).toBeUndefined()
    expect(bannerFrameStyle(undefined)).toBeUndefined()
    expect(bannerFrameStyle()).toBeUndefined()
  })

  it('repositions without a transform layer at zoom 1', () => {
    const style = bannerFrameStyle({ x: 20, y: 80, zoom: 1 })
    expect(style).toEqual({ objectPosition: '20% 80%' })
    expect(style).not.toHaveProperty('transform')
    expect(style).not.toHaveProperty('transformOrigin')
  })

  it('anchors the scale to the focal point when zoomed', () => {
    expect(bannerFrameStyle({ x: 33.33, y: 66.67, zoom: 2.5 })).toEqual({
      objectPosition: '33.33% 66.67%',
      transform: 'scale(2.5)',
      transformOrigin: '33.33% 66.67%'
    })
  })
})
