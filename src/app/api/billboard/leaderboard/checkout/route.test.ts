import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeaderboardSponsorEntry } from '@/lib/leaderboardSponsor'

// The bid checkout's core promise: the browser NEVER chooses the charged
// amount. The route recomputes the board, prices the difference to the
// stated target server-side (with the $2.00 floor), and a target the
// moved board no longer honors gets a 409 carrying the FRESH minimum —
// never a checkout at a stale price. The pricing math itself
// (lib/leaderboardSponsor) runs unmocked; the board read, session and
// Polar client are faked.

const {
  getSessionUserIdMock,
  loadSponsorBoardMock,
  checkoutsCreateMock,
  adReadResult,
  guestReadResult,
  bidInsertMock,
  distributedLimitMock
} = vi.hoisted(() => ({
  getSessionUserIdMock: vi.fn(),
  loadSponsorBoardMock: vi.fn(),
  checkoutsCreateMock: vi.fn(),
  adReadResult: { value: { data: null, error: null } as { data: unknown; error: unknown } },
  guestReadResult: { value: { data: null, error: null } as { data: unknown; error: unknown } },
  bidInsertMock: vi.fn(),
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
      if (table === 'billboard_guests') {
        // sponsorAuth's claim-cookie resolution, running REAL here so
        // guest tests exercise the full identity ladder.
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve(guestReadResult.value) })
          })
        }
      }
      if (table === 'leaderboard_sponsor_bids') {
        return { insert: bidInsertMock }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

// The board derivation is a service-role query + pure ranker; here the
// derived board is staged directly so each test states the market the
// buyer bids into.
vi.mock('@/lib/leaderboardSponsorServer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/leaderboardSponsorServer')>()),
  loadSponsorBoard: loadSponsorBoardMock
}))

vi.mock('@/lib/polar', () => ({
  getPolarClient: () => ({ checkouts: { create: checkoutsCreateMock } }),
  isPolarConfigured: () => true,
  resolveLeaderboardBidProductId: () => 'prod_lb_bid'
}))

import { POST } from './route'

/** A derived board entry — only adId/activeCents/rank matter to the
 *  checkout gates; the creative fields ride along for shape fidelity. */
function boardEntry(adId: number, activeCents: number, rank: number): LeaderboardSponsorEntry {
  return {
    adId,
    rank,
    companyName: `Sponsor ${adId}`,
    linkHost: 'example.com',
    text: 'One line',
    logoUrl: null,
    accentColor: null,
    clicks: 0,
    activeCents,
    nextDropAt: '2026-08-26T10:00:00.000Z',
    expiresAt: '2026-08-26T10:00:00.000Z'
  }
}

/** POST with the explicit host header pinning resolveAppUrl (the
 *  dev/test branch follows Host), so successUrl assertions hold. */
function bidRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('https://cribble.dev/api/billboard/leaderboard/checkout', {
    method: 'POST',
    headers: { host: 'cribble.dev', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

/** The buyer's own APPROVED leaderboard creative (ad 4, user 9). */
const approvedAd = () => ({
  id: 4,
  owner_user_id: 9,
  placement: 'leaderboard',
  status: 'APPROVED'
})

describe('POST /api/billboard/leaderboard/checkout', () => {
  beforeEach(() => {
    getSessionUserIdMock.mockReset()
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 9 })
    loadSponsorBoardMock.mockReset()
    loadSponsorBoardMock.mockResolvedValue([])
    checkoutsCreateMock.mockReset()
    checkoutsCreateMock.mockResolvedValue({
      id: 'chk_lb_1',
      url: 'https://polar.sh/checkout/chk_lb_1'
    })
    adReadResult.value = { data: approvedAd(), error: null }
    guestReadResult.value = { data: null, error: null }
    bidInsertMock.mockReset()
    bidInsertMock.mockResolvedValue({ error: null })
    distributedLimitMock.mockReset()
    distributedLimitMock.mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      resetTime: Date.now() + 60_000
    })
  })

  it('requires a session before anything else — no board read, no Polar', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 666 }))

    expect(response.status).toBe(401)
    expect(loadSponsorBoardMock).not.toHaveBeenCalled()
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

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 666 }))

    expect(response.status).toBe(429)
    // Keyed per USER (cross-instance), not per IP — serverless fan-out
    // and spoofed forwarding headers must not multiply the budget.
    expect(distributedLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxRequests: 5 }),
      'lb-bid-checkout:9'
    )
    expect(loadSponsorBoardMock).not.toHaveBeenCalled()
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
    expect(bidInsertMock).not.toHaveBeenCalled()
  })

  it("404s someone else's creative exactly like a missing one", async () => {
    adReadResult.value = { data: { ...approvedAd(), owner_user_id: 7 }, error: null }

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 666 }))

    expect(response.status).toBe(404)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a creative still in review — bids open only after approval', async () => {
    adReadResult.value = { data: { ...approvedAd(), status: 'PENDING' }, error: null }

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 666 }))

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toMatch(/approved/i)
    // The unapproved 409 carries no minTargetCents — the buyer UI keys
    // its board-moved retry on that field, and this is not that case.
    expect(body.minTargetCents).toBeUndefined()
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
    expect(bidInsertMock).not.toHaveBeenCalled()
  })

  it('rejects a creative on another placement', async () => {
    adReadResult.value = { data: { ...approvedAd(), placement: 'flipper' }, error: null }

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 666 }))

    expect(response.status).toBe(400)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('409s a stale target with the FRESH minimum instead of checking out at the old price', async () => {
    // The buyer previewed against a $9 top; by submit the top is $10 —
    // the fresh minimum is $10 + max($1, ceil($1)) = $11.
    loadSponsorBoardMock.mockResolvedValue([boardEntry(2, 1000, 1)])

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 1050 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: expect.any(String),
      minTargetCents: 1100,
      topTotalCents: 1000,
      activeCents: 0
    })
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
    expect(bidInsertMock).not.toHaveBeenCalled()
  })

  it('holds the first bid on an empty board to the $6.66 opening', async () => {
    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 500 }))

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.minTargetCents).toBe(666)
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('prices the opening bid server-side and records the PENDING ledger row Polar must match', async () => {
    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 666 }))

    expect(response.status).toBe(200)
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: ['prod_lb_bid'],
        // Ad-hoc fixed pricing: the server-computed charge, never a
        // client-chosen amount.
        prices: {
          prod_lb_bid: [{ amountType: 'fixed', priceAmount: 666, priceCurrency: 'usd' }]
        },
        externalCustomerId: '9',
        // Sponsor stake can never be reduced by an org coupon. A real
        // production checkout once succeeded at $0 after a 100% code;
        // the ledger correctly refused it, but the buyer got no rank.
        allowDiscountCodes: false,
        metadata: {
          userId: 9,
          kind: 'leaderboard_bid',
          lbAdId: 4,
          lbTargetCents: 666,
          lbChargeCents: 666
        },
        // The return leg BillboardLanding handles directly, where the
        // exact checkout id triggers pull-based bid reconciliation.
        // {CHECKOUT_ID} is Polar's template token — literal braces.
        successUrl:
          'http://cribble.dev/sponsorship?lb_checkout=success&checkout_id={CHECKOUT_ID}',
        returnUrl: 'http://cribble.dev/sponsorship?intent=leaderboard-bid'
      })
    )
    // The PENDING row activation verifies against — its amount is the
    // charge, keyed to the checkout Polar just created.
    expect(bidInsertMock).toHaveBeenCalledWith({
      ad_id: 4,
      user_id: 9,
      status: 'PENDING',
      amount_cents: 666,
      target_total_cents: 666,
      polar_checkout_id: 'chk_lb_1'
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      url: 'https://polar.sh/checkout/chk_lb_1',
      checkoutId: 'chk_lb_1',
      chargeCents: 666,
      targetTotalCents: 666,
      activeCents: 0
    })
  })

  it('forwards a valid buyer IP so Polar localizes checkout to the visitor, not the server', async () => {
    const response = await POST(
      bidRequest(
        { adId: 4, targetTotalCents: 666 },
        { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }
      )
    )

    expect(response.status).toBe(200)
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerIpAddress: '203.0.113.7' })
    )
  })

  it('does not forward a malformed buyer IP to Polar', async () => {
    const response = await POST(
      bidRequest({ adId: 4, targetTotalCents: 666 }, { 'x-forwarded-for': 'not-an-ip' })
    )

    expect(response.status).toBe(200)
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ customerIpAddress: expect.anything() })
    )
  })

  it('charges a returning challenger only the difference from their own active total', async () => {
    // Top holds $10; the buyer already has $3 active at #2. Beating #1
    // takes $11 — the charge is $11 - $3 = $8.
    loadSponsorBoardMock.mockResolvedValue([boardEntry(2, 1000, 1), boardEntry(4, 300, 2)])

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 1100 }))

    expect(response.status).toBe(200)
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: {
          prod_lb_bid: [{ amountType: 'fixed', priceAmount: 800, priceCurrency: 'usd' }]
        }
      })
    )
    expect(bidInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 800, target_total_cents: 1100 })
    )
    await expect(response.json()).resolves.toMatchObject({
      chargeCents: 800,
      activeCents: 300
    })
  })

  it("lets the #1 holder top up below the challenger minimum, floored at $2 — and the overshoot still counts", async () => {
    // The holder defends with a $0.50 raise: no beat-#1 gate applies to
    // their own throne, but the $2.00 checkout floor overshoots the
    // difference — the ledger records the full $2 as the contribution.
    loadSponsorBoardMock.mockResolvedValue([boardEntry(4, 1000, 1)])

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 1050 }))

    expect(response.status).toBe(200)
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: {
          prod_lb_bid: [{ amountType: 'fixed', priceAmount: 200, priceCurrency: 'usd' }]
        }
      })
    )
    expect(bidInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 200 })
    )
    await expect(response.json()).resolves.toMatchObject({
      chargeCents: 200,
      activeCents: 1000
    })
  })

  it('400s a target the buyer already meets — nothing to buy', async () => {
    loadSponsorBoardMock.mockResolvedValue([boardEntry(4, 1000, 1)])

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 900 }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ activeCents: 1000 })
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('refuses a target above the $10,000 ceiling while the board sits below it', async () => {
    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 1_000_001 }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.maxTargetCents).toBe(1_000_000)
    // No minTargetCents in an over-ceiling 400: the buyer UI keys its
    // board-moved retry on that field, and a typo is not that case.
    expect(body.minTargetCents).toBeUndefined()
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
    expect(bidInsertMock).not.toHaveBeenCalled()
  })

  it('never locks the board: past ~$9,091 the 409 minimum exceeds the static cap, and the retry at it succeeds', async () => {
    // Top holds $9,500 — the fresh minimum is $9,500 + $950-rounded-up
    // = $10,450, ABOVE the $10,000 fat-finger cap. The old static cap
    // rejected every legal challenge here, freezing #1 in place.
    loadSponsorBoardMock.mockResolvedValue([boardEntry(2, 950_000, 1)])

    const stale = await POST(bidRequest({ adId: 4, targetTotalCents: 1_000_000 }))
    expect(stale.status).toBe(409)
    const staleBody = await stale.json()
    expect(staleBody.minTargetCents).toBe(1_045_000)

    // The buyer UI retries at exactly the 409's minimum — the ceiling
    // lifts to meet it, so the challenge sails through.
    const retry = await POST(bidRequest({ adId: 4, targetTotalCents: 1_045_000 }))
    expect(retry.status).toBe(200)
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: {
          prod_lb_bid: [{ amountType: 'fixed', priceAmount: 1_045_000, priceCurrency: 'usd' }]
        }
      })
    )
    expect(bidInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 1_045_000, target_total_cents: 1_045_000 })
    )
  })

  it('the lifted ceiling binds at exactly the minimum — overshoot above it is still a fat-finger 400', async () => {
    loadSponsorBoardMock.mockResolvedValue([boardEntry(2, 950_000, 1)])

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 1_045_100 }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ maxTargetCents: 1_045_000 })
    expect(checkoutsCreateMock).not.toHaveBeenCalled()
  })

  it('the #1 holder can still top up once their active total sits above the static cap', async () => {
    // Floor overshoot can push a holder past $10,000; the ceiling must
    // keep following (max of cap and the holder-relative minimum) or
    // the throne could never be defended again.
    loadSponsorBoardMock.mockResolvedValue([boardEntry(4, 1_000_100, 1)])

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 1_000_300 }))

    expect(response.status).toBe(200)
    expect(bidInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 200, target_total_cents: 1_000_300 })
    )
  })

  it('fails the request when the ledger insert fails — a checkout without its row could never activate', async () => {
    bidInsertMock.mockResolvedValue({ error: { message: 'insert failed' } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(bidRequest({ adId: 4, targetTotalCents: 666 }))

    expect(response.status).toBe(500)
    errorSpy.mockRestore()
  })

  it('bids for a claim-cookie guest: guest_id ownership, per-guest budget key, metadata guestId and no external customer id', async () => {
    // The identity ladder's guest rung: definitive 401 from the
    // session, cookie resolving to guest 21 who owns the creative.
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    guestReadResult.value = { data: { id: 21 }, error: null }
    adReadResult.value = {
      data: { ...approvedAd(), owner_user_id: null, guest_id: 21, billing_email: 'guest@acme.dev' },
      error: null
    }

    const response = await POST(
      bidRequest(
        { adId: 4, targetTotalCents: 666 },
        { cookie: `cribble_sponsor_claim=${'cd'.repeat(32)}` }
      )
    )

    expect(response.status).toBe(200)
    expect(distributedLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxRequests: 5 }),
      'lb-bid-checkout:g21'
    )
    // Guests have no Polar external-customer mapping — their orders
    // verify through metadata.guestId, and the submission-time billing
    // email prefills the hosted form.
    expect(checkoutsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'guest@acme.dev',
        metadata: expect.objectContaining({ guestId: 21, kind: 'leaderboard_bid' })
      })
    )
    expect(checkoutsCreateMock.mock.calls[0][0]).not.toHaveProperty('externalCustomerId')
    // The ledger row names the guest and never a user.
    expect(bidInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ ad_id: 4, guest_id: 21, status: 'PENDING' })
    )
    expect(bidInsertMock.mock.calls[0][0]).not.toHaveProperty('user_id')
  })
})
