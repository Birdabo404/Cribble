import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  getDodoEnvironment,
  isDodoActive,
  isDodoTeamProduct,
  plateIdForProduct,
  readPlateId,
  readUserId,
  resolvePlateProductId
} from './dodo'
import { cancelRevokesNow } from './dodoSync'

describe('getDodoEnvironment', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to test_mode unless the env is exactly live_mode', () => {
    vi.stubEnv('DODO_PAYMENTS_ENVIRONMENT', '')
    expect(getDodoEnvironment()).toBe('test_mode')
    vi.stubEnv('DODO_PAYMENTS_ENVIRONMENT', 'production')
    expect(getDodoEnvironment()).toBe('test_mode')
    vi.stubEnv('DODO_PAYMENTS_ENVIRONMENT', 'live_mode')
    expect(getDodoEnvironment()).toBe('live_mode')
  })
})

describe('isDodoActive', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('stays off in production unless the environment is live_mode', () => {
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'test_key')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('DODO_PAYMENTS_ENVIRONMENT', 'test_mode')
    expect(isDodoActive()).toBe(false)
    vi.stubEnv('DODO_PAYMENTS_ENVIRONMENT', 'live_mode')
    expect(isDodoActive()).toBe(true)
  })

  it('allows test mode outside production', () => {
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'test_key')
    vi.stubEnv('DODO_PAYMENTS_ENVIRONMENT', 'test_mode')
    expect(isDodoActive()).toBe(true)
  })
})

describe('isDodoTeamProduct', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    vi.stubEnv('DODO_PRODUCT_TEAM_MONTHLY', 'pdt_team_monthly')
    vi.stubEnv('DODO_PRODUCT_TEAM_YEARLY', '')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    warnSpy.mockRestore()
  })

  it('matches a configured team product id without warning', () => {
    expect(isDodoTeamProduct('pdt_team_monthly')).toBe(true)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('falls back to team_key metadata and warns about the stale env', () => {
    expect(isDodoTeamProduct('pdt_unlisted', { team_key: 'team_yearly' })).toBe(true)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('DODO_PRODUCT_TEAM_MONTHLY')
  })

  it('classifies unmatched products as non-team', () => {
    expect(isDodoTeamProduct('pdt_pro', { pro_key: 'pro_monthly' })).toBe(false)
    expect(isDodoTeamProduct('pdt_pro', { team_key: '' })).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('plate and recipient metadata', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('maps plate ids both ways and ignores bad JSON', () => {
    vi.stubEnv('DODO_PLATE_PRODUCT_MAP', '{"ignition":"pdt_ignition"}')
    expect(resolvePlateProductId('ignition')).toBe('pdt_ignition')
    expect(plateIdForProduct('pdt_ignition')).toBe('ignition')
    expect(resolvePlateProductId('missing')).toBeNull()

    vi.stubEnv('DODO_PLATE_PRODUCT_MAP', '{not json')
    expect(resolvePlateProductId('ignition')).toBeNull()
  })

  it('reads userId and plateId from string or number metadata', () => {
    expect(readUserId({ userId: '42' })).toBe(42)
    expect(readUserId({ userId: 7 })).toBe(7)
    expect(readUserId({ userId: '0' })).toBeNull()
    expect(readUserId(null)).toBeNull()
    expect(readPlateId({ plateId: 'ignition' })).toBe('ignition')
    expect(readPlateId({ plate_id: 3 })).toBe('3')
    expect(readPlateId({})).toBeNull()
  })
})

describe('cancelRevokesNow', () => {
  it('revokes an immediate cancel and keeps a period-end cancel', () => {
    expect(
      cancelRevokesNow({
        subscription_id: 'sub_1',
        product_id: 'pdt_1',
        cancel_at_next_billing_date: false
      })
    ).toBe(true)
    expect(
      cancelRevokesNow({
        subscription_id: 'sub_1',
        product_id: 'pdt_1',
        cancel_at_next_billing_date: true
      })
    ).toBe(false)
    expect(cancelRevokesNow({ subscription_id: 'sub_1' })).toBe(false)
  })
})
