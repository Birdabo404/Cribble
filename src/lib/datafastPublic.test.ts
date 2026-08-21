import { describe, expect, it } from 'vitest'
import { datafastStatsUrl } from './datafastPublic'

describe('datafastStatsUrl', () => {
  it('returns the cribble.dev dashboard, not the share bounce or settings URL', () => {
    expect(datafastStatsUrl()).toBe('https://datafa.st/dashboard/6a87f87b9edaa5d87fb85c63')
    expect(datafastStatsUrl()).not.toContain('/share/')
    expect(datafastStatsUrl()).not.toContain('/settings')
  })
})
