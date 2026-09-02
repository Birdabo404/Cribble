import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The checkout route's ownership gate: the shop already hides buy buttons
// on owned plates, but a stale tab / double-click / hand-typed URL must
// not charge for a plate the buyer already has. Owned plates bounce back
// to the shop uncharged; everything else proceeds to Polar's hosted
// checkout.

const {
  getSessionUserIdMock,
  getOwnedPlateIdsMock,
  getPolarClientMock,
  checkoutsCreateMock
} = vi.hoisted(() => ({
  getSessionUserIdMock: vi.fn(),
  getOwnedPlateIdsMock: vi.fn(),
  getPolarClientMock: vi.fn(),
  checkoutsCreateMock: vi.fn()
}))

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: getSessionUserIdMock }))

// The route builds its service client at module scope; ownership reads go
// through the mocked getOwnedPlateIds, so the client itself can be inert.
vi.mock('@/lib/supabaseServer', () => ({ createServiceClient: () => ({}) }))

// Catalog (getPlate) stays real so sellability rules are exercised exactly
// as in production; only the DB ownership read is faked.
vi.mock('@/lib/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/entitlements')>()),
  getOwnedPlateIds: getOwnedPlateIdsMock
}))

vi.mock('@/lib/polar', () => ({
  getPolarClient: getPolarClientMock,
  isPolarConfigured: () => true,
  resolvePlateProductId: (id: string) => (id === 'deep-space' ? 'prod_plate_deep_space' : null),
  resolveProProductId: (key: string) => (key === 'pro_monthly' ? 'prod_monthly' : null),
  resolveTeamProductId: (key: string) => (key === 'team_monthly' ? 'prod_team_monthly' : null)
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

describe('GET /api/checkout — plate ownership gate', () => {
  beforeEach(() => {
    getSessionUserIdMock.mockReset()
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 9 })
    getOwnedPlateIdsMock.mockReset()
    getOwnedPlateIdsMock.mockResolvedValue([])
    checkoutsCreateMock.mockReset()
    checkoutsCreateMock.mockResolvedValue({ url: 'https://polar.sh/checkout/chk_1' })
    getPolarClientMock.mockReset()
    getPolarClientMock.mockReturnValue({ checkouts: { create: checkoutsCreateMock } })
    // Discount lookup would read the tier from the DB — keep it out of the way.
    vi.stubEnv('POLAR_DISCOUNT_PRO_PLATES', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses an already-owned plate: bounces to the shop, never reaches Polar', async () => {
    getOwnedPlateIdsMock.mockResolvedValue(['deep-space'])

    const response = await GET(plateCheckoutRequest('deep-space'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://cribble.dev/shop?checkout=owned')
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('sends a not-yet-owned plate to the Polar hosted checkout', async () => {
    getOwnedPlateIdsMock.mockResolvedValue(['koi-pond'])

    const response = await GET(plateCheckoutRequest('deep-space'))

    expect(getOwnedPlateIdsMock).toHaveBeenCalledWith(expect.anything(), 9)
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: ['prod_plate_deep_space'],
        externalCustomerId: '9',
        metadata: { userId: 9, plateId: 'deep-space' }
      })
    )
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://polar.sh/checkout/chk_1')
  })

  it('keeps refusing unsellable plates before the ownership read (catalog is the authority)', async () => {
    const response = await GET(plateCheckoutRequest('pro-circuit'))

    expect(response.status).toBe(404)
    expect(getOwnedPlateIdsMock).not.toHaveBeenCalled()
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  // Where Polar sends the buyer afterwards: team checkouts land on the
  // /team console (which runs the sync ack and shows the review gate),
  // everything else returns to the shop. {CHECKOUT_ID} is Polar's
  // template token — it must survive as literal braces, never encoded.
  it('points team checkouts back at the /team console', async () => {
    const response = await GET(
      new NextRequest('https://cribble.dev/api/checkout?type=team_monthly', {
        headers: { host: 'cribble.dev' }
      })
    )

    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: ['prod_team_monthly'],
        successUrl: 'http://cribble.dev/team?checkout=success&checkout_id={CHECKOUT_ID}'
      })
    )
    expect(response.status).toBe(307)
  })

  it('refuses Pro checkout for a house complimentary account — Polar never sees it', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 8 })

    const response = await GET(
      new NextRequest('https://cribble.dev/api/checkout?type=pro_monthly', {
        headers: { host: 'cribble.dev' }
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://cribble.dev/shop?checkout=complimentary'
    )
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('refuses Team checkout for a house complimentary account', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 19 })

    const response = await GET(
      new NextRequest('https://cribble.dev/api/checkout?type=team_monthly', {
        headers: { host: 'cribble.dev' }
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://cribble.dev/shop?checkout=complimentary'
    )
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('keeps sending Pro checkouts back to the shop', async () => {
    await GET(
      new NextRequest('https://cribble.dev/api/checkout?type=pro_monthly', {
        headers: { host: 'cribble.dev' }
      })
    )

    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: 'http://cribble.dev/shop?checkout=success&checkout_id={CHECKOUT_ID}'
      })
    )
  })
})
