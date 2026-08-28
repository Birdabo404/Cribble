import { describe, expect, it } from 'vitest'
import {
  BILLBOARD_POLAR_FEE_FIXED_CENTS,
  BILLBOARD_POLAR_FEE_RATE,
  BILLBOARD_PRICE_CENTS,
  billboardSlotGrossCents,
  RAIL_SLOT_PRICE_CENTS,
  RAIL_SLOTS
} from './billboard'

// Coverage for the slot checkout gross-up (migration 061): the sticker
// prices stay on every advertised surface, and billboardSlotGrossCents
// is the one function deciding what Polar actually charges — so its
// exact outputs ARE the price list, pinned here. The occupancy/window
// side lives in billboardSlotServer.test.ts, the route contract in the
// checkout route test.

describe('billboardSlotGrossCents', () => {
  it('charges the flipper sticker of $200 as $209 gross', () => {
    // (20000 + 40) / 0.96 = 20875c, rounded UP to whole dollars.
    expect(billboardSlotGrossCents(BILLBOARD_PRICE_CENTS)).toBe(20900)
  })

  it('grosses the rail ladder to $521 / $417 / $312 / $208', () => {
    expect(billboardSlotGrossCents(49900)).toBe(52100) // L1/R1
    expect(billboardSlotGrossCents(39900)).toBe(41700) // L2/R2
    expect(billboardSlotGrossCents(29900)).toBe(31200) // L3/R3
    expect(billboardSlotGrossCents(19900)).toBe(20800) // L4/R4
  })

  it('always rounds UP to whole dollars — buyers never see odd cents', () => {
    for (const listCents of [BILLBOARD_PRICE_CENTS, ...RAIL_SLOTS.map((s) => RAIL_SLOT_PRICE_CENTS[s])]) {
      expect(billboardSlotGrossCents(listCents) % 100).toBe(0)
    }
  })

  it("nets at least the sticker after Polar's cut, and one dollar less would not", () => {
    // The whole point of the gross-up: gross - (4% + 40c) >= sticker,
    // and the rounding is MINIMAL at dollar granularity — a dollar
    // less would underpay Cribble.
    const netOf = (grossCents: number) =>
      grossCents * (1 - BILLBOARD_POLAR_FEE_RATE) - BILLBOARD_POLAR_FEE_FIXED_CENTS
    for (const listCents of [BILLBOARD_PRICE_CENTS, ...RAIL_SLOTS.map((s) => RAIL_SLOT_PRICE_CENTS[s])]) {
      const grossCents = billboardSlotGrossCents(listCents)
      expect(netOf(grossCents)).toBeGreaterThanOrEqual(listCents)
      expect(netOf(grossCents - 100)).toBeLessThan(listCents)
    }
  })
})
