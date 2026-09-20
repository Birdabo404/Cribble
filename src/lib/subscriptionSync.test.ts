import type { SupabaseClient } from '@supabase/supabase-js'
import { APIError } from 'dodopayments'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance
} from 'vitest'

// syncSubscriptionFromDodo is the localhost-safe fulfillment path (webhooks
// can't reach dev servers). The invariants under test: upgrade-only (TEAM
// is never touched, a Pro tier is only ever lifted to TEAM — never
// re-granted or downgraded), an unlinked or missing Dodo customer is a
// clean no-op, objects stamped with another account's userId never
// fulfill, and only a subscription on one of the configured Team/Pro
// products triggers the matching shared grant — Team checked first, even
// for users already sitting on a Pro tier (the misgrant backstop).

const {
  getDodoClientMock,
  subscriptionsListMock,
  subscriptionsRetrieveMock,
  paymentsListMock,
  paymentsRetrieveMock,
  grantProEntitlementMock,
  grantTeamEntitlementMock,
  grantHouseTeamEntitlementMock,
  grantPlatePurchaseMock,
  getOwnedPlateIdsMock,
  insertMissingNotificationsMock,
  linkDodoCustomerMock
} = vi.hoisted(() => ({
  getDodoClientMock: vi.fn(),
  subscriptionsListMock: vi.fn(),
  subscriptionsRetrieveMock: vi.fn(),
  paymentsListMock: vi.fn(),
  paymentsRetrieveMock: vi.fn(),
  grantProEntitlementMock: vi.fn(),
  grantTeamEntitlementMock: vi.fn(),
  grantHouseTeamEntitlementMock: vi.fn(),
  grantPlatePurchaseMock: vi.fn(),
  getOwnedPlateIdsMock: vi.fn(),
  insertMissingNotificationsMock: vi.fn(),
  linkDodoCustomerMock: vi.fn()
}))

// The pure helpers (metadata readers, isDodoMissing) stay real; only the
// client factory and env-backed product lookups are faked.
vi.mock('@/lib/dodo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dodo')>()),
  getDodoClient: getDodoClientMock,
  // pro_yearly deliberately unset to exercise the skip-null path.
  resolveProProductId: (key: string) => (key === 'pro_monthly' ? 'pdt_monthly' : null),
  // Only the monthly team product configured, mirroring the pro setup.
  getTeamProductIds: () => new Set(['pdt_team_monthly'])
}))

vi.mock('@/lib/dodoCustomer', () => ({
  linkDodoCustomer: linkDodoCustomerMock
}))

vi.mock('@/lib/entitlementGrant', () => ({
  grantProEntitlement: grantProEntitlementMock,
  grantTeamEntitlement: grantTeamEntitlementMock,
  grantPlatePurchase: grantPlatePurchaseMock
}))

vi.mock('@/lib/houseEntitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./houseEntitlements')>()),
  grantHouseTeamEntitlement: grantHouseTeamEntitlementMock
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
  acknowledgeCheckoutReturn,
  syncPlateOrdersFromDodo,
  syncSubscriptionFromDodo
} from './subscriptionSync'

function tierSupabase(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve(result) }) })
    })
  } as unknown as SupabaseClient
}

const linked = (row: Record<string, unknown>) =>
  tierSupabase({ data: { dodo_customer_id: 'cus_9', ...row }, error: null })

const freeUser = () => linked({ subscription_tier: 'FREE' })

/** The SDK's auto-paginating list: an async iterable over items. */
function pages<T>(...batches: T[][]) {
  return (async function* () {
    for (const batch of batches) for (const item of batch) yield item
  })()
}

function activeSub(overrides: Record<string, unknown> = {}) {
  return {
    subscription_id: 'sub_1',
    product_id: 'pdt_monthly',
    status: 'active',
    metadata: { userId: 9 },
    customer: { customer_id: 'cus_9', email: 'a@b.c', name: 'A' },
    ...overrides
  }
}

function dodoError(status: number): APIError {
  return new APIError(status, { message: 'dodo says no' }, 'dodo says no', new Headers())
}

function dodoClient() {
  return {
    subscriptions: { list: subscriptionsListMock, retrieve: subscriptionsRetrieveMock },
    payments: { list: paymentsListMock, retrieve: paymentsRetrieveMock }
  }
}

