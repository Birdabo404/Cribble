import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The checkout route's ownership gate: the shop already hides buy buttons
// on owned plates, but a stale tab / double-click / hand-typed URL must
// not charge for a plate the buyer already has. Owned plates bounce back
// to the shop uncharged; everything else proceeds to Dodo's hosted
// checkout — as the linked Dodo customer when the account has one.

const {
  getSessionUserIdMock,
  getOwnedPlateIdsMock,
  getDodoClientMock,
  checkoutSessionsCreateMock,
  readDodoCustomerIdMock,
  discountCode
} = vi.hoisted(() => ({
  getSessionUserIdMock: vi.fn(),
  getOwnedPlateIdsMock: vi.fn(),
  getDodoClientMock: vi.fn(),
  checkoutSessionsCreateMock: vi.fn(),
  readDodoCustomerIdMock: vi.fn(),
  discountCode: { value: null as string | null }
}))

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: getSessionUserIdMock }))

// The route builds its service client at module scope; the tier read for
// the discount goes through `from('users')`, everything else is mocked.
vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { subscription_tier: 'PRO' }, error: null })
        })
      })
    })
  })
}))

// Catalog (getPlate) stays real so sellability rules are exercised exactly
// as in production; only the DB ownership read is faked.
vi.mock('@/lib/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/entitlements')>()),
  getOwnedPlateIds: getOwnedPlateIdsMock
}))

vi.mock('@/lib/dodoCustomer', () => ({
  readDodoCustomerId: readDodoCustomerIdMock
}))

vi.mock('@/lib/dodo', () => ({
  getDodoClient: getDodoClientMock,
  isDodoConfigured: () => true,
  getProPlateDiscountCode: () => discountCode.value,
  resolvePlateProductId: (id: string) => (id === 'deep-space' ? 'pdt_plate_deep_space' : null),
  resolveProProductId: (key: string) => (key === 'pro_monthly' ? 'pdt_monthly' : null),
  resolveTeamProductId: (key: string) => (key === 'team_monthly' ? 'pdt_team_monthly' : null)
}))

import { GET } from './route'

/** Browser navigation to /api/checkout for a plate. The explicit host
 *  header pins resolveAppUrl (dev/test branch follows Host) so redirect
 *  assertions are deterministic. */
function plateCheckoutRequest(plateId: string) {
  return new NextRequest(
    `https://cribble.dev/api/checkout?type=plate&plateId=${plateId}`,
    { headers: { host: 'cribble.dev' } }
  )
}

function subscriptionCheckoutRequest(type: string) {
  return new NextRequest(`https://cribble.dev/api/checkout?type=${type}`, {
    headers: { host: 'cribble.dev' }
  })
}

