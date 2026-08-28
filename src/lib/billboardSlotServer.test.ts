import type { SupabaseClient } from '@supabase/supabase-js'
import type { Order } from '@polar-sh/sdk/models/components/order'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { BILLBOARD_DURATION_DAYS, BILLBOARD_MAX_LIVE } from './billboard'

// The slot payment-integrity core against a STATEFUL multi-table fake:
// activation and revocation run in sequence against the same mutating
// rows, so what's under test is the event-ORDERING and window-stamping
// guarantees — a refund delivered before order.paid leaves the row
// REFUNDED and the late activation refused with no window stamped; a
// refund after activation takes back exactly the window ITS order
// granted (nulled while queued, cut to now while running, untouched
// once finished); and the queue-behind derivation never refuses paid
// money for a momentarily-full board.

const { getPolarClientMock } = vi.hoisted(() => ({
  getPolarClientMock: vi.fn()
}))

vi.mock('@/lib/polar', () => ({
  getPolarClient: getPolarClientMock,
  resolveBillboardSlotProductId: () => 'prod_bb_slot'
}))

import {
  activateBillboardSlotFromOrder,
  revokeBillboardSlotFromOrder,
  slotWindowStartAt,
  syncBillboardSlotCheckoutFromPolar
} from './billboardSlotServer'

const DAY_MS = 86_400_000
const WINDOW_MS = BILLBOARD_DURATION_DAYS * DAY_MS

type Row = Record<string, unknown>
type Filter =
  | ['eq' | 'neq' | 'gt' | 'gte', string, unknown]
  | ['in', string, unknown[]]
  | ['is-null' | 'not-null', string]

function rowMatches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const [op, column] = filter
    const current = row[column]
    switch (op) {
      case 'eq':
        return current === filter[2]
      case 'neq':
        return current !== filter[2]
      case 'in':
        return filter[2].includes(current)
      // 'gt'/'gte' — ISO timestamp comparison, lexicographic like the
      // database's.
      case 'gt':
        return (
          typeof current === 'string' && typeof filter[2] === 'string' && current > filter[2]
        )
      case 'gte':
        return (
          typeof current === 'string' && typeof filter[2] === 'string' && current >= filter[2]
        )
      case 'is-null':
        return current === null || current === undefined
      case 'not-null':
        return current !== null && current !== undefined
      default: {
        const exhaustive: never = op
        return exhaustive
      }
    }
  })
}

/** A mutable multi-table Supabase fake honoring exactly the query
 *  chains billboardSlotServer issues: filtered select (thenable or
 *  .maybeSingle(), with .not(col,'is',null) / .gte / .neq for the
 *  occupancy read), filtered update (thenable or .select(), with .in /
 *  .is / .gt for the guards) and plain insert (notifications). Updates
 *  MUTATE the rows so sequenced calls observe each other — the point
 *  of this suite. Tables not in the map throw, like the sponsor fake;
 *  beforeFirstUpdate stages a concurrent writer winning the guarded
 *  compare-and-set. */
