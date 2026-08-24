import { describe, expect, it } from 'vitest'
import { goatcounterEndpoint, goatcounterStatsUrl } from './goatcounterPublic'

describe('goatcounter public URLs', () => {
  it('points the tracker at the hosted count endpoint', () => {
    expect(goatcounterEndpoint()).toBe('https://birdabo.goatcounter.com/count')
    expect(goatcounterStatsUrl()).toBe('https://birdabo.goatcounter.com')
    expect(goatcounterStatsUrl()).not.toContain('/count')
  })
})