describe('syncSubscriptionFromDodo', () => {
  beforeEach(() => {
    subscriptionsListMock.mockReset()
    grantProEntitlementMock.mockReset()
    grantProEntitlementMock.mockResolvedValue(undefined)
    grantTeamEntitlementMock.mockReset()
    grantTeamEntitlementMock.mockResolvedValue(undefined)
    grantHouseTeamEntitlementMock.mockReset()
    grantHouseTeamEntitlementMock.mockResolvedValue(undefined)
    getDodoClientMock.mockReset()
    getDodoClientMock.mockReturnValue(dodoClient())
  })

  it('grants and reports changed for a FREE user with an active Pro subscription', async () => {
    subscriptionsListMock.mockResolvedValue(pages([activeSub()]))
    const supabase = freeUser()

    const result = await syncSubscriptionFromDodo(supabase, 9)

    expect(subscriptionsListMock).toHaveBeenCalledWith({ customer_id: 'cus_9', status: 'active' })
    expect(grantProEntitlementMock).toHaveBeenCalledWith(supabase, 9, {
      productId: 'pdt_monthly',
      sourceId: 'sub_1'
    })
    expect(grantTeamEntitlementMock).not.toHaveBeenCalled()
    expect(result).toEqual({ tier: 'PRO', isPro: true, changed: true })
  })

  it('grants TEAM from an active team-product subscription', async () => {
    subscriptionsListMock.mockResolvedValue(
      pages([activeSub({ subscription_id: 'sub_t1', product_id: 'pdt_team_monthly' })])
    )
    const supabase = freeUser()

    const result = await syncSubscriptionFromDodo(supabase, 9)

    expect(grantTeamEntitlementMock).toHaveBeenCalledWith(supabase, 9, {
      productId: 'pdt_team_monthly',
      sourceId: 'sub_t1'
    })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
    expect(result).toEqual({ tier: 'TEAM', isPro: false, changed: true })
  })

  it('prefers the team grant when team and Pro subscriptions are both active', async () => {
    subscriptionsListMock.mockResolvedValue(
      pages([
        activeSub({ subscription_id: 'sub_p' }),
        activeSub({ subscription_id: 'sub_t', product_id: 'pdt_team_monthly' })
      ])
    )

    const result = await syncSubscriptionFromDodo(freeUser(), 9)

    expect(grantTeamEntitlementMock).toHaveBeenCalledWith(expect.anything(), 9, {
      productId: 'pdt_team_monthly',
      sourceId: 'sub_t'
    })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
    expect(result).toEqual({ tier: 'TEAM', isPro: false, changed: true })
  })

  it("ignores a subscription stamped with another account's userId (shared Dodo customer)", async () => {
    subscriptionsListMock.mockResolvedValue(pages([activeSub({ metadata: { userId: 13 } })]))

    const result = await syncSubscriptionFromDodo(freeUser(), 9)

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('accepts an unstamped subscription (dashboard-created for the linked customer)', async () => {
    subscriptionsListMock.mockResolvedValue(pages([activeSub({ metadata: {} })]))

    const result = await syncSubscriptionFromDodo(freeUser(), 9)

    expect(result.changed).toBe(true)
    expect(grantProEntitlementMock).toHaveBeenCalledTimes(1)
  })

  it('grants house complimentary Pro without asking Dodo', async () => {
    const result = await syncSubscriptionFromDodo(
      linked({ subscription_tier: 'FREE', twitter_username: 'birdabo' }),
      8
    )

    expect(result).toEqual({ tier: 'PRO', isPro: true, changed: true })
    expect(grantProEntitlementMock).toHaveBeenCalledWith(expect.anything(), 8)
    expect(subscriptionsListMock).not.toHaveBeenCalled()
    expect(grantTeamEntitlementMock).not.toHaveBeenCalled()
  })

  it('leaves an already-Pro house account alone without asking Dodo', async () => {
    const result = await syncSubscriptionFromDodo(
      linked({ subscription_tier: 'PRO', twitter_username: 'birdabo' }),
      8
    )

    expect(result).toEqual({ tier: 'PRO', isPro: true, changed: false })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
    expect(subscriptionsListMock).not.toHaveBeenCalled()
  })

  it('grants house complimentary Team without asking Dodo', async () => {
    const result = await syncSubscriptionFromDodo(
      linked({ subscription_tier: 'FREE', twitter_username: 'cribble_ai', team_review_status: null }),
      19
    )

    expect(result).toEqual({ tier: 'TEAM', isPro: false, changed: true })
    expect(grantHouseTeamEntitlementMock).toHaveBeenCalledWith(expect.anything(), 19)
    expect(subscriptionsListMock).not.toHaveBeenCalled()
    expect(grantTeamEntitlementMock).not.toHaveBeenCalled()
  })

  it('leaves an approved house Team account alone without asking Dodo', async () => {
    const result = await syncSubscriptionFromDodo(
      linked({
        subscription_tier: 'TEAM',
        twitter_username: 'cribble_ai',
        team_review_status: 'approved'
      }),
      19
    )

    expect(result).toEqual({ tier: 'TEAM', isPro: false, changed: false })
    expect(grantHouseTeamEntitlementMock).not.toHaveBeenCalled()
    expect(subscriptionsListMock).not.toHaveBeenCalled()
  })

  it('leaves an existing TEAM account alone without calling Dodo or any grant', async () => {
    const result = await syncSubscriptionFromDodo(linked({ subscription_tier: 'TEAM' }), 9)

    expect(result).toEqual({ tier: 'TEAM', isPro: false, changed: false })
    expect(subscriptionsListMock).not.toHaveBeenCalled()
    expect(grantTeamEntitlementMock).not.toHaveBeenCalled()
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('reconciles an existing Pro tier up to TEAM when Dodo holds an active team subscription', async () => {
    // The Polar-era production incident: the webhook misgranted a Team
    // purchase as Pro, and the old isPro short-circuit then blocked this
    // sync from ever correcting it.
    subscriptionsListMock.mockResolvedValue(
      pages([activeSub({ subscription_id: 'sub_t2', product_id: 'pdt_team_monthly' })])
    )
    const supabase = linked({ subscription_tier: 'PRO' })

    const result = await syncSubscriptionFromDodo(supabase, 9)

    expect(grantTeamEntitlementMock).toHaveBeenCalledWith(supabase, 9, {
      productId: 'pdt_team_monthly',
      sourceId: 'sub_t2'
    })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
    expect(result).toEqual({ tier: 'TEAM', isPro: false, changed: true })
  })

  it('finds the Pro subscription even when it is not first in the list', async () => {
    subscriptionsListMock.mockResolvedValue(
      pages([
        activeSub({ subscription_id: 'sub_other', product_id: 'pdt_unrelated' }),
        activeSub({ subscription_id: 'sub_2' })
      ])
    )

    const result = await syncSubscriptionFromDodo(freeUser(), 9)

    expect(grantProEntitlementMock).toHaveBeenCalledWith(expect.anything(), 9, {
      productId: 'pdt_monthly',
      sourceId: 'sub_2'
    })
    expect(result.changed).toBe(true)
  })

  it('leaves an already-Pro user alone when Dodo shows no team subscription (Pro never re-grants)', async () => {
    // Dodo IS consulted (the team check must run for Pro users), but an
    // active Pro-product subscription must not re-run the Pro grant —
    // that would re-stamp premium_since and re-notify.
    subscriptionsListMock.mockResolvedValue(pages([activeSub()]))

    const result = await syncSubscriptionFromDodo(linked({ subscription_tier: 'PRO' }), 9)

    expect(result).toEqual({ tier: 'PRO', isPro: true, changed: false })
    expect(subscriptionsListMock).toHaveBeenCalledWith({ customer_id: 'cus_9', status: 'active' })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
    expect(grantTeamEntitlementMock).not.toHaveBeenCalled()
  })

  it('reports unchanged without asking Dodo when the account has no linked customer', async () => {
    const result = await syncSubscriptionFromDodo(
      tierSupabase({ data: { subscription_tier: 'FREE', dodo_customer_id: null }, error: null }),
      9
    )

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(subscriptionsListMock).not.toHaveBeenCalled()
  })

  it('treats a customer Dodo no longer knows (404/422) as nothing-to-sync', async () => {
    for (const status of [404, 422]) {
      subscriptionsListMock.mockRejectedValueOnce(dodoError(status))
      const result = await syncSubscriptionFromDodo(freeUser(), 9)
      expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    }
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('reports unchanged when no active subscription is on a Pro product', async () => {
    subscriptionsListMock.mockResolvedValue(
      pages([activeSub({ subscription_id: 'sub_x', product_id: 'pdt_unrelated' })])
    )

    const result = await syncSubscriptionFromDodo(freeUser(), 9)

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('reports unchanged when the customer has no active subscriptions at all', async () => {
    subscriptionsListMock.mockResolvedValue(pages([]))

    const result = await syncSubscriptionFromDodo(freeUser(), 9)

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('rethrows unexpected Dodo errors (auth/permission problems must surface)', async () => {
    subscriptionsListMock.mockRejectedValue(dodoError(403))

    await expect(syncSubscriptionFromDodo(freeUser(), 9)).rejects.toThrow('dodo says no')
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('degrades to FREE/unchanged when the tier read fails, without calling Dodo', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await syncSubscriptionFromDodo(
      tierSupabase({ data: null, error: { message: 'connection refused' } }),
      9
    )
    errorSpy.mockRestore()

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(subscriptionsListMock).not.toHaveBeenCalled()
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('reports unchanged when Dodo is not configured', async () => {
    getDodoClientMock.mockReturnValue(null)

    const result = await syncSubscriptionFromDodo(freeUser(), 9)

    expect(result).toEqual({ tier: 'FREE', isPro: false, changed: false })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })
})

// syncPlateOrdersFromDodo is the durable fix for missed payment.succeeded
// webhooks: every sync pulls the customer's succeeded payments and grants
// any plate that never landed locally. Invariants under test: only
// succeeded, non-refunded, non-subscription payments stamped with a real
// catalog plate id for THIS user grant; owned plates never re-grant; one
// bad payment never blocks the rest.
describe('syncPlateOrdersFromDodo', () => {
  const supabase = freeUser()

  function paidPlate(overrides: Record<string, unknown> = {}) {
    return {
      payment_id: 'pay_1',
      status: 'succeeded',
      refund_status: null,
      subscription_id: null,
      metadata: { userId: 9 },
      customer: { customer_id: 'cus_9', email: 'a@b.c', name: 'A' },
      ...overrides
    }
  }

  beforeEach(() => {
    paymentsListMock.mockReset()
    grantPlatePurchaseMock.mockReset()
    grantPlatePurchaseMock.mockResolvedValue(undefined)
    getOwnedPlateIdsMock.mockReset()
    getOwnedPlateIdsMock.mockResolvedValue([])
    getDodoClientMock.mockReset()
    getDodoClientMock.mockReturnValue(dodoClient())
  })

  it('grants plates from succeeded payments across pages and reports the count', async () => {
    paymentsListMock.mockResolvedValue(
      pages(
        [paidPlate({ payment_id: 'pay_1', metadata: { userId: 9, plateId: 'deep-space' } })],
        [paidPlate({ payment_id: 'pay_2', metadata: { userId: '9', plate_id: 'koi-pond' } })]
      )
    )

    const granted = await syncPlateOrdersFromDodo(supabase, 9)

    expect(paymentsListMock).toHaveBeenCalledWith({ customer_id: 'cus_9', status: 'succeeded' })
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(supabase, 9, {
      plateId: 'deep-space',
      orderId: 'pay_1'
    })
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(supabase, 9, {
      plateId: 'koi-pond',
      orderId: 'pay_2'
    })
    expect(granted).toBe(2)
  })

  it('skips refunded, partially refunded and no-longer-succeeded payments', async () => {
    paymentsListMock.mockResolvedValue(
      pages([
        paidPlate({ payment_id: 'p1', refund_status: 'full', metadata: { plateId: 'deep-space' } }),
        paidPlate({ payment_id: 'p2', refund_status: 'partial', metadata: { plateId: 'koi-pond' } }),
        paidPlate({ payment_id: 'p3', status: 'processing', metadata: { plateId: 'terminal-rain' } })
      ])
    )

    expect(await syncPlateOrdersFromDodo(supabase, 9)).toBe(0)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('skips subscription-cycle payments, unstamped payments and unknown catalog ids', async () => {
    paymentsListMock.mockResolvedValue(
      pages([
        paidPlate({ payment_id: 'p1', subscription_id: 'sub_1', metadata: { plateId: 'deep-space' } }),
        paidPlate({ payment_id: 'p2', metadata: {} }),
        paidPlate({ payment_id: 'p3', metadata: { plateId: 'not-a-real-plate' } })
      ])
    )

    expect(await syncPlateOrdersFromDodo(supabase, 9)).toBe(0)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it("skips payments stamped with another account's userId (shared Dodo customer)", async () => {
    paymentsListMock.mockResolvedValue(
      pages([paidPlate({ metadata: { userId: 13, plateId: 'deep-space' } })])
    )

    expect(await syncPlateOrdersFromDodo(supabase, 9)).toBe(0)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('skips plates already owned locally', async () => {
    getOwnedPlateIdsMock.mockResolvedValue(['deep-space'])
    paymentsListMock.mockResolvedValue(
      pages([paidPlate({ metadata: { userId: 9, plateId: 'deep-space' } })])
    )

    expect(await syncPlateOrdersFromDodo(supabase, 9)).toBe(0)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('grants a plate once even when several succeeded payments carry it', async () => {
    paymentsListMock.mockResolvedValue(
      pages([
        paidPlate({ payment_id: 'p1', metadata: { userId: 9, plateId: 'deep-space' } }),
        paidPlate({ payment_id: 'p2', metadata: { userId: 9, plateId: 'deep-space' } })
      ])
    )

    expect(await syncPlateOrdersFromDodo(supabase, 9)).toBe(1)
    expect(grantPlatePurchaseMock).toHaveBeenCalledTimes(1)
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(supabase, 9, {
      plateId: 'deep-space',
      orderId: 'p1'
    })
  })

  it('returns 0 when Dodo is not configured', async () => {
    getDodoClientMock.mockReturnValue(null)

    expect(await syncPlateOrdersFromDodo(supabase, 9)).toBe(0)
    expect(paymentsListMock).not.toHaveBeenCalled()
  })

  it('returns 0 without asking Dodo when the account has no linked customer', async () => {
    expect(
      await syncPlateOrdersFromDodo(
        tierSupabase({ data: { subscription_tier: 'FREE', dodo_customer_id: null }, error: null }),
        9
      )
    ).toBe(0)
    expect(paymentsListMock).not.toHaveBeenCalled()
  })

  it('treats a customer Dodo no longer knows (404/422) as nothing-to-grant', async () => {
    for (const status of [404, 422]) {
      paymentsListMock.mockRejectedValueOnce(dodoError(status))
      expect(await syncPlateOrdersFromDodo(supabase, 9)).toBe(0)
    }
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('rethrows unexpected Dodo errors (auth/permission problems must surface)', async () => {
    paymentsListMock.mockRejectedValue(dodoError(403))

    await expect(syncPlateOrdersFromDodo(supabase, 9)).rejects.toThrow('dodo says no')
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('logs and continues when a single grant fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    grantPlatePurchaseMock
      .mockRejectedValueOnce(new Error('db exploded'))
      .mockResolvedValueOnce(undefined)
    paymentsListMock.mockResolvedValue(
      pages([
        paidPlate({ payment_id: 'p1', metadata: { userId: 9, plateId: 'deep-space' } }),
        paidPlate({ payment_id: 'p2', metadata: { userId: 9, plateId: 'koi-pond' } })
      ])
    )

    const granted = await syncPlateOrdersFromDodo(supabase, 9)
    errorSpy.mockRestore()

    expect(granted).toBe(1)
    expect(grantPlatePurchaseMock).toHaveBeenCalledTimes(2)
  })
})

// acknowledgeCheckoutReturn backs the shop's checkout=success bounce: the
// ack must only land for the user whose checkout metadata is on the
// object, it links the Dodo customer (the first-purchase bootstrap for
// the syncs above), is deduped per object id, and must never throw into
// the sync route.
describe('acknowledgeCheckoutReturn', () => {
  const supabase = {} as unknown as SupabaseClient
  let warnSpy: MockInstance
  let errorSpy: MockInstance

  beforeEach(() => {
    paymentsRetrieveMock.mockReset()
    subscriptionsRetrieveMock.mockReset()
    insertMissingNotificationsMock.mockReset()
    insertMissingNotificationsMock.mockResolvedValue(undefined)
    linkDodoCustomerMock.mockReset()
    linkDodoCustomerMock.mockResolvedValue(undefined)
    getDodoClientMock.mockReset()
    getDodoClientMock.mockReturnValue(dodoClient())
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('acks a plate payment for its owner, links the customer and carries the plate id', async () => {
    paymentsRetrieveMock.mockResolvedValue({
      payment_id: 'pay_1',
      customer: { customer_id: 'cus_9' },
      metadata: { userId: 9, plateId: 'deep-space' }
    })

    await acknowledgeCheckoutReturn(supabase, 9, { paymentId: 'pay_1' })

    expect(paymentsRetrieveMock).toHaveBeenCalledWith('pay_1')
    expect(linkDodoCustomerMock).toHaveBeenCalledWith(supabase, 9, 'cus_9')
    expect(insertMissingNotificationsMock).toHaveBeenCalledWith(supabase, 9, [
      {
        type: 'shop',
        title: 'THANK YOU FOR YOUR PURCHASE',
        body: 'Order confirmed — we are currently delivering it to your hangar.',
        data: { kind: 'purchase_ack', paymentId: 'pay_1', plateId: 'deep-space' },
        dedupeKey: 'purchase_ack_pay_1'
      }
    ])
  })

  it('acks a subscription for its owner without a plate id', async () => {
    subscriptionsRetrieveMock.mockResolvedValue({
      subscription_id: 'sub_2',
      customer: { customer_id: 'cus_9' },
      metadata: { userId: '9' }
    })

    await acknowledgeCheckoutReturn(supabase, 9, { subscriptionId: 'sub_2' })

    expect(subscriptionsRetrieveMock).toHaveBeenCalledWith('sub_2')
    expect(paymentsRetrieveMock).not.toHaveBeenCalled()
    expect(linkDodoCustomerMock).toHaveBeenCalledWith(supabase, 9, 'cus_9')
    const candidates = insertMissingNotificationsMock.mock.calls[0][2] as Array<{
      data: Record<string, unknown>
      dedupeKey: string
    }>
    expect(candidates[0].data).toEqual({ kind: 'purchase_ack', subscriptionId: 'sub_2' })
    expect(candidates[0].dedupeKey).toBe('purchase_ack_sub_2')
  })

  it('prefers the payment id when both are supplied', async () => {
    paymentsRetrieveMock.mockResolvedValue({
      payment_id: 'pay_1',
      customer: { customer_id: 'cus_9' },
      metadata: { userId: 9 }
    })

    await acknowledgeCheckoutReturn(supabase, 9, { paymentId: 'pay_1', subscriptionId: 'sub_2' })

    expect(paymentsRetrieveMock).toHaveBeenCalledWith('pay_1')
    expect(subscriptionsRetrieveMock).not.toHaveBeenCalled()
  })

  it('skips the ack and the link when the object belongs to a different user', async () => {
    paymentsRetrieveMock.mockResolvedValue({
      payment_id: 'pay_3',
      customer: { customer_id: 'cus_777' },
      metadata: { userId: 777 }
    })

    await acknowledgeCheckoutReturn(supabase, 9, { paymentId: 'pay_3' })

    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
    expect(linkDodoCustomerMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('skips an unstamped object — the ack needs positive proof of ownership', async () => {
    paymentsRetrieveMock.mockResolvedValue({
      payment_id: 'pay_4',
      customer: { customer_id: 'cus_9' },
      metadata: {}
    })

    await acknowledgeCheckoutReturn(supabase, 9, { paymentId: 'pay_4' })

    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
    expect(linkDodoCustomerMock).not.toHaveBeenCalled()
  })

  it('drops malformed ids without calling Dodo', async () => {
    await acknowledgeCheckoutReturn(supabase, 9, { paymentId: 'pay_1; DROP TABLE users' })
    await acknowledgeCheckoutReturn(supabase, 9, { subscriptionId: 'x'.repeat(65) })
    await acknowledgeCheckoutReturn(supabase, 9, { paymentId: '' })
    await acknowledgeCheckoutReturn(supabase, 9, {})

    expect(paymentsRetrieveMock).not.toHaveBeenCalled()
    expect(subscriptionsRetrieveMock).not.toHaveBeenCalled()
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })

  it('logs and swallows Dodo lookup failures (ack never fails the sync)', async () => {
    paymentsRetrieveMock.mockRejectedValue(dodoError(500))

    await expect(
      acknowledgeCheckoutReturn(supabase, 9, { paymentId: 'pay_5' })
    ).resolves.toBeUndefined()

    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('no-ops when Dodo is not configured', async () => {
    getDodoClientMock.mockReturnValue(null)

    await acknowledgeCheckoutReturn(supabase, 9, { paymentId: 'pay_6' })

    expect(paymentsRetrieveMock).not.toHaveBeenCalled()
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })
})