function fakeDb(tables: Record<string, Row[]>, beforeFirstUpdate?: () => void): SupabaseClient {
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
            neq(column: string, value: unknown) {
              filters.push(['neq', column, value])
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
            gte(column: string, value: unknown) {
              filters.push(['gte', column, value])
              return builder
            },
            not(column: string, op: string, value: unknown) {
              if (op !== 'is' || value !== null) throw new Error('Unexpected .not() shape')
              filters.push(['not-null', column])
              return builder
            },
            async maybeSingle() {
              return { data: rows.find((row) => rowMatches(row, filters)) ?? null, error: null }
            },
            then(
              onFulfilled: (value: { data: Row[]; error: null }) => unknown,
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
        update(values: Row) {
          const filters: Filter[] = []
          const apply = () => {
            beforeFirstUpdate?.()
            beforeFirstUpdate = undefined
            const hit = rows.filter((row) => rowMatches(row, filters))
            for (const row of hit) Object.assign(row, values)
            return { data: hit.map((row) => ({ ...row })), error: null }
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
            is(column: string, value: unknown) {
              if (value !== null) throw new Error('Unexpected .is() shape')
              filters.push(['is-null', column])
              return builder
            },
            gt(column: string, value: unknown) {
              filters.push(['gt', column, value])
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
        insert(values: Row | Row[]) {
          return {
            then(
              onFulfilled: (value: { error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown
            ) {
              rows.push(...(Array.isArray(values) ? [...values] : [values]))
              return Promise.resolve({ error: null }).then(onFulfilled, onRejected)
            }
          }
        }
      }
    }
  }
  return client as unknown as SupabaseClient
}

/** A PENDING flipper ledger row fresh from checkout creation — the
 *  gross $209 charge for the $200 sticker. */
function makeSlotRow(overrides: Row = {}): Row {
  return {
    id: 61,
    ad_id: 4,
    user_id: 9,
    placement: 'flipper',
    rail_slot: null,
    status: 'PENDING',
    amount_cents: 20900,
    list_price_cents: 20000,
    polar_checkout_id: 'chk_bb_1',
    polar_order_id: null,
    paid_at: null,
    window_starts_at: null,
    window_ends_at: null,
    refunded_at: null,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides
  }
}

/** The buyer's APPROVED ad with no window yet — the state the checkout
 *  route requires before a ledger row can exist. */
function makeAd(overrides: Row = {}): Row {
  return {
    id: 4,
    owner_user_id: 9,
    placement: 'flipper',
    rail_slot: null,
    status: 'APPROVED',
    paid_at: null,
    starts_at: null,
    ends_at: null,
    ...overrides
  }
}

/** Someone else's live/queued window occupying the board — only the
 *  columns the occupancy read filters and returns. */
function occupant(id: number, startsAtMs: number, endsAtMs: number, overrides: Row = {}): Row {
  return {
    id,
    placement: 'flipper',
    rail_slot: null,
    status: 'APPROVED',
    paid_at: new Date(startsAtMs).toISOString(),
    starts_at: new Date(startsAtMs).toISOString(),
    ends_at: new Date(endsAtMs).toISOString(),
    ...overrides
  }
}

/** The paid Polar order this row's checkout produced — every field the
 *  verification chain inspects matches makeSlotRow(). */
function paidOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    id: 'order_bb_1',
    checkoutId: 'chk_bb_1',
    productId: 'prod_bb_slot',
    netAmount: 20900,
    currency: 'usd',
    createdAt: new Date('2026-08-25T10:00:00.000Z'),
    paid: true,
    status: 'paid',
    metadata: { userId: 9, kind: 'billboard_slot' },
    customer: { externalId: '9' },
    ...overrides
  } as unknown as Order
}

function refundedOrder(overrides: Record<string, unknown> = {}): Order {
  return paidOrder({ status: 'refunded', ...overrides })
}

/* ------------------------------------------------------------------ *
 * Queue-aware window start — the shared derivation both the checkout
 * disclosure and activation stamp from, against a pinned clock.
 * ------------------------------------------------------------------ */

describe('slotWindowStartAt', () => {
  const now = new Date('2026-08-28T12:00:00.000Z')
  const nowMs = now.getTime()
  const atDay = (days: number) => nowMs + days * DAY_MS

  function occupancyDb(ads: Row[]): SupabaseClient {
    return fakeDb({ billboard_ads: ads })
  }

  it('starts NOW on an empty board', async () => {
    await expect(slotWindowStartAt(occupancyDb([]), 'flipper', null, now)).resolves.toEqual(now)
  })

  it('starts NOW while the flipper has a free slot', async () => {
    const ads = Array.from({ length: BILLBOARD_MAX_LIVE - 1 }, (_, i) =>
      occupant(100 + i, atDay(-1), atDay(6))
    )
    await expect(slotWindowStartAt(occupancyDb(ads), 'flipper', null, now)).resolves.toEqual(now)
  })

  it('queues just past the earliest window end when all flipper slots are live — windows are inclusive, so +1ms', async () => {
    // 8 live with staggered ends: capacity first opens 1ms after the
    // earliest ends_at (an ad still occupies its ends_at instant).
    const ads = Array.from({ length: BILLBOARD_MAX_LIVE }, (_, i) =>
      occupant(100 + i, atDay(-1), atDay(1) + i * DAY_MS)
    )
    await expect(
      slotWindowStartAt(occupancyDb(ads), 'flipper', null, now)
    ).resolves.toEqual(new Date(atDay(1) + 1))
  })

  it('counts queued future windows exactly like live ones', async () => {
    // 8 live ending day 2, and 8 more already queued behind them: the
    // new window queues behind the QUEUE, not just the live set.
    const queuedStartMs = atDay(2) + 1
    const ads = [
      ...Array.from({ length: BILLBOARD_MAX_LIVE }, (_, i) =>
        occupant(100 + i, atDay(-1), atDay(2))
      ),
      ...Array.from({ length: BILLBOARD_MAX_LIVE }, (_, i) =>
        occupant(200 + i, queuedStartMs, queuedStartMs + WINDOW_MS)
      )
    ]
    await expect(
      slotWindowStartAt(occupancyDb(ads), 'flipper', null, now)
    ).resolves.toEqual(new Date(queuedStartMs + WINDOW_MS + 1))
  })

  it('rejects a start whose WINDOW would overrun the cap later, not just its first instant', async () => {
    // 5 live now, but 8 queued from day 3: starting now would put 9 on
    // the board across days 3-7 — the whole 7-day window must fit
    // under the cap, so the start queues past the day-3 mass.
    const ads = [
      ...Array.from({ length: 5 }, (_, i) => occupant(100 + i, atDay(-1), atDay(2))),
      ...Array.from({ length: BILLBOARD_MAX_LIVE }, (_, i) =>
        occupant(200 + i, atDay(3), atDay(10))
      )
    ]
    await expect(
      slotWindowStartAt(occupancyDb(ads), 'flipper', null, now)
    ).resolves.toEqual(new Date(atDay(10) + 1))
  })

  it('ignores the ad being activated itself via excludeAdId', async () => {
    const ads = [occupant(4, atDay(-1), atDay(6), { rail_slot: 'L2', placement: 'rail' })]
    await expect(
      slotWindowStartAt(occupancyDb(ads), 'rail', 'L2', now, 4)
    ).resolves.toEqual(now)
  })

  it('rails: starts NOW while the slot is open, even when other slots are taken', async () => {
    const ads = [occupant(100, atDay(-1), atDay(6), { placement: 'rail', rail_slot: 'L1' })]
    await expect(slotWindowStartAt(occupancyDb(ads), 'rail', 'L2', now)).resolves.toEqual(now)
  })

  it("rails: queues just past the slot's LAST current-or-future window", async () => {
    const queuedEndMs = atDay(13) + 1
    const ads = [
      occupant(100, atDay(-1), atDay(6), { placement: 'rail', rail_slot: 'L2' }),
      occupant(101, atDay(6) + 1, queuedEndMs, { placement: 'rail', rail_slot: 'L2' })
    ]
    await expect(
      slotWindowStartAt(occupancyDb(ads), 'rail', 'L2', now)
    ).resolves.toEqual(new Date(queuedEndMs + 1))
  })

  it('refuses a rail derivation without a slot — the choice is binding before pricing', async () => {
    await expect(slotWindowStartAt(occupancyDb([]), 'rail', null, now)).rejects.toThrow(
      /requires a slot/
    )
  })
})

/* ------------------------------------------------------------------ *
 * Activation — the verification gate plus the window stamp.
 * ------------------------------------------------------------------ */

describe('activateBillboardSlotFromOrder', () => {
  let warnSpy: MockInstance
  let errorSpy: MockInstance

  beforeEach(() => {
    getPolarClientMock.mockReset()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  function makeTables(overrides: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
    return {
      billboard_slot_orders: [makeSlotRow()],
      billboard_ads: [makeAd()],
      notifications: [],
      ...overrides
    }
  }

  it('activates on an open board: ledger PAID with the granted window, ad stamped LIVE now, buyer notified', async () => {
    const tables = makeTables()
    const before = Date.now()

    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder())
    ).resolves.toBe('activated')

    const row = tables.billboard_slot_orders[0]
    expect(row.status).toBe('PAID')
    expect(row.polar_order_id).toBe('order_bb_1')
    // paid_at is the ORDER's creation moment, not delivery time.
    expect(row.paid_at).toBe('2026-08-25T10:00:00.000Z')

    const ad = tables.billboard_ads[0]
    expect(ad.starts_at).toBe(row.window_starts_at)
    expect(ad.ends_at).toBe(row.window_ends_at)
    expect(Date.parse(ad.starts_at as string)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(ad.starts_at as string)).toBeLessThanOrEqual(Date.now())
    expect(Date.parse(ad.ends_at as string) - Date.parse(ad.starts_at as string)).toBe(WINDOW_MS)
    // The renewal rule: paid_at was null, so it stamps from the order.
    expect(ad.paid_at).toBe('2026-08-25T10:00:00.000Z')
    expect(ad.rail_slot).toBeNull()

    expect(tables.notifications).toHaveLength(1)
    expect(tables.notifications[0].title).toBe('SPONSORSHIP AD LIVE')
    expect(tables.notifications[0].dedupe_key).toBe(`billboard_4_live_${ad.starts_at}`)
  })

  it('queues behind a full flipper instead of refusing: window stamped at the opening, QUEUED notification with the date', async () => {
    const nowMs = Date.now()
    const earliestEndMs = nowMs + 2 * DAY_MS
    const tables = makeTables({
      billboard_ads: [
        makeAd(),
        ...Array.from({ length: BILLBOARD_MAX_LIVE }, (_, i) =>
          occupant(100 + i, nowMs - DAY_MS, earliestEndMs + i * DAY_MS)
        )
      ]
    })

    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder())
    ).resolves.toBe('activated')

    const expectedStartIso = new Date(earliestEndMs + 1).toISOString()
    const row = tables.billboard_slot_orders[0]
    expect(row.status).toBe('PAID')
    expect(row.window_starts_at).toBe(expectedStartIso)

    const ad = tables.billboard_ads[0]
    expect(ad.starts_at).toBe(expectedStartIso)
    expect(ad.ends_at).toBe(new Date(earliestEndMs + 1 + WINDOW_MS).toISOString())

    expect(tables.notifications).toHaveLength(1)
    expect(tables.notifications[0].title).toBe('SPONSORSHIP AD QUEUED')
    expect(tables.notifications[0].dedupe_key).toBe(`billboard_4_queued_${expectedStartIso}`)
  })

  it('stamps the LEDGER-bound rail slot onto the ad, queued behind that slot only', async () => {
    const nowMs = Date.now()
    const occupantEndMs = nowMs + 3 * DAY_MS
    const tables = makeTables({
      billboard_slot_orders: [
        makeSlotRow({ placement: 'rail', rail_slot: 'L2', amount_cents: 41700, list_price_cents: 39900 })
      ],
      billboard_ads: [
        makeAd({ placement: 'rail' }),
        occupant(100, nowMs - DAY_MS, occupantEndMs, { placement: 'rail', rail_slot: 'L2' }),
        // A different slot's occupant must not queue this purchase.
        occupant(101, nowMs - DAY_MS, nowMs + 30 * DAY_MS, { placement: 'rail', rail_slot: 'L1' })
      ]
    })

    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder({ netAmount: 41700 }))
    ).resolves.toBe('activated')

    const ad = tables.billboard_ads[0]
    expect(ad.rail_slot).toBe('L2')
    expect(ad.starts_at).toBe(new Date(occupantEndMs + 1).toISOString())
  })

  it('keeps an existing paid_at on the ad — a renewal never rewrites payment history', async () => {
    const tables = makeTables({
      billboard_ads: [
        makeAd({
          paid_at: '2026-07-01T00:00:00.000Z',
          starts_at: '2026-07-01T00:00:00.000Z',
          ends_at: '2026-07-08T00:00:00.000Z'
        })
      ]
    })

    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder())
    ).resolves.toBe('activated')
    expect(tables.billboard_ads[0].paid_at).toBe('2026-07-01T00:00:00.000Z')
    expect(Date.parse(tables.billboard_ads[0].starts_at as string)).toBeGreaterThan(
      Date.parse('2026-07-08T00:00:00.000Z')
    )
  })

  it('refuses a charge that only covers the STICKER — the ledger holds the gross', async () => {
    const tables = makeTables()

    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder({ netAmount: 20000 }))
    ).resolves.toBe('refused')
    expect(tables.billboard_slot_orders[0].status).toBe('PENDING')
    expect(tables.billboard_ads[0].starts_at).toBeNull()
  })

  it('refuses an order not denominated in USD even when the minor units match', async () => {
    const tables = makeTables()
    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder({ currency: 'jpy' }))
    ).resolves.toBe('refused')
    expect(tables.billboard_slot_orders[0].status).toBe('PENDING')
  })

  it('refuses an order off the configured slot product, whatever its metadata claims', async () => {
    const tables = makeTables()
    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder({ productId: 'prod_other' }))
    ).resolves.toBe('refused')
    expect(tables.billboard_slot_orders[0].status).toBe('PENDING')
  })

  it('refuses when the payer does not match the ledger row buyer, or the witness is missing', async () => {
    const tables = makeTables()
    await expect(
      activateBillboardSlotFromOrder(
        fakeDb(tables),
        paidOrder({ metadata: { userId: 13, kind: 'billboard_slot' } })
      )
    ).resolves.toBe('refused')
    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder({ metadata: {} }))
    ).resolves.toBe('refused')
    expect(tables.billboard_slot_orders[0].status).toBe('PENDING')
  })

  it('refuses a paid checkout this server never created, and one with no checkout id at all', async () => {
    const tables = makeTables({ billboard_slot_orders: [] })
    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder())
    ).resolves.toBe('refused')
    await expect(
      activateBillboardSlotFromOrder(fakeDb(makeTables()), paidOrder({ checkoutId: null }))
    ).resolves.toBe('refused')
  })

  it('ignores orders of the other products entirely', async () => {
    // No slot markers: neither the kind metadata nor the product id.
    const tables = makeTables()
    await expect(
      activateBillboardSlotFromOrder(
        fakeDb(tables),
        paidOrder({ productId: 'prod_lb_bid', metadata: { userId: 9, kind: 'leaderboard_bid' } })
      )
    ).resolves.toBe('not_a_slot_order')
    expect(tables.billboard_slot_orders[0].status).toBe('PENDING')
  })

  it('collapses a duplicate delivery to already_active without a second window stamp', async () => {
    const tables = makeTables()
    const supabase = fakeDb(tables)

    await expect(activateBillboardSlotFromOrder(supabase, paidOrder())).resolves.toBe('activated')
    const stampedStartsAt = tables.billboard_ads[0].starts_at

    await expect(
      activateBillboardSlotFromOrder(supabase, paidOrder())
    ).resolves.toBe('already_active')
    expect(tables.billboard_ads[0].starts_at).toBe(stampedStartsAt)
    expect(tables.notifications).toHaveLength(1)
  })

  it('reports refunded when a refund wins the guarded PENDING -> PAID race, and stamps nothing', async () => {
    const tables = makeTables()
    const supabase = fakeDb(tables, () => {
      tables.billboard_slot_orders[0].status = 'REFUNDED'
      tables.billboard_slot_orders[0].refunded_at = new Date().toISOString()
    })

    await expect(activateBillboardSlotFromOrder(supabase, paidOrder())).resolves.toBe('refunded')
    expect(tables.billboard_ads[0].starts_at).toBeNull()
    expect(tables.notifications).toHaveLength(0)
  })

  it('keeps the PAID ledger truth but stamps no window when the ad was archived after checkout', async () => {
    const tables = makeTables({ billboard_ads: [makeAd({ status: 'ARCHIVED' })] })

    await expect(
      activateBillboardSlotFromOrder(fakeDb(tables), paidOrder())
    ).resolves.toBe('activated')
    expect(tables.billboard_slot_orders[0].status).toBe('PAID')
    expect(tables.billboard_ads[0].starts_at).toBeNull()
    expect(tables.notifications).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ *
 * Revocation — refund ordering plus the take-back of exactly the
 * window the refunded order granted.
 * ------------------------------------------------------------------ */

describe('revokeBillboardSlotFromOrder', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    getPolarClientMock.mockReset()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('a refund delivered BEFORE order.paid revokes the still-PENDING row, and the late activation is refused with no window', async () => {
    const tables = {
      billboard_slot_orders: [makeSlotRow()],
      billboard_ads: [makeAd()],
      notifications: []
    }
    const supabase = fakeDb(tables)

    await revokeBillboardSlotFromOrder(supabase, refundedOrder())
    expect(tables.billboard_slot_orders[0].status).toBe('REFUNDED')

    await expect(activateBillboardSlotFromOrder(supabase, paidOrder())).resolves.toBe('refused')
    expect(tables.billboard_slot_orders[0].status).toBe('REFUNDED')
    expect(tables.billboard_ads[0].starts_at).toBeNull()
  })

  it('nulls a QUEUED window off the ad (rail slot freed with it) when the refund lands before go-live', async () => {
    const startsAtIso = new Date(Date.now() + 2 * DAY_MS).toISOString()
    const endsAtIso = new Date(Date.parse(startsAtIso) + WINDOW_MS).toISOString()
    const tables = {
      billboard_slot_orders: [
        makeSlotRow({
          placement: 'rail',
          rail_slot: 'L2',
          status: 'PAID',
          polar_order_id: 'order_bb_1',
          window_starts_at: startsAtIso,
          window_ends_at: endsAtIso
        })
      ],
      billboard_ads: [
        makeAd({
          placement: 'rail',
          rail_slot: 'L2',
          paid_at: '2026-08-25T10:00:00.000Z',
          starts_at: startsAtIso,
          ends_at: endsAtIso
        })
      ]
    }

    await revokeBillboardSlotFromOrder(fakeDb(tables), refundedOrder())

    expect(tables.billboard_slot_orders[0].status).toBe('REFUNDED')
    const ad = tables.billboard_ads[0]
    expect(ad.starts_at).toBeNull()
    expect(ad.ends_at).toBeNull()
    expect(ad.rail_slot).toBeNull()
  })

  it('cuts a RUNNING window to now — the ad drops off the board immediately', async () => {
    const startsAtIso = new Date(Date.now() - 2 * DAY_MS).toISOString()
    const endsAtIso = new Date(Date.parse(startsAtIso) + WINDOW_MS).toISOString()
    const tables = {
      billboard_slot_orders: [
        makeSlotRow({
          status: 'PAID',
          polar_order_id: 'order_bb_1',
          window_starts_at: startsAtIso,
          window_ends_at: endsAtIso
        })
      ],
      billboard_ads: [
        makeAd({ paid_at: '2026-08-25T10:00:00.000Z', starts_at: startsAtIso, ends_at: endsAtIso })
      ]
    }
    const before = Date.now()

    await revokeBillboardSlotFromOrder(fakeDb(tables), refundedOrder())

    const cutMs = Date.parse(tables.billboard_ads[0].ends_at as string)
    expect(cutMs).toBeGreaterThanOrEqual(before)
    expect(cutMs).toBeLessThanOrEqual(Date.now())
    expect(tables.billboard_ads[0].starts_at).toBe(startsAtIso)
  })

  it('leaves a FINISHED window alone — a late refund never extends or rewrites history', async () => {
    const startsAtIso = new Date(Date.now() - 20 * DAY_MS).toISOString()
    const endsAtIso = new Date(Date.parse(startsAtIso) + WINDOW_MS).toISOString()
    const tables = {
      billboard_slot_orders: [
        makeSlotRow({
          status: 'PAID',
          polar_order_id: 'order_bb_1',
          window_starts_at: startsAtIso,
          window_ends_at: endsAtIso
        })
      ],
      billboard_ads: [
        makeAd({ paid_at: '2026-08-25T10:00:00.000Z', starts_at: startsAtIso, ends_at: endsAtIso })
      ]
    }

    await revokeBillboardSlotFromOrder(fakeDb(tables), refundedOrder())

    expect(tables.billboard_slot_orders[0].status).toBe('REFUNDED')
    expect(tables.billboard_ads[0].ends_at).toBe(endsAtIso)
  })

  it("never touches a RENEWAL's window: the ad's current schedule is not the refunded order's", async () => {
    // The refunded order granted a long-finished window; the ad now
    // carries a newer window from a later order. The starts_at guard
    // must keep the refund off it.
    const oldStartsIso = new Date(Date.now() - 20 * DAY_MS).toISOString()
    const currentStartsIso = new Date(Date.now() - DAY_MS).toISOString()
    const currentEndsIso = new Date(Date.parse(currentStartsIso) + WINDOW_MS).toISOString()
    const tables = {
      billboard_slot_orders: [
        makeSlotRow({
          status: 'PAID',
          polar_order_id: 'order_bb_1',
          window_starts_at: oldStartsIso,
          window_ends_at: new Date(Date.parse(oldStartsIso) + WINDOW_MS).toISOString()
        })
      ],
      billboard_ads: [
        makeAd({
          paid_at: '2026-08-01T10:00:00.000Z',
          starts_at: currentStartsIso,
          ends_at: currentEndsIso
        })
      ]
    }

    await revokeBillboardSlotFromOrder(fakeDb(tables), refundedOrder())

    expect(tables.billboard_slot_orders[0].status).toBe('REFUNDED')
    expect(tables.billboard_ads[0].starts_at).toBe(currentStartsIso)
    expect(tables.billboard_ads[0].ends_at).toBe(currentEndsIso)
  })

  it('a refund order without a checkout id falls back to the stamped polar_order_id', async () => {
    const tables = {
      billboard_slot_orders: [makeSlotRow({ status: 'PAID', polar_order_id: 'order_bb_1' })],
      billboard_ads: [makeAd()]
    }

    await revokeBillboardSlotFromOrder(fakeDb(tables), refundedOrder({ checkoutId: null }))
    expect(tables.billboard_slot_orders[0].status).toBe('REFUNDED')
  })

  it("revocation is idempotent and never touches another checkout's row", async () => {
    const tables = {
      billboard_slot_orders: [
        makeSlotRow({ status: 'REFUNDED', refunded_at: '2026-08-25T09:00:00.000Z' }),
        makeSlotRow({ id: 62, polar_checkout_id: 'chk_bb_other' })
      ],
      billboard_ads: [makeAd()]
    }

    await revokeBillboardSlotFromOrder(fakeDb(tables), refundedOrder())
    expect(tables.billboard_slot_orders[0].refunded_at).toBe('2026-08-25T09:00:00.000Z')
    expect(tables.billboard_slot_orders[1].status).toBe('PENDING')
  })
})

/* ------------------------------------------------------------------ *
 * Exact-checkout pull sync — the post-Polar return leg.
 * ------------------------------------------------------------------ */

describe('syncBillboardSlotCheckoutFromPolar', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    getPolarClientMock.mockReset()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function makeTables(): Record<string, Row[]> {
    return {
      billboard_slot_orders: [makeSlotRow()],
      billboard_ads: [makeAd()],
      notifications: []
    }
  }

  function polarWithOrders(items: Order[]) {
    const list = vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { result: { items } }
      }
    }))
    getPolarClientMock.mockReturnValue({ orders: { list } })
    return list
  }

  it('queries by checkout id and activates even when Polar merged the buyer under a different customer external id', async () => {
    const tables = makeTables()
    const list = polarWithOrders([paidOrder({ customer: { externalId: 'someone-else' } })])

    await expect(
      syncBillboardSlotCheckoutFromPolar(fakeDb(tables), 9, 'chk_bb_1')
    ).resolves.toBe('activated')
    expect(list).toHaveBeenCalledWith({ checkoutId: 'chk_bb_1', limit: 10 })
    expect(tables.billboard_slot_orders[0].status).toBe('PAID')
    expect(tables.billboard_ads[0].starts_at).not.toBeNull()
  })

  it('VOIDs a completed checkout the integrity gate permanently refuses', async () => {
    const tables = makeTables()
    polarWithOrders([paidOrder({ netAmount: 0 })])

    await expect(
      syncBillboardSlotCheckoutFromPolar(fakeDb(tables), 9, 'chk_bb_1')
    ).resolves.toBe('refused')
    expect(tables.billboard_slot_orders[0].status).toBe('VOID')
    expect(tables.billboard_slot_orders[0].failure_reason).toBe('payment_verification_failed')
  })

  it("does not query Polar for another user's or a malformed checkout id", async () => {
    const tables = makeTables()

    await expect(
      syncBillboardSlotCheckoutFromPolar(fakeDb(tables), 7, 'chk_bb_1')
    ).resolves.toBe('not_found')
    await expect(
      syncBillboardSlotCheckoutFromPolar(fakeDb(tables), 9, '../bad')
    ).resolves.toBe('not_found')
    expect(getPolarClientMock).not.toHaveBeenCalled()
  })

  it('reports pending while Polar has not created a paid order yet', async () => {
    const tables = makeTables()
    polarWithOrders([])

    await expect(
      syncBillboardSlotCheckoutFromPolar(fakeDb(tables), 9, 'chk_bb_1')
    ).resolves.toBe('pending')
    expect(tables.billboard_slot_orders[0].status).toBe('PENDING')
  })

  it('revokes and reports an already-refunded paid order', async () => {
    const tables = makeTables()
    polarWithOrders([refundedOrder()])

    await expect(
      syncBillboardSlotCheckoutFromPolar(fakeDb(tables), 9, 'chk_bb_1')
    ).resolves.toBe('refunded')
    expect(tables.billboard_slot_orders[0].status).toBe('REFUNDED')
  })
})
