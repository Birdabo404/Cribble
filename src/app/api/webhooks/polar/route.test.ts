import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// The webhook's subscription contract: subscription.active branches on
// the product — configured team product ids OR a product tagged with
// `team_key` metadata (the setup script's stamp; the fallback when the
// POLAR_PRODUCT_TEAM_* env vars are missing/stale) get the Team grant,
// everything else the Pro grant. subscription.revoked downgrades ONLY
// the tier value this integration writes for that product ('TEAM' or
// 'PRO'), so a manually granted PREMIUM/PREMIUM+ survives a lapsed
// Polar sub — the admin panel's revoke_pro is the explicit path for
// those. Signature verification and event parsing are mocked; the DB
// writes are what's under test.

const {
  validateEventMock,
  grantProEntitlementMock,
  grantTeamEntitlementMock,
  grantPlatePurchaseMock,
  paymentEventsInsertMock,
  usersUpdateMock,
  usersUpdateEqMock,
  teamProductIds,
  bidsReadEqMock,
  bidsReadResult,
  bidsUpdateMock,
  bidsUpdateEqMock,
  bidsUpdateInMock,
  bidsUpdateResult,
  leaderboardBidProductId,
  slotActivateMock,
  slotRevokeMock
} = vi.hoisted(() => ({
  validateEventMock: vi.fn(),
  grantProEntitlementMock: vi.fn(),
  grantTeamEntitlementMock: vi.fn(),
  grantPlatePurchaseMock: vi.fn(),
  paymentEventsInsertMock: vi.fn(),
  usersUpdateMock: vi.fn(),
  usersUpdateEqMock: vi.fn(),
  teamProductIds: new Set<string>(),
  // Sponsor-bid ledger (leaderboard_sponsor_bids) plumbing: the read
  // behind activation's verification, and the guarded status updates.
  bidsReadEqMock: vi.fn(),
  bidsReadResult: { value: { data: null, error: null } as { data: unknown; error: unknown } },
  bidsUpdateMock: vi.fn(),
  bidsUpdateEqMock: vi.fn(),
  bidsUpdateInMock: vi.fn(),
  bidsUpdateResult: {
    value: { data: [{ id: 55 }], error: null } as { data: unknown; error: unknown }
  },
  leaderboardBidProductId: { value: null as string | null },
  // Billboard slot fulfillment (migration 061) is mocked at the module
  // boundary: its verification gate + window stamping run against a
  // stateful multi-table fake in billboardSlotServer.test.ts, so the
  // webhook suite only pins the WIRING — both order events must reach
  // it, and its resolved refusals must still ack.
  slotActivateMock: vi.fn(),
  slotRevokeMock: vi.fn()
}))

vi.mock('@polar-sh/sdk/webhooks', () => ({
  validateEvent: validateEventMock,
  WebhookVerificationError: class WebhookVerificationError extends Error {}
}))

vi.mock('@/lib/polar', () => ({
  getPolarWebhookSecret: () => 'whsec_test',
  getTeamProductIds: () => teamProductIds,
  // Mirrors the real helper's logic over the mocked id set: configured
  // product id first, then the product's team_key metadata fallback.
  isTeamSubscription: (subscription: {
    productId: string
    product?: { metadata?: Record<string, unknown> } | null
  }) => {
    if (teamProductIds.has(subscription.productId)) return true
    const teamKey = subscription.product?.metadata?.['team_key']
    return typeof teamKey === 'string' && teamKey.length > 0
  },
  // Sponsor-bid activation (leaderboardSponsorServer, running unmocked
  // here) resolves the configured product id on every order.paid.
  resolveLeaderboardBidProductId: () => leaderboardBidProductId.value,
  // Only the pull-based sync reaches for the client — never the webhook.
  getPolarClient: () => null
}))

vi.mock('@/lib/entitlementGrant', () => ({
  grantProEntitlement: grantProEntitlementMock,
  grantTeamEntitlement: grantTeamEntitlementMock,
  grantPlatePurchase: grantPlatePurchaseMock
}))

