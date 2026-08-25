import type { SupabaseClient } from '@supabase/supabase-js'
import type { Order } from '@polar-sh/sdk/models/components/order'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { LEADERBOARD_SPONSOR_PENDING_TTL_MS } from './leaderboardSponsor'

// The payment-integrity core against a STATEFUL ledger fake: unlike the
// webhook route tests (which pin the exact filter chains), these run
// activation and revocation in sequence against the same mutating row,
// so the event-ORDERING guarantees are what's under test — above all
// that a refund delivered before, or racing, order.paid leaves the row
// REFUNDED and the late activation refused. Money that went back must
// never rank, whichever order Polar's deliveries land in.

const { getPolarClientMock } = vi.hoisted(() => ({
  getPolarClientMock: vi.fn()
}))

vi.mock('@/lib/polar', () => ({
  getPolarClient: getPolarClientMock,
  resolveLeaderboardBidProductId: () => 'prod_lb_bid'
}))

import {
  activateSponsorBidFromOrder,
  revokeSponsorBidFromOrder,
  syncSponsorBidCheckoutFromPolar,
  syncSponsorBidsFromPolar
} from './leaderboardSponsorServer'

type LedgerRow = Record<string, unknown>
type Filter = ['eq' | 'in' | 'gt', string, unknown]

function rowMatches(row: LedgerRow, filters: Filter[]): boolean {
  return filters.every(([op, column, value]) => {
    const current = row[column]
    if (op === 'eq') return current === value
    if (op === 'in') return Array.isArray(value) && value.includes(current)
    // 'gt' — ISO timestamp comparison, lexicographic like the database's.
    return typeof current === 'string' && typeof value === 'string' && current > value
  })
}

/** An in-memory leaderboard_sponsor_bids table honoring exactly the
 *  query chains the server module issues: filtered select (awaited or
 *  .maybeSingle()) and filtered update (awaited or .select()), with
 *  updates actually MUTATING the rows so sequenced calls observe each
 *  other — the point of this suite. */
