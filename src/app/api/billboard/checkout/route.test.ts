import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BILLBOARD_DURATION_DAYS } from '@/lib/billboard'

// The slot checkout's core promise: the browser NEVER chooses the
// charged amount. The route prices the advertised sticker server-side,
// grosses it up for Polar's fee (the gross-up math itself runs
// unmocked from lib/billboard), binds the rail slot choice at checkout
// time, and refuses everything that shouldn't reach Polar — foreign or
// unapproved ads, live or already-scheduled windows, and double-buys
// behind a fresh in-flight checkout. The queue-start derivation is a
// service-role occupancy read; here it is staged directly so each test
// states the board the buyer pays into.

const {
  getSessionUserIdMock,
  slotWindowStartAtMock,
  checkoutsCreateMock,
  adReadResult,
  pendingCountResult,
  orderInsertMock,
  distributedLimitMock
} = vi.hoisted(() => ({
  getSessionUserIdMock: vi.fn(),
  slotWindowStartAtMock: vi.fn(),
  checkoutsCreateMock: vi.fn(),
  adReadResult: { value: { data: null, error: null } as { data: unknown; error: unknown } },
  pendingCountResult: {
    value: { count: 0, error: null } as { count: number | null; error: unknown }
  },
  orderInsertMock: vi.fn(),
  distributedLimitMock: vi.fn()
}))

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: getSessionUserIdMock }))

// The cross-instance per-buyer budget (Postgres-backed in production) is
// faked; the process-local IP prefilter runs real and stays far under
// its allowance here.
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  checkDistributedRateLimit: distributedLimitMock
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'billboard_ads') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve(adReadResult.value) })
          })
        }
      }
      if (table === 'billboard_slot_orders') {
        // Two chains: the fresh-PENDING head count (select -> eq -> eq
        // -> gt, awaited for { count }) and the ledger insert.
        return {
          select: () => {
            const builder = {
              eq: () => builder,
              gt: () => builder,
              then(onFulfilled: (value: unknown) => unknown) {
                return Promise.resolve(pendingCountResult.value).then(onFulfilled)
              }
            }
            return builder
          },
          insert: orderInsertMock
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

// The queue-start derivation is an occupancy read + pure sweep, tested
// in billboardSlotServer.test.ts; here its answer is staged so the
// disclosure contract (estimated window, queued flag) is what's
// asserted.
vi.mock('@/lib/billboardSlotServer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billboardSlotServer')>()),
  slotWindowStartAt: slotWindowStartAtMock
}))

vi.mock('@/lib/polar', () => ({
  getPolarClient: () => ({ checkouts: { create: checkoutsCreateMock } }),
  isPolarConfigured: () => true,
  resolveBillboardSlotProductId: () => 'prod_bb_slot'
}))

import { POST } from './route'

const DAY_MS = 86_400_000

/** POST with the explicit host header pinning resolveAppUrl (the
 *  dev/test branch follows Host), so successUrl assertions hold. */
function slotRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('https://cribble.dev/api/billboard/checkout', {
    method: 'POST',
    headers: { host: 'cribble.dev', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

/** The buyer's own APPROVED flipper ad (ad 4, user 9), no window yet. */
const approvedAd = () => ({
  id: 4,
  owner_user_id: 9,
  placement: 'flipper',
  status: 'APPROVED',
  requested_rail_slot: null,
  paid_at: null,
  starts_at: null,
  ends_at: null
})

describe('POST /api/billboard/checkout', () => {
  beforeEach(() => {
    getSessionUserIdMock.mockReset()
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 9 })
    slotWindowStartAtMock.mockReset()
    // A start just behind the wall clock reads as "live now" (queued
    // false); the queued test stages a future opening instead.
    slotWindowStartAtMock.mockResolvedValue(new Date(Date.now() - 1_000))
    checkoutsCreateMock.mockReset()
    checkoutsCreateMock.mockResolvedValue({
      id: 'chk_bb_1',
      url: 'https://polar.sh/checkout/chk_bb_1'
    })
    adReadResult.value = { data: approvedAd(), error: null }
    pendingCountResult.value = { count: 0, error: null }
    orderInsertMock.mockReset()
    orderInsertMock.mockResolvedValue({ error: null })
    distributedLimitMock.mockReset()
    distributedLimitMock.mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      resetTime: Date.now() + 60_000
    })
  })

  it('requires a session before anything else — no ad read, no Polar', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(401)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('enforces the per-buyer distributed budget right after auth — checkout creation is not on the generic allowance', async () => {
    distributedLimitMock.mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      retryAfter: 60
    })

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(429)
    // Keyed per USER (cross-instance), not per IP — serverless fan-out
    // and spoofed forwarding headers must not multiply the budget.
    expect(distributedLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxRequests: 5 }),
      'bb-slot-checkout:9'
    )
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
    expect(orderInsertMock).not.toHaveBeenCalled()
  })

  it("404s someone else's ad exactly like a missing one", async () => {
    adReadResult.value = { data: { ...approvedAd(), owner_user_id: 7 }, error: null }

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(404)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a leaderboard creative — those settle through the bid checkout', async () => {
    adReadResult.value = { data: { ...approvedAd(), placement: 'leaderboard' }, error: null }

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(400)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects an ad still in review — payment opens only after approval', async () => {
    adReadResult.value = { data: { ...approvedAd(), status: 'PENDING' }, error: null }

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toMatch(/approved/i)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects an ad whose window is running right now', async () => {
    adReadResult.value = {
      data: {
        ...approvedAd(),
        paid_at: new Date(Date.now() - DAY_MS).toISOString(),
        starts_at: new Date(Date.now() - DAY_MS).toISOString(),
        ends_at: new Date(Date.now() + 6 * DAY_MS).toISOString()
      },
      error: null
    }

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/already live/i)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('409s an ad already queued behind a paid future window — the ad row holds ONE window', async () => {
    adReadResult.value = {
      data: {
        ...approvedAd(),
        paid_at: new Date().toISOString(),
        starts_at: new Date(Date.now() + 2 * DAY_MS).toISOString(),
        ends_at: new Date(Date.now() + 9 * DAY_MS).toISOString()
      },
      error: null
    }

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toMatch(/scheduled/i)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a slot on a flipper ad — there is nothing to pick', async () => {
    const response = await POST(slotRequest({ adId: 4, slot: 'L1' }))

    expect(response.status).toBe(400)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('409s while a fresh PENDING checkout for this ad is in flight — no accidental double-buys', async () => {
    pendingCountResult.value = { count: 1, error: null }

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(409)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
    expect(orderInsertMock).not.toHaveBeenCalled()
  })

  it('prices the flipper server-side at the GROSS $209 and records the PENDING ledger row Polar must match', async () => {
    const estimatedStartsAt = new Date(Date.now() - 1_000)
    slotWindowStartAtMock.mockResolvedValue(estimatedStartsAt)

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(200)
    // The shared queue derivation, with the ad itself excluded.
    expect(slotWindowStartAtMock).toHaveBeenCalledWith(
      expect.anything(),
      'flipper',
      null,
      expect.any(Date),
      4
    )
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: ['prod_bb_slot'],
        // Ad-hoc fixed pricing: the fee-grossed total, never the
        // advertised sticker and never a client-chosen amount.
        prices: {
          prod_bb_slot: [{ amountType: 'fixed', priceAmount: 20900, priceCurrency: 'usd' }]
        },
        externalCustomerId: '9',
        // The gross-up nets exactly the sticker — an org coupon
        // shrinking the order would make the integrity gate refuse a
        // checkout Polar reports as paid.
        allowDiscountCodes: false,
        metadata: {
          userId: 9,
          kind: 'billboard_slot',
          bbAdId: 4,
          bbPlacement: 'flipper',
          bbListCents: 20000
        },
        // The return leg the tracker handles, where the exact checkout
        // id triggers the slot sync route. {CHECKOUT_ID} is Polar's
        // template token — literal braces.
        successUrl:
          'http://cribble.dev/sponsorship?bb_checkout=success&checkout_id={CHECKOUT_ID}',
        returnUrl: 'http://cribble.dev/sponsorship'
      })
    )
    // The PENDING row activation verifies against — its amount is the
    // GROSS, keyed to the checkout Polar just created.
    expect(orderInsertMock).toHaveBeenCalledWith({
      ad_id: 4,
      user_id: 9,
      placement: 'flipper',
      rail_slot: null,
      status: 'PENDING',
      amount_cents: 20900,
      list_price_cents: 20000,
      polar_checkout_id: 'chk_bb_1'
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      url: 'https://polar.sh/checkout/chk_bb_1',
      checkoutId: 'chk_bb_1',
      placement: 'flipper',
      slot: null,
      listCents: 20000,
      grossCents: 20900,
      estimatedStartsAt: estimatedStartsAt.toISOString(),
      estimatedEndsAt: new Date(
        estimatedStartsAt.getTime() + BILLBOARD_DURATION_DAYS * DAY_MS
      ).toISOString(),
      queued: false
    })
  })

  it('discloses a queued go-live BEFORE the buyer pays when the board is full', async () => {
    const queuedStartsAt = new Date(Date.now() + 3 * DAY_MS)
    slotWindowStartAtMock.mockResolvedValue(queuedStartsAt)

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      queued: true,
      estimatedStartsAt: queuedStartsAt.toISOString()
    })
    // Disclosure only — checkout still goes out; a full board never
    // refuses money, it queues it.
    expect(checkoutsCreateMock).toHaveBeenCalled()
  })

  it('binds an explicit rail slot at checkout, priced off that rung of the ladder', async () => {
    adReadResult.value = {
      data: { ...approvedAd(), placement: 'rail', requested_rail_slot: 'L4' },
      error: null
    }

    const response = await POST(slotRequest({ adId: 4, slot: 'L1' }))

    expect(response.status).toBe(200)
    expect(slotWindowStartAtMock).toHaveBeenCalledWith(
      expect.anything(),
      'rail',
      'L1',
      expect.any(Date),
      4
    )
    // L1 lists at $499 -> $521 gross; the body's choice outranks the
    // submission-time wish.
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: {
          prod_bb_slot: [{ amountType: 'fixed', priceAmount: 52100, priceCurrency: 'usd' }]
        },
        metadata: expect.objectContaining({ bbPlacement: 'rail', bbSlot: 'L1', bbListCents: 49900 })
      })
    )
    expect(orderInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ placement: 'rail', rail_slot: 'L1', amount_cents: 52100, list_price_cents: 49900 })
    )
    await expect(response.json()).resolves.toMatchObject({ slot: 'L1', grossCents: 52100 })
  })

  it("defaults a slotless rail body to the ad's requested_rail_slot", async () => {
    adReadResult.value = {
      data: { ...approvedAd(), placement: 'rail', requested_rail_slot: 'L3' },
      error: null
    }

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(200)
    // L3 lists at $299 -> $312 gross.
    expect(orderInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ rail_slot: 'L3', amount_cents: 31200, list_price_cents: 29900 })
    )
  })

  it('refuses a rail checkout with no slot from either the body or the submission', async () => {
    adReadResult.value = {
      data: { ...approvedAd(), placement: 'rail', requested_rail_slot: null },
      error: null
    }

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(400)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('forwards a valid buyer IP so Polar localizes checkout to the visitor, not the server', async () => {
    const response = await POST(
      slotRequest({ adId: 4 }, { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    )

    expect(response.status).toBe(200)
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerIpAddress: '203.0.113.7' })
    )
  })

  it('does not forward a malformed buyer IP to Polar', async () => {
    const response = await POST(slotRequest({ adId: 4 }, { 'x-forwarded-for': 'not-an-ip' }))

    expect(response.status).toBe(200)
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ customerIpAddress: expect.anything() })
    )
  })

  it('fails the request when the ledger insert fails — a checkout without its row could never activate', async () => {
    orderInsertMock.mockResolvedValue({ error: { message: 'insert failed' } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(slotRequest({ adId: 4 }))

    expect(response.status).toBe(500)
    errorSpy.mockRestore()
  })
})
