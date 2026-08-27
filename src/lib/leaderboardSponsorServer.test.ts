import type { SupabaseClient } from '@supabase/supabase-js'
import type { Order } from '@polar-sh/sdk/models/components/order'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import {
  LEADERBOARD_SPONSOR_GRACE_MS,
  LEADERBOARD_SPONSOR_PENDING_TTL_MS,
  LEADERBOARD_SPONSOR_WINDOW_MS
} from './leaderboardSponsor'

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
  sweepFinishedLeaderboardSponsorAds,
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
 *  other — the point of this suite. billboard_ads reads (the post-
 *  activation notification fan-out) see an empty table, so the fan-out
 *  no-ops; the board-shift suite below uses the richer fakeDb instead. */
function fakeLedger(ledgerRows: LedgerRow[], beforeFirstUpdate?: () => void): SupabaseClient {
  const client = {
    from(table: string) {
      if (table !== 'leaderboard_sponsor_bids' && table !== 'billboard_ads') {
        throw new Error(`Unexpected table: ${table}`)
      }
      const rows = table === 'leaderboard_sponsor_bids' ? ledgerRows : []
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

/* ------------------------------------------------------------------ *
 * Lifecycle side effects — board-shift notifications and the finished-
 * run sweep, driven against a mutable multi-table fake so the guarded
 * archive, audit trail, dedupe keys and best-effort contracts are all
 * observable end to end.
 * ------------------------------------------------------------------ */

/** A mutable multi-table Supabase fake covering every chain the
 *  lifecycle paths issue: filtered select (thenable or .maybeSingle()),
 *  filtered update (thenable or .select()), and insert (thenable or
 *  .select().single()). Tables not in the map throw, like fakeLedger. */
function fakeDb(tables: Record<string, LedgerRow[]>): SupabaseClient {
  let nextId = 1000
  const client = {
    from(table: string) {
      const rows = tables[table]
      if (!rows) throw new Error(`Unexpected table: ${table}`)
      return {
        select() {
          const filters: Filter[] = []
          const builder = {
            eq(column: string, value: unknown) {
              filters.push(['eq', column, value])
              return builder
            },
            in(column: string, value: unknown[]) {
              filters.push(['in', column, value])
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
            const hit = rows.filter((row) => rowMatches(row, filters))
            for (const row of hit) Object.assign(row, values)
            return { data: hit.map((row) => ({ id: row.id })), error: null }
          }
          const builder = {
            eq(column: string, value: unknown) {
              filters.push(['eq', column, value])
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
        },
        insert(values: LedgerRow | LedgerRow[]) {
          const inserted = (Array.isArray(values) ? values : [values]).map((value) => ({
            id: ++nextId,
            ...value
          }))
          const apply = () => {
            rows.push(...inserted)
            return { data: inserted, error: null }
          }
          return {
            select() {
              return {
                async single() {
                  const { data } = apply()
                  return { data: data[0], error: null }
                }
              }
            },
            then(
              onFulfilled: (value: { error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown
            ) {
              apply()
              return Promise.resolve({ error: null }).then(onFulfilled, onRejected)
            }
          }
        }
      }
    }
  }
  return client as unknown as SupabaseClient
}

/** An APPROVED leaderboard creative carrying every column the board
 *  derivation selects. logo_url is always set so the owner-avatar
 *  fallback (a users read the fake does not serve) never triggers. */
function makeLeaderboardAd(id: number, ownerUserId: number | null): LedgerRow {
  return {
    id,
    owner_user_id: ownerUserId,
    status: 'APPROVED',
    placement: 'leaderboard',
    review_note: null,
    text: `ad ${id}`,
    company_name: null,
    link_url: 'https://example.com',
    logo_url: 'https://example.com/logo.png',
    accent_color: null,
    clicks: 0
  }
}

function notificationsFor(tables: Record<string, LedgerRow[]>, userId: number): LedgerRow[] {
  return tables.notifications.filter((row) => row.user_id === userId)
}

describe('board-shift notifications on bid activation', () => {
  let errorSpy: MockInstance
  let warnSpy: MockInstance

  beforeEach(() => {
    getPolarClientMock.mockReset()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  const hourAgoIso = () => new Date(Date.now() - 3_600_000).toISOString()

  /** ad 1 (owner 100) holds #1 with $6.66; ad 4 (payer, owner 9) has a
   *  PENDING $7.66 checkout; ads 5 (payer's second) and 7 (owner 300)
   *  are APPROVED with no active contribution. */
  function makeShiftTables(): Record<string, LedgerRow[]> {
    return {
      leaderboard_sponsor_bids: [
        {
          id: 21,
          ad_id: 1,
          user_id: 100,
          status: 'PAID',
          amount_cents: 666,
          polar_checkout_id: 'chk_holder',
          polar_order_id: 'order_holder',
          paid_at: hourAgoIso(),
          created_at: hourAgoIso()
        },
        makeRow({ ad_id: 4 })
      ],
      billboard_ads: [
        makeLeaderboardAd(1, 100),
        makeLeaderboardAd(4, 9),
        makeLeaderboardAd(5, 9),
        makeLeaderboardAd(7, 300)
      ],
      notifications: []
    }
  }

  it('notifies the displaced sponsor (OUTBID) and queued advertisers (spot taken), excluding the payer', async () => {
    const tables = makeShiftTables()
    const supabase = fakeDb(tables)

    // paid_at must land inside the live window relative to the real
    // clock, or the new contribution would rank as already expired.
    await expect(
      activateSponsorBidFromOrder(supabase, paidOrder({ createdAt: new Date() }))
    ).resolves.toBe('activated')

    // Owner 100 dropped from #1 to #2 — outbid, keyed on the ledger row.
    const outbid = notificationsFor(tables, 100)
    expect(outbid).toHaveLength(1)
    expect(outbid[0].title).toBe('SPONSOR SPOT OUTBID')
    expect(outbid[0].body).toContain('#2')
    expect(outbid[0].dedupe_key).toBe('lb_outbid_1_bid_55')

    // Owner 300's queued creative gets the price-move nudge with the
    // fresh minimum ($7.66 top + $1 increment), day-bucketed.
    const priceMove = notificationsFor(tables, 300)
    expect(priceMove).toHaveLength(1)
    expect(priceMove[0].title).toBe('SPONSOR SPOT TAKEN')
    expect(priceMove[0].body).toContain('$8.66')
    expect(priceMove[0].dedupe_key).toBe(
      `lb_price_move_7_${new Date().toISOString().slice(0, 10)}`
    )

    // The payer hears nothing about their own ads (4 activated, 5 queued).
    expect(notificationsFor(tables, 9)).toHaveLength(0)
  })

  it('stays silent when the activation does not raise the top total or displace anyone', async () => {
    const tables = makeShiftTables()
    // A $2 top-up that leaves ad 1's $6.66 on top: no rank worsens, no
    // price move — nobody is nudged.
    tables.leaderboard_sponsor_bids[1] = makeRow({ ad_id: 4, amount_cents: 200 })
    const supabase = fakeDb(tables)

    await expect(
      activateSponsorBidFromOrder(
        supabase,
        paidOrder({ createdAt: new Date(), netAmount: 200 })
      )
    ).resolves.toBe('activated')
    expect(tables.notifications).toHaveLength(0)
  })

  it('a notification outage never fails the payment path', async () => {
    const tables = makeShiftTables()
    delete tables.notifications // every notifications read/write now throws
    const supabase = fakeDb(tables)

    await expect(
      activateSponsorBidFromOrder(supabase, paidOrder({ createdAt: new Date() }))
    ).resolves.toBe('activated')
    expect(tables.leaderboard_sponsor_bids[1].status).toBe('PAID')
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('sweepFinishedLeaderboardSponsorAds', () => {
  let errorSpy: MockInstance
  let logSpy: MockInstance

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    logSpy.mockRestore()
  })

  const now = new Date('2026-08-27T12:00:00Z')
  const paidAgoIso = (ms: number) => new Date(now.getTime() - ms).toISOString()

  it('archives a finished run with a guarded update, best-effort audit and an owner notification', async () => {
    const lastPaidAt = paidAgoIso(
      LEADERBOARD_SPONSOR_WINDOW_MS + LEADERBOARD_SPONSOR_GRACE_MS + 60_000
    )
    const tables: Record<string, LedgerRow[]> = {
      billboard_ads: [makeLeaderboardAd(3, 42)],
      leaderboard_sponsor_bids: [
        { id: 71, ad_id: 3, status: 'PAID', paid_at: lastPaidAt }
      ],
      notifications: [],
      admin_activity_log: []
    }

    await expect(sweepFinishedLeaderboardSponsorAds(fakeDb(tables), now)).resolves.toEqual({
      archived: 1,
      runComplete: 0
    })

    expect(tables.billboard_ads[0].status).toBe('ARCHIVED')
    expect(tables.admin_activity_log).toHaveLength(1)
    expect(tables.admin_activity_log[0].action).toBe('billboard_auto_archive')
    expect(tables.admin_activity_log[0].admin_user_id).toBe(42)
    expect(tables.admin_activity_log[0].reason).toBe('Automatic: leaderboard run complete')

    const notices = notificationsFor(tables, 42)
    expect(notices).toHaveLength(1)
    expect(notices[0].title).toBe('SPONSOR RUN ARCHIVED')
    expect(notices[0].dedupe_key).toBe(`lb_autoarchive_3_${lastPaidAt}`)
  })

  it('notifies (without archiving) a run inside the grace window, idempotently across re-runs', async () => {
    const lastPaidAt = paidAgoIso(LEADERBOARD_SPONSOR_WINDOW_MS + 3_600_000)
    const tables: Record<string, LedgerRow[]> = {
      billboard_ads: [makeLeaderboardAd(3, 42)],
      leaderboard_sponsor_bids: [
        { id: 71, ad_id: 3, status: 'PAID', paid_at: lastPaidAt },
        // An older payment of the same run — the classifier must key on
        // the LATEST paid_at, not the first.
        { id: 70, ad_id: 3, status: 'PAID', paid_at: paidAgoIso(LEADERBOARD_SPONSOR_WINDOW_MS + 7_200_000) }
      ],
      notifications: [],
      admin_activity_log: []
    }
    const supabase = fakeDb(tables)

    await expect(sweepFinishedLeaderboardSponsorAds(supabase, now)).resolves.toEqual({
      archived: 0,
      runComplete: 1
    })
    expect(tables.billboard_ads[0].status).toBe('APPROVED')

    // A second pass counts it again but the dedupe key swallows the notice.
    await expect(sweepFinishedLeaderboardSponsorAds(supabase, now)).resolves.toEqual({
      archived: 0,
      runComplete: 1
    })
    const notices = notificationsFor(tables, 42)
    expect(notices).toHaveLength(1)
    expect(notices[0].title).toBe('SPONSOR RUN COMPLETE')
    expect(notices[0].dedupe_key).toBe(`lb_runcomplete_3_${lastPaidAt}`)
  })

  it('leaves live runs and never-paid creatives alone — bidding stays open forever', async () => {
    const tables: Record<string, LedgerRow[]> = {
      billboard_ads: [makeLeaderboardAd(1, 100), makeLeaderboardAd(2, 200)],
      leaderboard_sponsor_bids: [
        { id: 71, ad_id: 1, status: 'PAID', paid_at: paidAgoIso(3_600_000) }
        // ad 2 never had a paid bid.
      ],
      notifications: [],
      admin_activity_log: []
    }

    await expect(sweepFinishedLeaderboardSponsorAds(fakeDb(tables), now)).resolves.toEqual({
      archived: 0,
      runComplete: 0
    })
    expect(tables.billboard_ads.map((ad) => ad.status)).toEqual(['APPROVED', 'APPROVED'])
    expect(tables.notifications).toHaveLength(0)
    expect(tables.admin_activity_log).toHaveLength(0)
  })

  it('archives an ownerless finished ad without an audit row or notification', async () => {
    const tables: Record<string, LedgerRow[]> = {
      billboard_ads: [makeLeaderboardAd(8, null)],
      leaderboard_sponsor_bids: [
        {
          id: 71,
          ad_id: 8,
          status: 'PAID',
          paid_at: paidAgoIso(LEADERBOARD_SPONSOR_WINDOW_MS + LEADERBOARD_SPONSOR_GRACE_MS + 1)
        }
      ],
      notifications: [],
      admin_activity_log: []
    }

    await expect(sweepFinishedLeaderboardSponsorAds(fakeDb(tables), now)).resolves.toEqual({
      archived: 1,
      runComplete: 0
    })
    expect(tables.billboard_ads[0].status).toBe('ARCHIVED')
    expect(tables.admin_activity_log).toHaveLength(0)
    expect(tables.notifications).toHaveLength(0)
    expect(logSpy).toHaveBeenCalled()
  })

  it('never throws, even when the database is entirely unreachable', async () => {
    await expect(sweepFinishedLeaderboardSponsorAds(fakeDb({}), now)).resolves.toEqual({
      archived: 0,
      runComplete: 0
    })
    expect(errorSpy).toHaveBeenCalled()
  })
})
