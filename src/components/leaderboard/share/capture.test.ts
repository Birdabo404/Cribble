import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toCanvasMock } = vi.hoisted(() => ({
  toCanvasMock: vi.fn()
}))

vi.mock('html-to-image', () => ({
  toCanvas: toCanvasMock
}))

import { captureElementToBlob, sharePixelRatio } from './capture'

const element = {} as HTMLElement

function canvasReturning(blob: Blob): HTMLCanvasElement {
  return {
    toBlob: (callback: BlobCallback) => callback(blob)
  } as HTMLCanvasElement
}

describe('share capture', () => {
  beforeEach(() => {
    toCanvasMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps proxy query parameters distinct and warms resources at 1x', async () => {
    const blob = new Blob(['card'], { type: 'image/png' })
    toCanvasMock.mockResolvedValue(canvasReturning(blob))

    await expect(
      captureElementToBlob(element, { pixelRatio: 4, type: 'image/png' })
    ).resolves.toBe(blob)

    expect(toCanvasMock).toHaveBeenCalledTimes(3)
    expect(toCanvasMock).toHaveBeenNthCalledWith(
      1,
      element,
      expect.objectContaining({
        imagePlaceholder: expect.stringMatching(/^data:image\/gif;base64,/),
        includeQueryParams: true,
        pixelRatio: 1
      })
    )
    expect(toCanvasMock).toHaveBeenNthCalledWith(
      3,
      element,
      expect.objectContaining({ includeQueryParams: true, pixelRatio: 4 })
    )
  })

  it('retries an oversized 4x canvas at 3x', async () => {
    const blob = new Blob(['card'], { type: 'image/png' })
    toCanvasMock
      .mockRejectedValueOnce(new Error('canvas too large'))
      .mockResolvedValueOnce(canvasReturning(blob))

    await expect(
      captureElementToBlob(element, {
        pixelRatio: 4,
        type: 'image/png',
        warmupPasses: 0
      })
    ).resolves.toBe(blob)

    expect(toCanvasMock.mock.calls.map(([, options]) => options.pixelRatio)).toEqual([4, 3])
  })

  it('uses a canvas-safe 3x export in desktop Safari', () => {
    vi.stubGlobal('navigator', {
      maxTouchPoints: 0,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
    })

    expect(sharePixelRatio()).toBe(3)
  })
})