function fakeLedger(rows: LedgerRow[], beforeFirstUpdate?: () => void): SupabaseClient {
  const client = {
    from(table: string) {
      if (table !== 'leaderboard_sponsor_bids') {
        throw new Error(`Unexpected table: ${table}`)
      }
      return {
        select() {
          const filters: Filter[] = []
          const builder = {
            eq(column: string, value: unknown) {
              filters.push(['eq', column, value])
              return builder
            },
            gt(column: string, value: unknown) {
              filters.push(['gt', column, value])
              return builder
            },
            async maybeSingle() {
              return { data: rows.find((row) => rowMatches(row, filters)) ?? null, error: null }
            },
            then(
              onFulfilled: (value: { data: LedgerRow[]; error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown
            ) {
              return Promise.resolve({
                data: rows.filter((row) => rowMatches(row, filters)),
                error: null
              }).then(onFulfilled, onRejected)
            }
          }
          return builder
        },
        update(values: Record<string, unknown>) {
          const filters: Filter[] = []
          const apply = () => {
            beforeFirstUpdate?.()
            beforeFirstUpdate = undefined
            const hit = rows.filter((row) => rowMatches(row, filters))
            for (const row of hit) Object.assign(row, values)
            return { data: hit.map((row) => ({ id: row.id })), error: null }
          }
          const builder = {
            eq(column: string, value: unknown) {
              filters.push(['eq', column, value])
              return builder
            },
            in(column: string, value: unknown[]) {
              filters.push(['in', column, value])
              return builder
            },
            async select() {
              return apply()
            },
            then(
              onFulfilled: (value: { data: unknown; error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown
            ) {
              return Promise.resolve(apply()).then(onFulfilled, onRejected)
            }
          }
          return builder
        }
      }
    }
  }
  return client as unknown as SupabaseClient
}

/** A PENDING ledger row fresh from checkout creation. */
function makeRow(overrides: LedgerRow = {}): LedgerRow {
  return {
    id: 55,
    ad_id: 4,
    user_id: 9,
    status: 'PENDING',
    amount_cents: 766,
    polar_checkout_id: 'chk_lb_1',
    polar_order_id: null,
    paid_at: null,
    refunded_at: null,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides
  }
}

/** The paid Polar order this row's checkout produced — every field the
 *  verification chain inspects matches makeRow(). */
function paidOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    id: 'order_lb_1',
    checkoutId: 'chk_lb_1',
    productId: 'prod_lb_bid',
    netAmount: 766,
    currency: 'usd',
    createdAt: new Date('2026-08-25T10:00:00.000Z'),
    paid: true,
    status: 'paid',
    metadata: { userId: 9, kind: 'leaderboard_bid' },
    customer: { externalId: '9' },
    ...overrides
  } as unknown as Order
}

function refundedOrder(overrides: Record<string, unknown> = {}): Order {
  return paidOrder({ status: 'refunded', ...overrides })
}

describe('refund/activation ordering (leaderboardSponsorServer)', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    getPolarClientMock.mockReset()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('a refund delivered BEFORE order.paid revokes the still-PENDING row, and the late activation is refused', async () => {
    // The race the checkout-id keying exists for: order.paid failed
    // transiently (Polar will retry), the buyer refunds meanwhile, and
    // order.refunded lands first — while polar_order_id is still NULL.
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)

    await revokeSponsorBidFromOrder(supabase, refundedOrder())
    expect(rows[0].status).toBe('REFUNDED')

    await expect(activateSponsorBidFromOrder(supabase, paidOrder())).resolves.toBe('refused')
    expect(rows[0].status).toBe('REFUNDED')
    expect(rows[0].paid_at).toBeNull()
  })

  it('the normal ordering still works: activation stamps the row, the refund then revokes it through the same checkout id', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)

    await expect(activateSponsorBidFromOrder(supabase, paidOrder())).resolves.toBe('activated')
    expect(rows[0].status).toBe('PAID')
    expect(rows[0].polar_order_id).toBe('order_lb_1')
    expect(rows[0].paid_at).toBe('2026-08-25T10:00:00.000Z')

    await revokeSponsorBidFromOrder(supabase, refundedOrder())
    expect(rows[0].status).toBe('REFUNDED')
  })

  it('reports refunded when a refund wins the guarded activation update', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows, () => {
      rows[0].status = 'REFUNDED'
      rows[0].refunded_at = '2026-08-25T10:00:00.000Z'
    })

    await expect(activateSponsorBidFromOrder(supabase, paidOrder())).resolves.toBe('refunded')
    expect(rows[0].status).toBe('REFUNDED')
    expect(rows[0].paid_at).toBeNull()
  })

  it('a refund order without a checkout id falls back to the stamped polar_order_id', async () => {
    const rows = [makeRow({ status: 'PAID', polar_order_id: 'order_lb_1' })]
    const supabase = fakeLedger(rows)

    await revokeSponsorBidFromOrder(supabase, refundedOrder({ checkoutId: null }))
    expect(rows[0].status).toBe('REFUNDED')
  })

  it('revocation is idempotent — an already-REFUNDED row keeps its original refunded_at', async () => {
    const rows = [makeRow({ status: 'REFUNDED', refunded_at: '2026-08-25T09:00:00.000Z' })]
    const supabase = fakeLedger(rows)

    await revokeSponsorBidFromOrder(supabase, refundedOrder())
    expect(rows[0].refunded_at).toBe('2026-08-25T09:00:00.000Z')
    expect(rows[0].status).toBe('REFUNDED')
  })

  it("a refund never touches another checkout's row", async () => {
    const rows = [makeRow({ polar_checkout_id: 'chk_lb_other' })]
    const supabase = fakeLedger(rows)

    await revokeSponsorBidFromOrder(supabase, refundedOrder())
    expect(rows[0].status).toBe('PENDING')
  })

  it('requires the server-stamped buyer metadata instead of accepting a missing payer witness', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)

    await expect(
      activateSponsorBidFromOrder(supabase, paidOrder({ metadata: {} }))
    ).resolves.toBe('refused')
    expect(rows[0].status).toBe('PENDING')
  })
})

