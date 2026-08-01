import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// The webhook's subscription take-back contract: subscription.revoked
// downgrades ONLY the tier value this integration writes ('PRO'), so a
// manually granted PREMIUM/PREMIUM+ survives a lapsed Polar sub — the
// admin panel's revoke_pro is the explicit path for those. Signature
// verification and event parsing are mocked; the DB writes are what's
// under test.

const {
  validateEventMock,
  grantProEntitlementMock,
  grantPlatePurchaseMock,
  paymentEventsInsertMock,
  usersUpdateMock,
  usersUpdateEqMock
} = vi.hoisted(() => ({
  validateEventMock: vi.fn(),
  grantProEntitlementMock: vi.fn(),
  grantPlatePurchaseMock: vi.fn(),
  paymentEventsInsertMock: vi.fn(),
  usersUpdateMock: vi.fn(),
  usersUpdateEqMock: vi.fn()
}))

vi.mock('@polar-sh/sdk/webhooks', () => ({
  validateEvent: validateEventMock,
  WebhookVerificationError: class WebhookVerificationError extends Error {}
}))

vi.mock('@/lib/polar', () => ({ getPolarWebhookSecret: () => 'whsec_test' }))

vi.mock('@/lib/entitlementGrant', () => ({
  grantProEntitlement: grantProEntitlementMock,
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

function subscriptionEvent(type: string, externalId: string | null) {
  return {
    type,
    data: {
      id: 'sub_1',
      productId: 'prod_monthly',
      customer: { externalId }
    }
  }
}

describe('POST /api/webhooks/polar — subscription tier take-backs', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    validateEventMock.mockReset()
    grantProEntitlementMock.mockReset()
    grantProEntitlementMock.mockResolvedValue(undefined)
    grantPlatePurchaseMock.mockReset()
    paymentEventsInsertMock.mockReset()
    paymentEventsInsertMock.mockResolvedValue({ error: null })
    usersUpdateMock.mockReset()
    usersUpdateEqMock.mockReset()
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
    expect(usersUpdateMock).not.toHaveBeenCalled()
  })
})
