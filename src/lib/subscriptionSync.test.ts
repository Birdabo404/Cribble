import type { SupabaseClient } from '@supabase/supabase-js'
import { PolarError } from '@polar-sh/sdk/models/errors/polarerror'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// syncSubscriptionFromPolar is the localhost-safe fulfillment path (webhooks
// can't reach dev servers). The invariants under test: upgrade-only (a Pro
// tier is never touched), a missing Polar customer is a clean no-op, and
// only a subscription on one of the configured Pro products triggers the
// shared grant.

const { getPolarClientMock, getStateExternalMock, grantProEntitlementMock } = vi.hoisted(
  () => ({
    getPolarClientMock: vi.fn(),
    getStateExternalMock: vi.fn(),
    grantProEntitlementMock: vi.fn()
  })
)

vi.mock('@/lib/polar', () => ({
  getPolarClient: getPolarClientMock,
  // pro_yearly deliberately unset to exercise the skip-null path.
  resolveProProductId: (key: string) => (key === 'pro_monthly' ? 'prod_monthly' : null)
}))

vi.mock('@/lib/entitlementGrant', () => ({
  grantProEntitlement: grantProEntitlementMock
}))

import { syncSubscriptionFromPolar } from './subscriptionSync'

function tierSupabase(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve(result) }) })
    })
  } as unknown as SupabaseClient
}

const freeUser = () => tierSupabase({ data: { subscription_tier: 'FREE' }, error: null })

function customerState(subscriptions: Array<{ id: string; productId: string }>) {
  return { activeSubscriptions: subscriptions }
}

function polarError(statusCode: number): PolarError {
  return new PolarError('polar says no', {
    response: new Response('{}', { status: statusCode }),
    request: new Request('https://sandbox-api.polar.sh/v1/customers/external/9/state'),
    body: '{}'
  })
}

describe('syncSubscriptionFromPolar', () => {
  beforeEach(() => {
    getStateExternalMock.mockReset()
    grantProEntitlementMock.mockReset()
    grantProEntitlementMock.mockResolvedValue(undefined)
    getPolarClientMock.mockReset()
    getPolarClientMock.mockReturnValue({
      customers: { getStateExternal: getStateExternalMock }
    })
  })

  it('grants and reports changed for a FREE user with an active Pro subscription', async () => {
    getStateExternalMock.mockResolvedValue(
      customerState([{ id: 'sub_1', productId: 'prod_monthly' }])
    )
    const supabase = freeUser()

    const result = await syncSubscriptionFromPolar(supabase, 9)

    expect(getStateExternalMock).toHaveBeenCalledWith({ externalId: '9' })
    expect(grantProEntitlementMock).toHaveBeenCalledWith(supabase, 9, {
      productId: 'prod_monthly',
      sourceId: 'sub_1'
    })
    expect(result).toEqual({ tier: 'PRO', isPro: true, changed: true })
  })

  it('finds the Pro subscription even when it is not first in the list', async () => {
    getStateExternalMock.mockResolvedValue(
      customerState([
        { id: 'sub_other', productId: 'prod_unrelated' },
        { id: 'sub_2', productId: 'prod_monthly' }
      ])
    )

    const result = await syncSubscriptionFromPolar(freeUser(), 9)

    expect(grantProEntitlementMock).toHaveBeenCalledWith(expect.anything(), 9, {
      productId: 'prod_monthly',
      sourceId: 'sub_2'
    })
    expect(result.changed).toBe(true)
  })

  it('leaves an already-Pro user alone without calling Polar or the grant', async () => {
    const result = await syncSubscriptionFromPolar(
      tierSupabase({ data: { subscription_tier: 'PRO' }, error: null }),
      9
    )

    expect(result).toEqual({ tier: 'PRO', isPro: true, changed: false })
    expect(getStateExternalMock).not.toHaveBeenCalled()
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('treats a missing Polar customer (404/422) as nothing-to-sync', async () => {
    for (const status of [404, 422]) {
      getStateExternalMock.mockRejectedValueOnce(polarError(status))
      const result = await syncSubscriptionFromPolar(freeUser(), 9)
      expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    }
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('reports unchanged when no active subscription is on a Pro product', async () => {
    getStateExternalMock.mockResolvedValue(
      customerState([{ id: 'sub_x', productId: 'prod_unrelated' }])
    )

    const result = await syncSubscriptionFromPolar(freeUser(), 9)

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('reports unchanged when the customer has no active subscriptions at all', async () => {
    getStateExternalMock.mockResolvedValue(customerState([]))

    const result = await syncSubscriptionFromPolar(freeUser(), 9)

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('rethrows unexpected Polar errors (scope/permission problems must surface)', async () => {
    getStateExternalMock.mockRejectedValue(polarError(403))

    await expect(syncSubscriptionFromPolar(freeUser(), 9)).rejects.toThrow('polar says no')
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('degrades to FREE/unchanged when the tier read fails, without calling Polar', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await syncSubscriptionFromPolar(
      tierSupabase({ data: null, error: { message: 'connection refused' } }),
      9
    )
    errorSpy.mockRestore()

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(getStateExternalMock).not.toHaveBeenCalled()
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('reports unchanged when Polar is not configured', async () => {
    getPolarClientMock.mockReturnValue(null)

    const result = await syncSubscriptionFromPolar(freeUser(), 9)

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })
})
