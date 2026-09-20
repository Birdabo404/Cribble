import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  getPlateProductMap,
  isTeamSubscription,
  resolvePlateIdForProduct,
  resolvePlateProductId
} from './dodo'

// isTeamSubscription decides team-vs-pro fulfillment for real money. Dodo
// subscription payloads carry the product id only (no product embed), so
// classification is purely by the configured DODO_PRODUCT_TEAM_* ids;
// anything matching neither stays Pro (the historical default).

describe('isTeamSubscription', () => {
  beforeEach(() => {
    vi.stubEnv('DODO_PRODUCT_TEAM_MONTHLY', 'pdt_team_monthly')
    vi.stubEnv('DODO_PRODUCT_TEAM_YEARLY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('matches a configured team product id', () => {
    expect(isTeamSubscription({ product_id: 'pdt_team_monthly' })).toBe(true)
  })

  it('classifies unmatched products as non-team (the Pro default)', () => {
    expect(isTeamSubscription({ product_id: 'pdt_monthly' })).toBe(false)
    expect(isTeamSubscription({ product_id: '' })).toBe(false)
  })

  it('skips unset team keys instead of matching the empty string', () => {
    // DODO_PRODUCT_TEAM_YEARLY is '' above — an empty product_id must not
    // classify as team through it.
    expect(isTeamSubscription({ product_id: '' })).toBe(false)
  })
})

// The plate product map is the only place a plate id meets a Dodo product
// id, in both directions: checkout resolves plate -> product, and payment
// fulfillment without checkout metadata resolves product -> plate.

describe('plate product map', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    errorSpy.mockRestore()
  })

  it('resolves both directions from a well-formed map', () => {
    vi.stubEnv(
      'DODO_PLATE_PRODUCT_MAP',
      JSON.stringify({ 'deep-space': 'pdt_deep', 'koi-pond': 'pdt_koi' })
    )

    expect(resolvePlateProductId('deep-space')).toBe('pdt_deep')
    expect(resolvePlateProductId('unknown')).toBeNull()
    expect(resolvePlateIdForProduct('pdt_koi')).toBe('koi-pond')
    expect(resolvePlateIdForProduct('pdt_nope')).toBeNull()
  })

  it('drops non-string and empty product ids', () => {
    vi.stubEnv(
      'DODO_PLATE_PRODUCT_MAP',
      JSON.stringify({ 'deep-space': 'pdt_deep', 'koi-pond': '', broken: 7 })
    )

    expect(getPlateProductMap()).toEqual({ 'deep-space': 'pdt_deep' })
  })

  it('degrades to an empty map on malformed JSON or non-object values', () => {
    vi.stubEnv('DODO_PLATE_PRODUCT_MAP', '{not json')
    expect(getPlateProductMap()).toEqual({})
    expect(errorSpy).toHaveBeenCalledTimes(1)

    vi.stubEnv('DODO_PLATE_PRODUCT_MAP', '["pdt_a"]')
    expect(getPlateProductMap()).toEqual({})

    vi.stubEnv('DODO_PLATE_PRODUCT_MAP', '')
    expect(getPlateProductMap()).toEqual({})
  })
})
