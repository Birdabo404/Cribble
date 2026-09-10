import { afterEach, describe, expect, it, vi } from 'vitest'
import { motionReduced, shouldDismissSheet } from './shopMotion'

// The pure parts of shopMotion: the sheet release rule (the only motion
// decision the drawer makes without GSAP) and the reduced-motion guard's
// SSR / kill-switch branches. vitest runs in the node environment, so
// window and document are undefined unless a test stubs them.

describe('shouldDismissSheet', () => {
  const height = 600

  it('dismisses on a fast downward flick regardless of travel', () => {
    expect(shouldDismissSheet(10, height, 0.12)).toBe(true)
    expect(shouldDismissSheet(0, height, 1)).toBe(true)
  })

  it('does not dismiss at exactly the velocity threshold', () => {
    expect(shouldDismissSheet(10, height, 0.11)).toBe(false)
  })

  it('dismisses once travel passes 40% of the sheet height', () => {
    expect(shouldDismissSheet(height * 0.4 + 1, height, 0)).toBe(true)
    expect(shouldDismissSheet(height, height, 0)).toBe(true)
  })

  it('snaps back at or under 40% travel with a slow release', () => {
    expect(shouldDismissSheet(height * 0.4, height, 0)).toBe(false)
    expect(shouldDismissSheet(100, height, 0.05)).toBe(false)
  })

  it('treats an upward flick (negative velocity) as a slow release', () => {
    expect(shouldDismissSheet(100, height, -0.5)).toBe(false)
    expect(shouldDismissSheet(height * 0.5, height, -0.5)).toBe(true)
  })
})

describe('motionReduced', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is false during SSR (no window)', () => {
    expect(typeof window).toBe('undefined')
    expect(motionReduced()).toBe(false)
  })

  it('honors the in-app data-motion kill switch and the OS query', () => {
    // One mutable MediaQueryList: prefersReducedMotion() caches the list it
    // gets from matchMedia, so the OS branch is flipped on the object, not
    // by re-stubbing matchMedia.
    const mql = { matches: false }
    const dataset: { motion?: string } = {}
    vi.stubGlobal('window', { matchMedia: () => mql })
    vi.stubGlobal('document', { documentElement: { dataset } })

    expect(motionReduced()).toBe(false)

    dataset.motion = 'reduced'
    expect(motionReduced()).toBe(true)

    delete dataset.motion
    expect(motionReduced()).toBe(false)

    mql.matches = true
    expect(motionReduced()).toBe(true)
  })
})
