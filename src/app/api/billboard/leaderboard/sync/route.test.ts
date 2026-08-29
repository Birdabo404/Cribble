import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionUserIdMock,
  syncSponsorBidCheckoutFromPolarMock,
  syncSponsorBidsFromPolarMock
} = vi.hoisted(() => ({
  getSessionUserIdMock: vi.fn(),
  syncSponsorBidCheckoutFromPolarMock: vi.fn(),
  syncSponsorBidsFromPolarMock: vi.fn()
}))

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: getSessionUserIdMock }))

vi.mock('@/lib/leaderboardSponsorServer', () => ({
  syncSponsorBidCheckoutFromPolar: syncSponsorBidCheckoutFromPolarMock,
  syncSponsorBidsFromPolar: syncSponsorBidsFromPolarMock
}))

vi.mock('@/lib/polar', () => ({ isPolarConfigured: () => true }))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({})
}))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({
    success: true,
    limit: 60,
    remaining: 59,
    resetTime: Date.now() + 60_000
  }),
  createRateLimitResponse: () => new Headers(),
  rateLimitConfigs: { api: { windowMs: 60_000, maxRequests: 60 } }
}))

import { POST } from './route'

function syncRequest(body?: unknown) {
  return new NextRequest('https://cribble.dev/api/billboard/leaderboard/sync', {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
  })
}

describe('POST /api/billboard/leaderboard/sync', () => {
  beforeEach(() => {
    getSessionUserIdMock.mockReset()
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 9 })
    syncSponsorBidCheckoutFromPolarMock.mockReset()
    syncSponsorBidCheckoutFromPolarMock.mockResolvedValue('activated')
    syncSponsorBidsFromPolarMock.mockReset()
    syncSponsorBidsFromPolarMock.mockResolvedValue(0)
  })

  it('reconciles the exact returned checkout and exposes its terminal status', async () => {
    const response = await POST(syncRequest({ checkoutId: 'chk_lb_1' }))

    expect(response.status).toBe(200)
    expect(syncSponsorBidCheckoutFromPolarMock).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 9 },
      'chk_lb_1'
    )
    expect(syncSponsorBidsFromPolarMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      success: true,
      activated: 1,
      status: 'activated'
    })
  })

  it('reports a refused exact checkout without claiming a bid was activated', async () => {
    syncSponsorBidCheckoutFromPolarMock.mockResolvedValue('refused')

    const response = await POST(syncRequest({ checkoutId: 'chk_coupon_100' }))

    await expect(response.json()).resolves.toEqual({
      success: true,
      activated: 0,
      status: 'refused'
    })
  })

  it('keeps no-body callers on the broad pending-row fallback', async () => {
    syncSponsorBidsFromPolarMock.mockResolvedValue(2)

    const response = await POST(syncRequest())

    expect(syncSponsorBidCheckoutFromPolarMock).not.toHaveBeenCalled()
    expect(syncSponsorBidsFromPolarMock).toHaveBeenCalledWith(expect.anything(), 9)
    await expect(response.json()).resolves.toEqual({ success: true, activated: 2 })
  })

  it('requires authentication before either reconciliation path', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await POST(syncRequest({ checkoutId: 'chk_lb_1' }))

    expect(response.status).toBe(401)
    expect(syncSponsorBidCheckoutFromPolarMock).not.toHaveBeenCalled()
    expect(syncSponsorBidsFromPolarMock).not.toHaveBeenCalled()
  })
})
