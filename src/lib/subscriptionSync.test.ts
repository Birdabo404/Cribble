import type { SupabaseClient } from '@supabase/supabase-js'
import { PolarError } from '@polar-sh/sdk/models/errors/polarerror'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance
} from 'vitest'

// syncSubscriptionFromPolar is the localhost-safe fulfillment path (webhooks
// can't reach dev servers). The invariants under test: upgrade-only (a Pro
// tier is never touched), a missing Polar customer is a clean no-op, and
// only a subscription on one of the configured Pro products triggers the
// shared grant.

const {
  getPolarClientMock,
  getStateExternalMock,
  ordersListMock,
  checkoutsGetMock,
  grantProEntitlementMock,
  grantPlatePurchaseMock,
  getOwnedPlateIdsMock,
  insertMissingNotificationsMock
} = vi.hoisted(() => ({
  getPolarClientMock: vi.fn(),
  getStateExternalMock: vi.fn(),
  ordersListMock: vi.fn(),
  checkoutsGetMock: vi.fn(),
  grantProEntitlementMock: vi.fn(),
  grantPlatePurchaseMock: vi.fn(),
  getOwnedPlateIdsMock: vi.fn(),
  insertMissingNotificationsMock: vi.fn()
}))

vi.mock('@/lib/polar', () => ({
  getPolarClient: getPolarClientMock,
  // pro_yearly deliberately unset to exercise the skip-null path.
  resolveProProductId: (key: string) => (key === 'pro_monthly' ? 'prod_monthly' : null)
}))

vi.mock('@/lib/entitlementGrant', () => ({
  grantProEntitlement: grantProEntitlementMock,
  grantPlatePurchase: grantPlatePurchaseMock
}))

// Only the DB read is faked — isProTier stays real so tier strings are
// interpreted exactly as in production.
vi.mock('@/lib/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./entitlements')>()),
  getOwnedPlateIds: getOwnedPlateIdsMock
}))

vi.mock('@/lib/notifications', () => ({
  insertMissingNotifications: insertMissingNotificationsMock
}))

import {
  insertCheckoutAckNotification,
  syncPlateOrdersFromPolar,
  syncSubscriptionFromPolar
} from './subscriptionSync'

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