describe('GET /api/checkout', () => {
  beforeEach(() => {
    getSessionUserIdMock.mockReset()
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 9 })
    getOwnedPlateIdsMock.mockReset()
    getOwnedPlateIdsMock.mockResolvedValue([])
    readDodoCustomerIdMock.mockReset()
    readDodoCustomerIdMock.mockResolvedValue(null)
    checkoutSessionsCreateMock.mockReset()
    checkoutSessionsCreateMock.mockResolvedValue({
      session_id: 'cks_1',
      checkout_url: 'https://checkout.dodopayments.com/session/cks_1'
    })
    getDodoClientMock.mockReset()
    getDodoClientMock.mockReturnValue({
      checkoutSessions: { create: checkoutSessionsCreateMock }
    })
    discountCode.value = null
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses an already-owned plate: bounces to the shop, never reaches Dodo', async () => {
    getOwnedPlateIdsMock.mockResolvedValue(['deep-space'])

    const response = await GET(plateCheckoutRequest('deep-space'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://cribble.dev/shop?checkout=owned')
    expect(checkoutSessionsCreateMock).not.toHaveBeenCalled()
  })

  it('sends a not-yet-owned plate to the Dodo hosted checkout with the buyer stamped in metadata', async () => {
    getOwnedPlateIdsMock.mockResolvedValue(['koi-pond'])

    const response = await GET(plateCheckoutRequest('deep-space'))

    expect(getOwnedPlateIdsMock).toHaveBeenCalledWith(expect.anything(), 9)
    expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        product_cart: [{ product_id: 'pdt_plate_deep_space', quantity: 1 }],
        metadata: { userId: 9, plateId: 'deep-space' },
        return_url: 'http://cribble.dev/shop?checkout=success',
        // Plate checkouts hide the code field so the Pro perk stays a perk.
        feature_flags: { allow_discount_code: false }
      })
    )
    // No linked customer yet — Dodo collects the email on the hosted page.
    expect(checkoutSessionsCreateMock.mock.calls[0][0]).not.toHaveProperty('customer')
    expect(checkoutSessionsCreateMock.mock.calls[0][0]).not.toHaveProperty('discount_codes')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://checkout.dodopayments.com/session/cks_1'
    )
  })

  it('checks out as the linked Dodo customer when the account has one', async () => {
    readDodoCustomerIdMock.mockResolvedValue('cus_linked')

    await GET(plateCheckoutRequest('deep-space'))

    expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: { customer_id: 'cus_linked' } })
    )
  })

  it('attaches the Pro plate discount code for a Pro buyer', async () => {
    discountCode.value = 'PROPLATES'

    await GET(plateCheckoutRequest('deep-space'))

    expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ discount_codes: ['PROPLATES'] })
    )
  })

  it('keeps refusing unsellable plates before the ownership read (catalog is the authority)', async () => {
    const response = await GET(plateCheckoutRequest('pro-circuit'))

    expect(response.status).toBe(404)
    expect(getOwnedPlateIdsMock).not.toHaveBeenCalled()
    expect(checkoutSessionsCreateMock).not.toHaveBeenCalled()
  })

  // Where Dodo sends the buyer afterwards: team checkouts land on the
  // /team console (which runs the sync ack and shows the review gate),
  // everything else returns to the shop. Dodo appends payment_id /
  // subscription_id / status itself, so the URL carries only our flag.
  it('points team checkouts back at the /team console', async () => {
    const response = await GET(subscriptionCheckoutRequest('team_monthly'))

    expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        product_cart: [{ product_id: 'pdt_team_monthly', quantity: 1 }],
        return_url: 'http://cribble.dev/team?checkout=success'
      })
    )
    // Subscriptions keep the code field: the perk discount is restricted
    // to plate products anyway, and future promos may want it.
    expect(checkoutSessionsCreateMock.mock.calls[0][0]).not.toHaveProperty('feature_flags')
    expect(response.status).toBe(307)
  })

  it('refuses Pro checkout for a house complimentary account — Dodo never sees it', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 8 })

    const response = await GET(subscriptionCheckoutRequest('pro_monthly'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://cribble.dev/shop?checkout=complimentary'
    )
    expect(checkoutSessionsCreateMock).not.toHaveBeenCalled()
  })

  it('refuses Team checkout for a house complimentary account', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 19 })

    const response = await GET(subscriptionCheckoutRequest('team_monthly'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://cribble.dev/shop?checkout=complimentary'
    )
    expect(checkoutSessionsCreateMock).not.toHaveBeenCalled()
  })

  it('keeps sending Pro checkouts back to the shop', async () => {
    await GET(subscriptionCheckoutRequest('pro_monthly'))

    expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        product_cart: [{ product_id: 'pdt_monthly', quantity: 1 }],
        return_url: 'http://cribble.dev/shop?checkout=success'
      })
    )
  })

  it('bounces to the shop error notice when Dodo returns a session without a URL', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    checkoutSessionsCreateMock.mockResolvedValue({ session_id: 'cks_2', checkout_url: null })

    const response = await GET(subscriptionCheckoutRequest('pro_monthly'))
    errorSpy.mockRestore()

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://cribble.dev/shop?checkout=error')
  })
})
