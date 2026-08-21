import { describe, expect, it } from 'vitest'
import { datafastStatsUrl } from './datafastPublic'

describe('datafastStatsUrl', () => {
  it('returns the public share page, not the owner settings URL', () => {
    expect(datafastStatsUrl()).toBe('https://datafa.st/share/6a87f87b9edaa5d87fb85c63')
    expect(datafastStatsUrl()).not.toContain('/settings')
  })
})