describe('syncSponsorBidCheckoutFromPolar exact return checkout', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    getPolarClientMock.mockReset()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('queries by checkout id and activates even when Polar merged the buyer under a different customer external id', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)
    const list = vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          result: {
            items: [paidOrder({ customer: { externalId: 'someone-else' } })]
          }
        }
      }
    }))
    getPolarClientMock.mockReturnValue({ orders: { list } })

    await expect(
      syncSponsorBidCheckoutFromPolar(supabase, 9, 'chk_lb_1')
    ).resolves.toBe('activated')
    expect(list).toHaveBeenCalledWith({ checkoutId: 'chk_lb_1', limit: 10 })
    expect(rows[0].status).toBe('PAID')
  })

  it('refuses a zero-net paid order instead of crediting a coupon-funded bid', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)
    getPolarClientMock.mockReturnValue({
      orders: {
        list: async () => ({
          async *[Symbol.asyncIterator]() {
            yield { result: { items: [paidOrder({ netAmount: 0 })] } }
          }
        })
      }
    })

    await expect(
      syncSponsorBidCheckoutFromPolar(supabase, 9, 'chk_lb_1')
    ).resolves.toBe('refused')
    expect(rows[0].status).toBe('VOID')
    expect(rows[0].failure_reason).toBe('payment_verification_failed')
  })

  it("does not query Polar for another user's or a malformed checkout id", async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)

    await expect(
      syncSponsorBidCheckoutFromPolar(supabase, 7, 'chk_lb_1')
    ).resolves.toBe('not_found')
    await expect(
      syncSponsorBidCheckoutFromPolar(supabase, 9, '../bad')
    ).resolves.toBe('not_found')
    expect(getPolarClientMock).not.toHaveBeenCalled()
  })

  it('reports pending while Polar has not created a paid order yet', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)
    getPolarClientMock.mockReturnValue({
      orders: {
        list: async () => ({
          async *[Symbol.asyncIterator]() {
            yield { result: { items: [] } }
          }
        })
      }
    })

    await expect(
      syncSponsorBidCheckoutFromPolar(supabase, 9, 'chk_lb_1')
    ).resolves.toBe('pending')
  })

  it('revokes and reports an already-refunded paid order', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)
    getPolarClientMock.mockReturnValue({
      orders: {
        list: async () => ({
          async *[Symbol.asyncIterator]() {
            yield { result: { items: [refundedOrder()] } }
          }
        })
      }
    })

    await expect(
      syncSponsorBidCheckoutFromPolar(supabase, 9, 'chk_lb_1')
    ).resolves.toBe('refunded')
    expect(rows[0].status).toBe('REFUNDED')
  })
})

describe('syncSponsorBidsFromPolar pending TTL', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    getPolarClientMock.mockReset()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('ignores pending rows older than the TTL — an abandoned checkout must not poll Polar forever', async () => {
    const rows = [
      makeRow({
        created_at: new Date(
          Date.now() - LEADERBOARD_SPONSOR_PENDING_TTL_MS - 60_000
        ).toISOString()
      })
    ]
    const supabase = fakeLedger(rows)

    await expect(syncSponsorBidsFromPolar(supabase, 9)).resolves.toBe(0)
    expect(getPolarClientMock).not.toHaveBeenCalled()
  })

  it('still reaches for Polar while a live pending row exists', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)
    getPolarClientMock.mockReturnValue(null) // unconfigured — reach is what's asserted

    await expect(syncSponsorBidsFromPolar(supabase, 9)).resolves.toBe(0)
    expect(getPolarClientMock).toHaveBeenCalled()
  })

  it('activates a live pending row from a verified paid order', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)
    getPolarClientMock.mockReturnValue({
      orders: {
        list: async () => ({
          async *[Symbol.asyncIterator]() {
            yield { result: { items: [paidOrder()] } }
          }
        })
      }
    })

    await expect(syncSponsorBidsFromPolar(supabase, 9)).resolves.toBe(1)
    expect(rows[0].status).toBe('PAID')
  })

  it('never activates from an order Polar already marks refunded — the sync-side half of the ordering guarantee', async () => {
    const rows = [makeRow()]
    const supabase = fakeLedger(rows)
    getPolarClientMock.mockReturnValue({
      orders: {
        list: async () => ({
          async *[Symbol.asyncIterator]() {
            yield { result: { items: [paidOrder({ status: 'refunded' })] } }
          }
        })
      }
    })

    await expect(syncSponsorBidsFromPolar(supabase, 9)).resolves.toBe(0)
    expect(rows[0].status).toBe('PENDING')
  })
})
