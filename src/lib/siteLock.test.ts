import { describe, expect, it } from 'vitest'
import { isAllowedDuringLock } from './siteLock'

describe('isAllowedDuringLock — unfurl cards', () => {
  it('lets crawlers fetch the generated cards for the public pages', () => {
    expect(isAllowedDuringLock('/opengraph-image')).toBe(true)
    expect(isAllowedDuringLock('/status/opengraph-image')).toBe(true)
    expect(isAllowedDuringLock('/u/birdabo/opengraph-image')).toBe(true)
  })

  it('keeps the status page and its API lane open', () => {
    expect(isAllowedDuringLock('/status')).toBe(true)
    expect(isAllowedDuringLock('/api/status')).toBe(true)
  })

  it('does not open anything else under /status or /api/status', () => {
    expect(isAllowedDuringLock('/status/anything')).toBe(false)
    expect(isAllowedDuringLock('/api/status/log')).toBe(false)
    expect(isAllowedDuringLock('/status/twitter-image')).toBe(false)
  })
})
