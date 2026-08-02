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
  teamProductIds
} = vi.hoisted(() => ({
  validateEventMock: vi.fn(),
  grantProEntitlementMock: vi.fn(),
  grantTeamEntitlementMock: vi.fn(),
  grantPlatePurchaseMock: vi.fn(),
  paymentEventsInsertMock: vi.fn(),
  usersUpdateMock: vi.fn(),
  usersUpdateEqMock: vi.fn(),
  teamProductIds: new Set<string>()
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
  }
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
  product?: { metadata?: Record<string, unknown> }
) {
  return {
    type,
    data: {
      id: 'sub_1',
      productId,
      customer: { externalId },
      ...(product ? { product } : {})
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
})
