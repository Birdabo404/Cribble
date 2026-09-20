import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// The webhook's fulfillment contract against Dodo's "latest snapshot"
// delivery model: subscription events branch on data.status (active
// grants, cancelled/expired/on_hold revoke, everything else is audit
// only) and on the product (configured team ids get the Team grant,
// everything else Pro). Revokes downgrade ONLY the tier value this
// integration writes for that product ('TEAM' or 'PRO'), so a manually
// granted PREMIUM/PREMIUM+ survives a lapsed Dodo sub — the admin
// panel's revoke_pro is the explicit path for those. payment.succeeded
// grants plates from checkout metadata (or the reverse product map) and
// links the Dodo customer to the buyer. Signature verification is
// mocked; the DB writes are what's under test.

const {
  verifyMock,
  grantProEntitlementMock,
  grantTeamEntitlementMock,
  grantPlatePurchaseMock,
  linkDodoCustomerMock,
  findUserIdByDodoCustomerMock,
  paymentEventsInsertMock,
  usersUpdateMock,
  usersUpdateEqMock,
  cosmeticsDeleteEqMock,
  teamProductIds,
  plateProducts
} = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  grantProEntitlementMock: vi.fn(),
  grantTeamEntitlementMock: vi.fn(),
  grantPlatePurchaseMock: vi.fn(),
  linkDodoCustomerMock: vi.fn(),
  findUserIdByDodoCustomerMock: vi.fn(),
  paymentEventsInsertMock: vi.fn(),
  usersUpdateMock: vi.fn(),
  usersUpdateEqMock: vi.fn(),
  cosmeticsDeleteEqMock: vi.fn(),
  teamProductIds: new Set<string>(),
  plateProducts: new Map<string, string>()
}))

vi.mock('standardwebhooks', () => ({
  Webhook: class Webhook {
    verify = verifyMock
  },
  WebhookVerificationError: class WebhookVerificationError extends Error {}
}))

// The pure metadata readers stay real; only env-backed lookups are faked.
vi.mock('@/lib/dodo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dodo')>()),
  getDodoWebhookSecret: () => 'whsec_test',
  getTeamProductIds: () => teamProductIds,
  isTeamSubscription: (subscription: { product_id: string }) =>
    teamProductIds.has(subscription.product_id),
  resolvePlateIdForProduct: (productId: string) => plateProducts.get(productId) ?? null,
  // Only the pull-based sync reaches for the client — never the webhook.
  getDodoClient: () => null
}))

vi.mock('@/lib/dodoCustomer', () => ({
  linkDodoCustomer: linkDodoCustomerMock,
  findUserIdByDodoCustomer: findUserIdByDodoCustomerMock
}))