vi.mock('@/lib/billboardSlotServer', () => ({
  activateBillboardSlotFromOrder: slotActivateMock,
  revokeBillboardSlotFromOrder: slotRevokeMock
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'payment_events') {
        return {
          insert: paymentEventsInsertMock,
          delete: () => ({ eq: () => Promise.resolve({ error: null }) })
        }
      }
      if (table === 'users') {
        return {
          update: (values: Record<string, unknown>) => {
            usersUpdateMock(values)
            // Chainable + awaitable filter builder: records every .eq so
            // the tests can assert exactly which rows the update targets.
            const builder = {
              eq(column: string, value: unknown) {
                usersUpdateEqMock(column, value)
                return builder
              },
              then(onFulfilled: (value: { error: null }) => unknown) {
                return Promise.resolve({ error: null }).then(onFulfilled)
              }
            }
            return builder
          }
        }
      }
      if (table === 'user_cosmetics') {
        // order.refunded's plate leg — runs blind against source_order_id
        // before the sponsor revoke; inert here.
        return {
          delete: () => ({ eq: () => Promise.resolve({ error: null }) })
        }
      }
      if (table === 'leaderboard_sponsor_bids') {
        return {
          // Activation's ledger read: .select(...).eq('polar_checkout_id',
          // id).maybeSingle() -> the row a test staged in bidsReadResult.
          select: () => ({
            eq: (column: string, value: unknown) => ({
              maybeSingle: () => {
                bidsReadEqMock(column, value)
                return Promise.resolve(bidsReadResult.value)
              }
            })
          }),
          // The guarded status updates. Activation ends the chain with
          // .select('id') (rows-touched witness); revocation filters
          // with .in (PENDING/PAID guard) + .eq and awaits directly —
          // the builder serves both.
          update: (values: Record<string, unknown>) => {
            bidsUpdateMock(values)
            const builder = {
              eq(column: string, value: unknown) {
                bidsUpdateEqMock(column, value)
                return builder
              },
              in(column: string, values_: unknown[]) {
                bidsUpdateInMock(column, values_)
                return builder
              },
              select() {
                return Promise.resolve(bidsUpdateResult.value)
              },
              then(onFulfilled: (value: { error: null }) => unknown) {
                return Promise.resolve({ error: null }).then(onFulfilled)
              }
            }
            return builder
          }
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { POST } from './route'

function webhookRequest(payload: Record<string, unknown>) {
  return new NextRequest('https://cribble.dev/api/webhooks/polar', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'webhook-id': 'evt_1',
      'webhook-timestamp': '1690000000',
      'webhook-signature': 'v1,sig'
    }
  })
}

function subscriptionEvent(
  type: string,
  externalId: string | null,
  productId = 'prod_monthly',
  product?: { metadata?: Record<string, unknown> },
  metadata?: Record<string, string | number | boolean>
) {
  return {
    type,
    data: {
      id: 'sub_1',
      productId,
      customer: { externalId },
      ...(product ? { product } : {}),
      ...(metadata ? { metadata } : {})
    }
  }
}

function orderPaidEvent({
  externalId,
  metadata,
  productMetadata
}: {
  externalId: string | null
  metadata?: Record<string, string | number | boolean>
  productMetadata?: Record<string, unknown>
}) {
  return {
    type: 'order.paid',
    data: {
      id: 'order_1',
      customer: { externalId },
      metadata: metadata ?? {},
      ...(productMetadata ? { product: { metadata: productMetadata } } : {})
    }
  }
}

describe('POST /api/webhooks/polar — subscription tier take-backs', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    validateEventMock.mockReset()
    grantProEntitlementMock.mockReset()
    grantProEntitlementMock.mockResolvedValue(undefined)
    grantTeamEntitlementMock.mockReset()
    grantTeamEntitlementMock.mockResolvedValue(undefined)
    grantPlatePurchaseMock.mockReset()
    paymentEventsInsertMock.mockReset()
    paymentEventsInsertMock.mockResolvedValue({ error: null })
    usersUpdateMock.mockReset()
    usersUpdateEqMock.mockReset()
    teamProductIds.clear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it("revoked downgrades to FREE only where the tier is the Polar-managed 'PRO' (manual PREMIUM/PREMIUM+ survive)", async () => {
    const event = subscriptionEvent('subscription.revoked', '9')
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true })
    expect(usersUpdateMock).toHaveBeenCalledWith({ subscription_tier: 'FREE' })
    expect(usersUpdateEqMock.mock.calls).toEqual([
      ['id', 9],
      ['subscription_tier', 'PRO']
    ])
  })

  it('revoked without a usable externalId skips the tier write and still acks', async () => {
    const event = subscriptionEvent('subscription.revoked', null)
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(usersUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('active runs the shared Pro grant for the resolved user', async () => {
    const event = subscriptionEvent('subscription.active', '9')
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(grantProEntitlementMock).toHaveBeenCalledWith(expect.anything(), 9, {
      productId: 'prod_monthly',
      sourceId: 'sub_1'
    })
    expect(grantTeamEntitlementMock).not.toHaveBeenCalled()
    expect(usersUpdateMock).not.toHaveBeenCalled()
  })

  it('active on a configured team product runs the Team grant instead of Pro', async () => {
    teamProductIds.add('prod_team_monthly')
    const event = subscriptionEvent('subscription.active', '9', 'prod_team_monthly')
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(grantTeamEntitlementMock).toHaveBeenCalledWith(expect.anything(), 9, {
      productId: 'prod_team_monthly',
      sourceId: 'sub_1'
    })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it("revoked on a team product downgrades to FREE only where the tier is 'TEAM'", async () => {
    teamProductIds.add('prod_team_monthly')
    const event = subscriptionEvent('subscription.revoked', '9', 'prod_team_monthly')
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    // Only the tier flips — team_review_status must survive the lapse so
    // a renewal re-lights badges without a second review.
    expect(usersUpdateMock).toHaveBeenCalledWith({ subscription_tier: 'FREE' })
    expect(usersUpdateEqMock.mock.calls).toEqual([
      ['id', 9],
      ['subscription_tier', 'TEAM']
    ])
  })

  it('active on a product outside the configured ids but tagged team_key still runs the Team grant', async () => {
    // teamProductIds stays empty — the env vars are missing/stale, the
    // exact misconfiguration that once granted a real Team purchase as
    // Pro. The payload's product.metadata.team_key must catch it.
    const event = subscriptionEvent('subscription.active', '9', 'prod_team_unlisted', {
      metadata: { team_key: 'team_monthly' }
    })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(grantTeamEntitlementMock).toHaveBeenCalledWith(expect.anything(), 9, {
      productId: 'prod_team_unlisted',
      sourceId: 'sub_1'
    })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it("revoked on a team_key-tagged product outside the configured ids still guards on tier 'TEAM'", async () => {
    const event = subscriptionEvent('subscription.revoked', '9', 'prod_team_unlisted', {
      metadata: { team_key: 'team_yearly' }
    })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(usersUpdateMock).toHaveBeenCalledWith({ subscription_tier: 'FREE' })
    expect(usersUpdateEqMock.mock.calls).toEqual([
      ['id', 9],
      ['subscription_tier', 'TEAM']
    ])
  })

  it('active grants to the checkout metadata userId when it diverges from the customer external id', async () => {
    // Polar reconciles same-email buyers onto an existing customer, so the
    // subscription's customer can carry another account's external id.
    const event = subscriptionEvent('subscription.active', '19', 'prod_monthly', undefined, {
      userId: 13
    })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(grantProEntitlementMock).toHaveBeenCalledWith(expect.anything(), 13, {
      productId: 'prod_monthly',
      sourceId: 'sub_1'
    })
    expect(warnSpy).toHaveBeenCalled()
  })

  it('revoked without an external id still resolves the user from checkout metadata', async () => {
    // Seen in production: subscription.revoked arrived with customer
    // external_id null — resolving by external id alone skipped the
    // downgrade entirely.
    const event = subscriptionEvent('subscription.revoked', null, 'prod_monthly', undefined, {
      userId: 13
    })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(usersUpdateMock).toHaveBeenCalledWith({ subscription_tier: 'FREE' })
    expect(usersUpdateEqMock.mock.calls).toEqual([
      ['id', 13],
      ['subscription_tier', 'PRO']
    ])
  })
})

describe('POST /api/webhooks/polar — order.paid plate fulfillment recipient', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    validateEventMock.mockReset()
    grantProEntitlementMock.mockReset()
    grantTeamEntitlementMock.mockReset()
    grantPlatePurchaseMock.mockReset()
    grantPlatePurchaseMock.mockResolvedValue(undefined)
    paymentEventsInsertMock.mockReset()
    paymentEventsInsertMock.mockResolvedValue({ error: null })
    usersUpdateMock.mockReset()
    usersUpdateEqMock.mockReset()
    teamProductIds.clear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('grants to the checkout metadata userId when it diverges from the customer external id', async () => {
    // The exact production incident: buyer (userId 13) checked out while
    // the Polar checkout session belonged to a same-email customer whose
    // external id is 19 — the plate must go to 13.
    const event = orderPaidEvent({
      externalId: '19',
      metadata: { userId: 13, plateId: 'season-01-ignition' }
    })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(expect.anything(), 13, {
      plateId: 'season-01-ignition',
      orderId: 'order_1'
    })
    expect(warnSpy).toHaveBeenCalled()
  })

  it('falls back to the customer external id for dashboard-created orders without checkout metadata', async () => {
    const event = orderPaidEvent({
      externalId: '9',
      productMetadata: { plate_id: 'koi-pond' }
    })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(expect.anything(), 9, {
      plateId: 'koi-pond',
      orderId: 'order_1'
    })
  })

  it('acks without granting when neither metadata userId nor external id is usable', async () => {
    const event = orderPaidEvent({
      externalId: null,
      metadata: { plateId: 'koi-pond' }
    })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })
})

// The sponsor-bid leg of order.paid/order.refunded (migration 055):
// activation must verify the money trail end to end against the PENDING
// ledger row its checkout created — checkout id, configured product,
// USD denomination, charged amount, buyer — and every permanent refusal
// is ACKED (a 500 would make Polar redeliver an event no retry can
// fix). Refunds revoke by the order's CHECKOUT id across PENDING and
// PAID rows (order-id fallback for orders without one), so a refund
// that beats order.paid to delivery still strikes the ledger row and
// the late activation finds it REFUNDED. leaderboardSponsorServer runs
// unmocked; the ledger table is what's faked.

describe('POST /api/webhooks/polar — leaderboard sponsor bids', () => {
  let warnSpy: MockInstance

  /** An order.paid event for the sponsor product, defaulting to a
   *  payload that matches `pendingRow` exactly — each test breaks one
   *  link in the verification chain. createdAt is a Date (the SDK's
   *  parsed shape); activation stamps paid_at from it, not from
   *  delivery time. */
  function bidOrderEvent(overrides: Record<string, unknown> = {}) {
    return {
      type: 'order.paid',
      data: {
        id: 'order_lb_1',
        checkoutId: 'chk_lb_1',
        productId: 'prod_lb_bid',
        netAmount: 766,
        currency: 'usd',
        createdAt: new Date('2026-08-25T10:00:00.000Z'),
        customer: { externalId: '9' },
        metadata: { userId: 9, kind: 'leaderboard_bid', lbAdId: 4 },
        ...overrides
      }
    }
  }

  const pendingRow = () => ({
    id: 55,
    ad_id: 4,
    user_id: 9,
    status: 'PENDING',
    amount_cents: 766,
    polar_order_id: null
  })

  beforeEach(() => {
    validateEventMock.mockReset()
    grantProEntitlementMock.mockReset()
    grantTeamEntitlementMock.mockReset()
    grantPlatePurchaseMock.mockReset()
    grantPlatePurchaseMock.mockResolvedValue(undefined)
    paymentEventsInsertMock.mockReset()
    paymentEventsInsertMock.mockResolvedValue({ error: null })
    usersUpdateMock.mockReset()
    usersUpdateEqMock.mockReset()
    bidsReadEqMock.mockReset()
    bidsUpdateMock.mockReset()
    bidsUpdateEqMock.mockReset()
    bidsUpdateInMock.mockReset()
    bidsReadResult.value = { data: pendingRow(), error: null }
    bidsUpdateResult.value = { data: [{ id: 55 }], error: null }
    teamProductIds.clear()
    leaderboardBidProductId.value = 'prod_lb_bid'
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    leaderboardBidProductId.value = null
  })

  it('order.paid activates the PENDING row when checkout id, product, amount and buyer all match', async () => {
    const event = bidOrderEvent()
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true })
    // The ledger row is found through the ORDER's checkout id.
    expect(bidsReadEqMock).toHaveBeenCalledWith('polar_checkout_id', 'chk_lb_1')
    // paid_at is the order's creation moment, not webhook arrival — the
    // 24h clock must not stretch with delivery lag.
    expect(bidsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PAID',
        polar_order_id: 'order_lb_1',
        paid_at: '2026-08-25T10:00:00.000Z'
      })
    )
    // Guarded to THIS row while still PENDING — the idempotency edge.
    expect(bidsUpdateEqMock.mock.calls).toEqual([
      ['id', 55],
      ['status', 'PENDING']
    ])
    // No plate markers on a bid order — the other one-time fulfillment
    // must not fire.
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('refuses (and still acks) when the charged amount does not match the ledger row', async () => {
    const event = bidOrderEvent({ netAmount: 999 })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(bidsUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('refuses an order not denominated in USD even when the minor units match numerically', async () => {
    // The ledger's amount_cents are US cents; 766 of a cheaper currency
    // must never activate a 766-US-cent contribution.
    const event = bidOrderEvent({ currency: 'jpy' })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(bidsUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('refuses when the order is not on the configured sponsor product, whatever its metadata claims', async () => {
    // kind='leaderboard_bid' classifies it as a bid, but verification
    // still demands the configured product id before money activates.
    const event = bidOrderEvent({ productId: 'prod_something_else' })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(bidsUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('refuses when the payer does not match the ledger row buyer', async () => {
    const event = bidOrderEvent({ metadata: { userId: 13, kind: 'leaderboard_bid', lbAdId: 4 } })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(bidsUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('refuses a paid checkout this server never created (no ledger row)', async () => {
    bidsReadResult.value = { data: null, error: null }
    const event = bidOrderEvent()
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(bidsReadEqMock).toHaveBeenCalledWith('polar_checkout_id', 'chk_lb_1')
    expect(bidsUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('refuses a bid order that carries no checkout id at all', async () => {
    const event = bidOrderEvent({ checkoutId: null })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(bidsReadEqMock).not.toHaveBeenCalled()
    expect(bidsUpdateMock).not.toHaveBeenCalled()
  })

  it('a duplicate delivery is dropped by the payment_events gate before the ledger is even read', async () => {
    paymentEventsInsertMock.mockResolvedValue({ error: { code: '23505' } })
    const event = bidOrderEvent()
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true, skipped: true })
    expect(bidsReadEqMock).not.toHaveBeenCalled()
    expect(bidsUpdateMock).not.toHaveBeenCalled()
  })

  it('an already-PAID row acks without a second activation (sync raced the webhook)', async () => {
    bidsReadResult.value = { data: { ...pendingRow(), status: 'PAID' }, error: null }
    const event = bidOrderEvent()
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true })
    expect(bidsUpdateMock).not.toHaveBeenCalled()
  })

  it('refuses to resurrect an already-REFUNDED row', async () => {
    bidsReadResult.value = { data: { ...pendingRow(), status: 'REFUNDED' }, error: null }
    const event = bidOrderEvent()
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(bidsUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('a plate order never touches the bid ledger (the two one-time products cannot collide)', async () => {
    const event = orderPaidEvent({
      externalId: '9',
      metadata: { userId: 9, plateId: 'koi-pond' }
    })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(grantPlatePurchaseMock).toHaveBeenCalled()
    expect(bidsReadEqMock).not.toHaveBeenCalled()
    expect(bidsUpdateMock).not.toHaveBeenCalled()
  })

  it('order.refunded revokes by the CHECKOUT id across PENDING and PAID rows — a refund beating order.paid still lands', async () => {
    // The refund-before-activation race: polar_order_id is only stamped
    // at activation, so a refund keyed to it alone would miss the still-
    // PENDING row and the retried order.paid would seat refunded money
    // on the board. The checkout id exists from row creation and the
    // PENDING/PAID guard lets the refund strike first.
    const event = {
      type: 'order.refunded',
      data: { id: 'order_lb_1', checkoutId: 'chk_lb_1' }
    }
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(bidsUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'REFUNDED' }))
    expect(bidsUpdateInMock.mock.calls).toEqual([['status', ['PENDING', 'PAID']]])
    expect(bidsUpdateEqMock.mock.calls).toEqual([['polar_checkout_id', 'chk_lb_1']])
  })

  it('order.refunded without a checkout id falls back to the stamped order id, same PENDING/PAID guard', async () => {
    const event = { type: 'order.refunded', data: { id: 'order_lb_1' } }
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(bidsUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'REFUNDED' }))
    expect(bidsUpdateInMock.mock.calls).toEqual([['status', ['PENDING', 'PAID']]])
    expect(bidsUpdateEqMock.mock.calls).toEqual([['polar_order_id', 'order_lb_1']])
  })
})

// The billboard-slot leg of order.paid/order.refunded (migration 061):
// the verification gate and window stamping live in
// billboardSlotServer (tested statefully in its own suite), so what's
// pinned here is the WIRING — every paid order runs through slot
// activation (it self-classifies and no-ops on the other products'
// orders), every refund runs the slot revocation, and a permanent
// verification refusal RESOLVES so the delivery is acked instead of
// redelivered forever.

describe('POST /api/webhooks/polar — billboard slot orders', () => {
  function slotOrderEvent(overrides: Record<string, unknown> = {}) {
    return {
      type: 'order.paid',
      data: {
        id: 'order_bb_1',
        checkoutId: 'chk_bb_1',
        productId: 'prod_bb_slot',
        netAmount: 20900,
        currency: 'usd',
        createdAt: new Date('2026-08-25T10:00:00.000Z'),
        customer: { externalId: '9' },
        metadata: { userId: 9, kind: 'billboard_slot', bbAdId: 4 },
        ...overrides
      }
    }
  }

  beforeEach(() => {
    validateEventMock.mockReset()
    grantProEntitlementMock.mockReset()
    grantTeamEntitlementMock.mockReset()
    grantPlatePurchaseMock.mockReset()
    grantPlatePurchaseMock.mockResolvedValue(undefined)
    paymentEventsInsertMock.mockReset()
    paymentEventsInsertMock.mockResolvedValue({ error: null })
    bidsReadEqMock.mockReset()
    bidsUpdateMock.mockReset()
    bidsUpdateEqMock.mockReset()
    bidsUpdateInMock.mockReset()
    slotActivateMock.mockReset()
    slotActivateMock.mockResolvedValue('activated')
    slotRevokeMock.mockReset()
    slotRevokeMock.mockResolvedValue(undefined)
    teamProductIds.clear()
  })

  it('order.paid hands the verified order to slot activation, untouched by the other fulfillments', async () => {
    const event = slotOrderEvent()
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true })
    expect(slotActivateMock).toHaveBeenCalledWith(expect.anything(), event.data)
    // No plate markers and no bid markers on a slot order — the other
    // one-time fulfillments must not fire.
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
    expect(bidsReadEqMock).not.toHaveBeenCalled()
  })

  it('a permanent slot refusal still acks — Polar must not redeliver an event no retry can fix', async () => {
    slotActivateMock.mockResolvedValue('refused')
    const event = slotOrderEvent({ netAmount: 20000 })
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true })
  })

  it('a retryable slot failure 500s and releases the idempotency marker for redelivery', async () => {
    slotActivateMock.mockRejectedValue(new Error('ledger read failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = slotOrderEvent()
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(500)
    errorSpy.mockRestore()
  })

  it('order.refunded runs the slot revocation alongside the plate and bid legs', async () => {
    const event = {
      type: 'order.refunded',
      data: { id: 'order_bb_1', checkoutId: 'chk_bb_1' }
    }
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    expect(slotRevokeMock).toHaveBeenCalledWith(expect.anything(), event.data)
  })

  it('a duplicate delivery is dropped by the payment_events gate before slot activation runs', async () => {
    paymentEventsInsertMock.mockResolvedValue({ error: { code: '23505' } })
    const event = slotOrderEvent()
    validateEventMock.mockReturnValue(event)

    const response = await POST(webhookRequest(event))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true, skipped: true })
    expect(slotActivateMock).not.toHaveBeenCalled()
  })
})
