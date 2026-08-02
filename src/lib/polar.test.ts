import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { isTeamSubscription } from './polar'

// isTeamSubscription decides team-vs-pro fulfillment for real money:
// a configured POLAR_PRODUCT_TEAM_* id matches first, and the product's
// `team_key` metadata (stamped by scripts/setup-polar.ts) is the
// fallback that catches a missing/stale env var — the misconfiguration
// that once granted a real Team purchase as Pro. When only the fallback
// fires, the helper must warn so the env gets fixed; anything matching
// neither stays Pro (founder products rely on that default).

describe('isTeamSubscription', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    vi.stubEnv('POLAR_PRODUCT_TEAM_MONTHLY', 'prod_team_monthly')
    vi.stubEnv('POLAR_PRODUCT_TEAM_YEARLY', '')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    warnSpy.mockRestore()
  })

  it('matches a configured team product id without warning', () => {
    expect(isTeamSubscription({ productId: 'prod_team_monthly' })).toBe(true)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('falls back to team_key product metadata and warns about the stale env', () => {
    const result = isTeamSubscription({
      productId: 'prod_unlisted',
      product: { metadata: { team_key: 'team_yearly' } }
    })

    expect(result).toBe(true)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('POLAR_PRODUCT_TEAM_MONTHLY')
  })

  it('classifies unmatched products as non-team (the historical Pro default)', () => {
    expect(isTeamSubscription({ productId: 'prod_founder' })).toBe(false)
    expect(
      isTeamSubscription({
        productId: 'prod_founder',
        product: { metadata: { pro_key: 'pro_monthly' } }
      })
    ).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('ignores an empty or non-string team_key', () => {
    expect(
      isTeamSubscription({ productId: 'prod_x', product: { metadata: { team_key: '' } } })
    ).toBe(false)
    expect(
      isTeamSubscription({ productId: 'prod_x', product: { metadata: { team_key: 7 } } })
    ).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('handles shapes without a product embed (CustomerStateSubscription) by id only', () => {
    expect(isTeamSubscription({ productId: 'prod_team_monthly', product: null })).toBe(true)
    expect(isTeamSubscription({ productId: 'prod_other', product: null })).toBe(false)
  })
})