vi.mock('@/lib/entitlementGrant', () => ({
  grantProEntitlement: grantProEntitlementMock,
  grantTeamEntitlement: grantTeamEntitlementMock,
  grantPlatePurchase: grantPlatePurchaseMock
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
        return {
          delete: () => ({
            eq: (column: string, value: unknown) => {
              cosmeticsDeleteEqMock(column, value)
              return Promise.resolve({ error: null })
            }
          })
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { POST } from './route'

function webhookRequest(payload: unknown, eventId = 'evt_1') {
  return new NextRequest('https://cribble.dev/api/webhooks/dodo', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    headers: {
      'webhook-id': eventId,
      'webhook-timestamp': '1690000000',
      'webhook-signature': 'v1,sig'
    }
  })
}

function subscriptionEvent({
  type = 'subscription.active',
  status = 'active',
  productId = 'pdt_monthly',
  customerId = 'cus_1',
  metadata
}: {
  type?: string
  status?: string
  productId?: string
  customerId?: string | null
  metadata?: Record<string, string | number | boolean>
} = {}) {
  return {
    business_id: 'biz_1',
    timestamp: '2026-09-20T00:00:00Z',
    type,
    data: {
      payload_type: 'Subscription',
      subscription_id: 'sub_1',
      product_id: productId,
      status,
      customer: customerId ? { customer_id: customerId, email: 'a@b.c', name: 'A' } : null,
      metadata: metadata ?? {}
    }
  }
}

function paymentEvent({
  status = 'succeeded',
  customerId = 'cus_1',
  metadata,
  productCart,
  subscriptionId
}: {
  status?: string
  customerId?: string | null
  metadata?: Record<string, string | number | boolean>
  productCart?: Array<{ product_id: string; quantity: number }>
  subscriptionId?: string
} = {}) {
  return {
    business_id: 'biz_1',
    timestamp: '2026-09-20T00:00:00Z',
    type: 'payment.succeeded',
    data: {
      payload_type: 'Payment',
      payment_id: 'pay_1',
      status,
      customer: customerId ? { customer_id: customerId, email: 'a@b.c', name: 'A' } : null,
      metadata: metadata ?? {},
      ...(productCart ? { product_cart: productCart } : {}),
      ...(subscriptionId ? { subscription_id: subscriptionId } : {})
    }
  }
}

function resetAll() {
  verifyMock.mockReset()
  verifyMock.mockReturnValue(undefined)
  grantProEntitlementMock.mockReset()
  grantProEntitlementMock.mockResolvedValue(undefined)
  grantTeamEntitlementMock.mockReset()
  grantTeamEntitlementMock.mockResolvedValue(undefined)
  grantPlatePurchaseMock.mockReset()
  grantPlatePurchaseMock.mockResolvedValue(undefined)
  linkDodoCustomerMock.mockReset()
  linkDodoCustomerMock.mockResolvedValue(undefined)
  findUserIdByDodoCustomerMock.mockReset()
  findUserIdByDodoCustomerMock.mockResolvedValue(null)
  paymentEventsInsertMock.mockReset()
  paymentEventsInsertMock.mockResolvedValue({ error: null })
  usersUpdateMock.mockReset()
  usersUpdateEqMock.mockReset()
  cosmeticsDeleteEqMock.mockReset()
  teamProductIds.clear()
  plateProducts.clear()
}

describe('POST /api/webhooks/dodo — envelope handling', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    resetAll()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('rejects a bad signature before touching the database', async () => {
    const { WebhookVerificationError } = await import('standardwebhooks')
    verifyMock.mockImplementation(() => {
      throw new WebhookVerificationError('nope')
    })

    const response = await POST(webhookRequest(subscriptionEvent()))

    expect(response.status).toBe(403)
    expect(paymentEventsInsertMock).not.toHaveBeenCalled()
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('acks a duplicate delivery without side effects', async () => {
    paymentEventsInsertMock.mockResolvedValue({ error: { code: '23505' } })

    const response = await POST(webhookRequest(subscriptionEvent()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true, skipped: true })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('asks Dodo to retry a subscribed event whose shape it cannot read, without burning the idempotency row', async () => {
    const response = await POST(
      webhookRequest({ type: 'payment.succeeded', data: { nonsense: true } })
    )

    expect(response.status).toBe(500)
    expect(paymentEventsInsertMock).not.toHaveBeenCalled()
  })

  it('records and acks events outside the subscribed set (audit only)', async () => {
    const response = await POST(
      webhookRequest({ type: 'dispute.opened', data: { dispute_id: 'dsp_1' } })
    )

    expect(response.status).toBe(200)
    expect(paymentEventsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: 'evt_1', event_type: 'dispute.opened' })
    )
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
    expect(usersUpdateMock).not.toHaveBeenCalled()
  })

  it('releases the idempotency row and 500s when processing throws', async () => {
    grantProEntitlementMock.mockRejectedValue(new Error('db exploded'))

    const response = await POST(
      webhookRequest(subscriptionEvent({ metadata: { userId: 9 } }))
    )

    expect(response.status).toBe(500)
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/dodo — subscription tier grants and take-backs', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    resetAll()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('active runs the shared Pro grant for the metadata userId and links the Dodo customer', async () => {
    const response = await POST(
      webhookRequest(subscriptionEvent({ metadata: { userId: 9 } }))
    )

    expect(response.status).toBe(200)
    expect(grantProEntitlementMock).toHaveBeenCalledWith(expect.anything(), 9, {
      productId: 'pdt_monthly',
      sourceId: 'sub_1'
    })
    expect(linkDodoCustomerMock).toHaveBeenCalledWith(expect.anything(), 9, 'cus_1')
    expect(grantTeamEntitlementMock).not.toHaveBeenCalled()
    expect(usersUpdateMock).not.toHaveBeenCalled()
  })

  it('active on a configured team product runs the Team grant instead of Pro', async () => {
    teamProductIds.add('pdt_team_monthly')

    const response = await POST(
      webhookRequest(
        subscriptionEvent({ productId: 'pdt_team_monthly', metadata: { userId: 9 } })
      )
    )

    expect(response.status).toBe(200)
    expect(grantTeamEntitlementMock).toHaveBeenCalledWith(expect.anything(), 9, {
      productId: 'pdt_team_monthly',
      sourceId: 'sub_1'
    })
    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('grants on subscription.renewed and subscription.updated too — status is the truth, not the label', async () => {
    for (const type of ['subscription.renewed', 'subscription.updated']) {
      grantProEntitlementMock.mockClear()
      const response = await POST(
        webhookRequest(subscriptionEvent({ type, metadata: { userId: 9 } }), `evt_${type}`)
      )
      expect(response.status).toBe(200)
      expect(grantProEntitlementMock).toHaveBeenCalledTimes(1)
    }
  })

  it('resolves the recipient through the linked customer when checkout metadata is absent (dashboard-created sub)', async () => {
    findUserIdByDodoCustomerMock.mockResolvedValue(9)

    const response = await POST(webhookRequest(subscriptionEvent()))

    expect(response.status).toBe(200)
    expect(findUserIdByDodoCustomerMock).toHaveBeenCalledWith(expect.anything(), 'cus_1')
    expect(grantProEntitlementMock).toHaveBeenCalledWith(expect.anything(), 9, {
      productId: 'pdt_monthly',
      sourceId: 'sub_1'
    })
    // Resolved FROM the link — nothing new to remember.
    expect(linkDodoCustomerMock).not.toHaveBeenCalled()
  })

  it('trusts checkout metadata userId over a customer record linked to another account', async () => {
    // Dodo attaches same-email buyers onto an existing customer, so the
    // subscription's customer can be another Cribble account's.
    findUserIdByDodoCustomerMock.mockResolvedValue(19)

    const response = await POST(
      webhookRequest(subscriptionEvent({ metadata: { userId: '13' } }))
    )

    expect(response.status).toBe(200)
    expect(grantProEntitlementMock).toHaveBeenCalledWith(expect.anything(), 13, {
      productId: 'pdt_monthly',
      sourceId: 'sub_1'
    })
    expect(findUserIdByDodoCustomerMock).not.toHaveBeenCalled()
  })

  it.each(['cancelled', 'expired', 'on_hold'])(
    "status %s downgrades to FREE only where the tier is the Dodo-managed 'PRO' (manual PREMIUM/PREMIUM+ survive)",
    async (status) => {
      const response = await POST(
        webhookRequest(
          subscriptionEvent({ type: `subscription.${status}`, status, metadata: { userId: 9 } })
        )
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ received: true })
      expect(usersUpdateMock).toHaveBeenCalledWith({ subscription_tier: 'FREE' })
      expect(usersUpdateEqMock.mock.calls).toEqual([
        ['id', 9],
        ['subscription_tier', 'PRO']
      ])
      expect(grantProEntitlementMock).not.toHaveBeenCalled()
    }
  )

  it("cancelled on a team product downgrades to FREE only where the tier is 'TEAM'", async () => {
    teamProductIds.add('pdt_team_monthly')

    const response = await POST(
      webhookRequest(
        subscriptionEvent({
          type: 'subscription.cancelled',
          status: 'cancelled',
          productId: 'pdt_team_monthly',
          metadata: { userId: 9 }
        })
      )
    )

    expect(response.status).toBe(200)
    // Only the tier flips — team_review_status must survive the lapse so
    // a renewal re-lights badges without a second review.
    expect(usersUpdateMock).toHaveBeenCalledWith({ subscription_tier: 'FREE' })
    expect(usersUpdateEqMock.mock.calls).toEqual([
      ['id', 9],
      ['subscription_tier', 'TEAM']
    ])
  })

  it('a cancelled event whose snapshot is still active (scheduled cancel) does not revoke', async () => {
    const response = await POST(
      webhookRequest(
        subscriptionEvent({ type: 'subscription.cancelled', status: 'active', metadata: { userId: 9 } })
      )
    )

    expect(response.status).toBe(200)
    expect(usersUpdateMock).not.toHaveBeenCalled()
    // Still an active sub — the idempotent grant runs and no-ops in the DB.
    expect(grantProEntitlementMock).toHaveBeenCalledTimes(1)
  })

  it.each(['past_due', 'pending', 'paused', 'failed'])(
    'status %s is audit-only: neither grants nor revokes',
    async (status) => {
      const response = await POST(
        webhookRequest(
          subscriptionEvent({ type: 'subscription.updated', status, metadata: { userId: 9 } })
        )
      )

      expect(response.status).toBe(200)
      expect(usersUpdateMock).not.toHaveBeenCalled()
      expect(grantProEntitlementMock).not.toHaveBeenCalled()
      expect(grantTeamEntitlementMock).not.toHaveBeenCalled()
    }
  )

  it('revoke leaves a house complimentary Pro account (user 8) on its tier', async () => {
    const response = await POST(
      webhookRequest(
        subscriptionEvent({ type: 'subscription.expired', status: 'expired', metadata: { userId: 8 } })
      )
    )

    expect(response.status).toBe(200)
    expect(usersUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('revoke leaves a house complimentary Team account (user 19) on its tier', async () => {
    teamProductIds.add('pdt_team_monthly')

    const response = await POST(
      webhookRequest(
        subscriptionEvent({
          type: 'subscription.cancelled',
          status: 'cancelled',
          productId: 'pdt_team_monthly',
          metadata: { userId: 19 }
        })
      )
    )

    expect(response.status).toBe(200)
    expect(usersUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('revoke without any usable recipient skips the tier write and still acks', async () => {
    const response = await POST(
      webhookRequest(
        subscriptionEvent({ type: 'subscription.cancelled', status: 'cancelled', customerId: null })
      )
    )

    expect(response.status).toBe(200)
    expect(usersUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/dodo — payment.succeeded plate fulfillment', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    resetAll()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('grants the plate from checkout metadata to the metadata userId, keyed by payment id', async () => {
    const response = await POST(
      webhookRequest(paymentEvent({ metadata: { userId: 13, plateId: 'season-01-ignition' } }))
    )

    expect(response.status).toBe(200)
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(expect.anything(), 13, {
      plateId: 'season-01-ignition',
      orderId: 'pay_1'
    })
    expect(linkDodoCustomerMock).toHaveBeenCalledWith(expect.anything(), 13, 'cus_1')
  })

  it('falls back to the reverse product map when a payment carries no checkout metadata', async () => {
    plateProducts.set('pdt_koi', 'koi-pond')
    findUserIdByDodoCustomerMock.mockResolvedValue(9)

    const response = await POST(
      webhookRequest(paymentEvent({ productCart: [{ product_id: 'pdt_koi', quantity: 1 }] }))
    )

    expect(response.status).toBe(200)
    expect(grantPlatePurchaseMock).toHaveBeenCalledWith(expect.anything(), 9, {
      plateId: 'koi-pond',
      orderId: 'pay_1'
    })
  })

  it('treats a subscription-cycle payment as a no-op for plates but still links the customer', async () => {
    plateProducts.set('pdt_monthly', 'should-not-matter')

    const response = await POST(
      webhookRequest(
        paymentEvent({
          subscriptionId: 'sub_1',
          metadata: { userId: 9 },
          productCart: [{ product_id: 'pdt_monthly', quantity: 1 }]
        })
      )
    )

    expect(response.status).toBe(200)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
    expect(linkDodoCustomerMock).toHaveBeenCalledWith(expect.anything(), 9, 'cus_1')
  })

  it('does not grant when the payment snapshot is no longer succeeded', async () => {
    const response = await POST(
      webhookRequest(
        paymentEvent({ status: 'failed', metadata: { userId: 9, plateId: 'koi-pond' } })
      )
    )

    expect(response.status).toBe(200)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
  })

  it('acks without granting when neither metadata userId nor a linked customer is usable', async () => {
    const response = await POST(
      webhookRequest(paymentEvent({ customerId: null, metadata: { plateId: 'koi-pond' } }))
    )

    expect(response.status).toBe(200)
    expect(grantPlatePurchaseMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/dodo — refund.succeeded', () => {
  beforeEach(resetAll)

  it('revokes purchased cosmetics by the refunded payment id', async () => {
    const response = await POST(
      webhookRequest({
        type: 'refund.succeeded',
        data: { refund_id: 'ref_1', payment_id: 'pay_1', status: 'succeeded', is_partial: false }
      })
    )

    expect(response.status).toBe(200)
    expect(cosmeticsDeleteEqMock).toHaveBeenCalledWith('source_order_id', 'pay_1')
  })

  it('leaves cosmetics alone when the refund snapshot is not succeeded', async () => {
    const response = await POST(
      webhookRequest({
        type: 'refund.succeeded',
        data: { refund_id: 'ref_1', payment_id: 'pay_1', status: 'failed' }
      })
    )

    expect(response.status).toBe(200)
    expect(cosmeticsDeleteEqMock).not.toHaveBeenCalled()
  })
})