// syncPlateOrdersFromPolar is the durable fix for missed order.paid
// webhooks: every sync pulls the customer's paid orders and grants any
// plate that never landed locally. Invariants under test: only paid,
// non-refunded orders carrying a real catalog plate id grant; owned
// plates never re-grant; one bad order never blocks the rest.
describe('syncPlateOrdersFromPolar', () => {
  const supabase = {} as unknown as SupabaseClient

  function orderPages(...pages: Array<Array<Record<string, unknown>>>) {
    return (async function* () {
      for (const items of pages) yield { result: { items } }
    })()
  }

  function paidOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order_1',
      paid: true,
      status: 'paid',
      metadata: {},
      product: { metadata: {} },
      ...overrides
    }
  }

  beforeEach(() => {
    ordersListMock.mockReset()
    grantPlatePurchaseMock.mockReset()
    grantPlatePurchaseMock.mockResolvedValue(undefined)
    getOwnedPlateIdsMock.mockReset()
    getOwnedPlateIdsMock.mockResolvedValue([])
    getPolarClientMock.mockReset()
    getPolarClientMock.mockReturnValue({
      customers: { getStateExternal: getStateExternalMock },
      orders: { list: ordersListMock },
      checkouts: { get: checkoutsGetMock }
    })
  })

  it('grants plates from paid orders across pages and reports the count', async () => {
    ordersListMock.mockResolvedValue(
      orderPages(
        [paidOrder({ id: 'order_1', product: { metadata: { plate_id: 'deep-space' } } })],
        [paidOrder({ id: 'order_2', metadata: { plateId: 'koi-pond' } })]
      )
    )

    const granted = await syncPlateOrdersFromPolar(supabase, 9)

    expect(ordersListMock).toHaveBeenCalledWith({ externalCustomerId: '9', limit: 100 })
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(supabase, 9, {
      plateId: 'deep-space',
      orderId: 'order_1'
    })
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(supabase, 9, {
      plateId: 'koi-pond',
      orderId: 'order_2'
    })
    expect(granted).toBe(2)
  })

  it('resolves the plate id from all three metadata key variants', async () => {
    ordersListMock.mockResolvedValue(
      orderPages([
        paidOrder({ id: 'o1', product: { metadata: { plate_id: 'deep-space' } } }),
        paidOrder({ id: 'o2', metadata: { plateId: 'koi-pond' } }),
        paidOrder({ id: 'o3', metadata: { plate_id: 'terminal-rain' } })
      ])
    )

    const granted = await syncPlateOrdersFromPolar(supabase, 9)

    expect(grantPlatePurchaseMock.mock.calls.map((call) => call[2])).toEqual([
      { plateId: 'deep-space', orderId: 'o1' },
      { plateId: 'koi-pond', orderId: 'o2' },
      { plateId: 'terminal-rain', orderId: 'o3' }
    ])
    expect(granted).toBe(3)
  })

  it('skips refunded, partially refunded and unpaid orders', async () => {
    ordersListMock.mockResolvedValue(
      orderPages([
        paidOrder({
          id: 'o1',
          status: 'refunded',
          product: { metadata: { plate_id: 'deep-space' } }
        }),
        paidOrder({
          id: 'o2',
          status: 'partially_refunded',
          product: { metadata: { plate_id: 'koi-pond' } }
        }),
        paidOrder({
          id: 'o3',
          paid: false,
          status: 'pending',
          product: { metadata: { plate_id: 'terminal-rain' } }
        })
      ])
    )

    expect(await syncPlateOrdersFromPolar(supabase, 9)).toBe(0)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('skips subscription-cycle orders (no plate id) and unknown catalog ids', async () => {
    ordersListMock.mockResolvedValue(
      orderPages([
        paidOrder({ id: 'o1' }),
        paidOrder({ id: 'o2', product: { metadata: { plate_id: 'not-a-real-plate' } } })
      ])
    )

    expect(await syncPlateOrdersFromPolar(supabase, 9)).toBe(0)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('skips plates already owned locally', async () => {
    getOwnedPlateIdsMock.mockResolvedValue(['deep-space'])
    ordersListMock.mockResolvedValue(
      orderPages([paidOrder({ id: 'o1', product: { metadata: { plate_id: 'deep-space' } } })])
    )

    expect(await syncPlateOrdersFromPolar(supabase, 9)).toBe(0)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('grants a plate once even when several paid orders carry it', async () => {
    ordersListMock.mockResolvedValue(
      orderPages([
        paidOrder({ id: 'o1', product: { metadata: { plate_id: 'deep-space' } } }),
        paidOrder({ id: 'o2', product: { metadata: { plate_id: 'deep-space' } } })
      ])
    )

    expect(await syncPlateOrdersFromPolar(supabase, 9)).toBe(1)
    expect(grantPlatePurchaseMock).toHaveBeenCalledTimes(1)
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(supabase, 9, {
      plateId: 'deep-space',
      orderId: 'o1'
    })
  })

  it('returns 0 when Polar is not configured', async () => {
    getPolarClientMock.mockReturnValue(null)

    expect(await syncPlateOrdersFromPolar(supabase, 9)).toBe(0)
    expect(ordersListMock).not.toHaveBeenCalled()
  })

  it('treats a missing Polar customer (404/422) as nothing-to-grant', async () => {
    for (const status of [404, 422]) {
      ordersListMock.mockRejectedValueOnce(polarError(status))
      expect(await syncPlateOrdersFromPolar(supabase, 9)).toBe(0)
    }
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('rethrows unexpected Polar errors (scope/permission problems must surface)', async () => {
    ordersListMock.mockRejectedValue(polarError(403))

    await expect(syncPlateOrdersFromPolar(supabase, 9)).rejects.toThrow('polar says no')
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('logs and continues when a single grant fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    grantPlatePurchaseMock
      .mockRejectedValueOnce(new Error('db exploded'))
      .mockResolvedValueOnce(undefined)
    ordersListMock.mockResolvedValue(
      orderPages([
        paidOrder({ id: 'o1', product: { metadata: { plate_id: 'deep-space' } } }),
        paidOrder({ id: 'o2', product: { metadata: { plate_id: 'koi-pond' } } })
      ])
    )

    const granted = await syncPlateOrdersFromPolar(supabase, 9)
    errorSpy.mockRestore()

    expect(granted).toBe(1)
    expect(grantPlatePurchaseMock).toHaveBeenCalledTimes(2)
  })
})

// insertCheckoutAckNotification backs the shop's checkout=success bounce:
// the ack must only land for the user who actually owns the checkout,
// deduped per checkout id, and must never throw into the sync route.
describe('insertCheckoutAckNotification', () => {
  const supabase = {} as unknown as SupabaseClient
  let warnSpy: MockInstance
  let errorSpy: MockInstance

  beforeEach(() => {
    checkoutsGetMock.mockReset()
    insertMissingNotificationsMock.mockReset()
    insertMissingNotificationsMock.mockResolvedValue(undefined)
    getPolarClientMock.mockReset()
    getPolarClientMock.mockReturnValue({
      customers: { getStateExternal: getStateExternalMock },
      orders: { list: ordersListMock },
      checkouts: { get: checkoutsGetMock }
    })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('inserts the deduped ack for the checkout owner, carrying the plate id', async () => {
    checkoutsGetMock.mockResolvedValue({
      id: 'chk_1',
      externalCustomerId: '9',
      metadata: { plateId: 'deep-space' }
    })

    await insertCheckoutAckNotification(supabase, 9, 'chk_1')

    expect(checkoutsGetMock).toHaveBeenCalledWith({ id: 'chk_1' })
    expect(insertMissingNotificationsMock).toHaveBeenCalledWith(supabase, 9, [
      {
        type: 'shop',
        title: 'THANK YOU FOR YOUR PURCHASE',
        body: 'Order confirmed — we are currently delivering it to your hangar.',
        data: { kind: 'purchase_ack', checkoutId: 'chk_1', plateId: 'deep-space' },
        dedupeKey: 'purchase_ack_chk_1'
      }
    ])
  })

  it('omits plateId for checkouts without plate metadata (Pro subscriptions)', async () => {
    checkoutsGetMock.mockResolvedValue({
      id: 'chk_2',
      externalCustomerId: '9',
      metadata: { userId: 9 }
    })

    await insertCheckoutAckNotification(supabase, 9, 'chk_2')

    const candidates = insertMissingNotificationsMock.mock.calls[0][2] as Array<{
      data: Record<string, unknown>
    }>
    expect(candidates[0].data).toEqual({ kind: 'purchase_ack', checkoutId: 'chk_2' })
  })

  it('skips the ack when the checkout belongs to a different user', async () => {
    checkoutsGetMock.mockResolvedValue({
      id: 'chk_3',
      externalCustomerId: '777',
      metadata: {}
    })

    await insertCheckoutAckNotification(supabase, 9, 'chk_3')

    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('drops malformed checkout ids without calling Polar', async () => {
    await insertCheckoutAckNotification(supabase, 9, 'chk_1; DROP TABLE users')
    await insertCheckoutAckNotification(supabase, 9, 'x'.repeat(65))
    await insertCheckoutAckNotification(supabase, 9, '')

    expect(checkoutsGetMock).not.toHaveBeenCalled()
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })

  it('logs and swallows Polar lookup failures (ack never fails the sync)', async () => {
    checkoutsGetMock.mockRejectedValue(polarError(500))

    await expect(insertCheckoutAckNotification(supabase, 9, 'chk_4')).resolves.toBeUndefined()

    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('no-ops when Polar is not configured', async () => {
    getPolarClientMock.mockReturnValue(null)

    await insertCheckoutAckNotification(supabase, 9, 'chk_5')

    expect(checkoutsGetMock).not.toHaveBeenCalled()
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })
})
