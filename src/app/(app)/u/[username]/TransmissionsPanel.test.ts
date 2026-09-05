import { describe, expect, it } from 'vitest'
import { RAIL_SLOT_PRICE_CENTS, RAIL_SLOTS, type RailItem } from '@/lib/billboard'
import { panelPhase, rowTitle, slotRows, type TransmissionsPhase } from './TransmissionsPanel'

// The row list is what the panel renders top to bottom, so the "every
// slot, in order, sold or open" rule is pinned here rather than read
// off the JSX. The body's three states (skeleton / FEED OFFLINE / rows)
// all switch on one phase, so its precedence is pinned here too.

const sold = (slot: RailItem['slot'], id = 1): RailItem => ({
  id,
  slot,
  companyName: `Co ${slot}`,
  linkHost: `${slot.toLowerCase()}.example`,
  text: `line ${slot}`,
  logoUrl: null,
  accentColor: null
})

describe('slotRows', () => {
  it('yields one row per RAIL_SLOTS entry, in RAIL_SLOTS order', () => {
    const rows = slotRows([])
    expect(rows.map((r) => r.slot)).toEqual([...RAIL_SLOTS])
    expect(rows).toHaveLength(8)
  })

  it('every slot is open on an empty feed', () => {
    for (const row of slotRows([])) expect(row.item).toBeNull()
  })

  it('places a sold item on its own slot and leaves the rest open', () => {
    const rows = slotRows([sold('R2', 7)])
    const r2 = rows.find((r) => r.slot === 'R2')
    expect(r2?.item?.id).toBe(7)
    expect(rows.filter((r) => r.item !== null)).toHaveLength(1)
  })

  it('keeps RAIL_SLOTS order regardless of feed order', () => {
    const rows = slotRows([sold('R4', 1), sold('L1', 2), sold('L3', 3)])
    expect(rows.map((r) => r.slot)).toEqual([...RAIL_SLOTS])
    expect(rows[0].item?.id).toBe(2)
    expect(rows[2].item?.id).toBe(3)
    expect(rows[7].item?.id).toBe(1)
  })

  it('prices each row from the slot ladder in whole dollars', () => {
    for (const row of slotRows([])) {
      expect(row.priceUsd).toBe(RAIL_SLOT_PRICE_CENTS[row.slot] / 100)
    }
    expect(slotRows([])[0].priceUsd).toBe(499)
    expect(slotRows([])[7].priceUsd).toBe(199)
  })
})

describe('panelPhase', () => {
  it.each<[string, boolean, boolean, TransmissionsPhase]>([
    ['first fetch in flight', false, false, 'loading'],
    ['first fetch failed, retry pending', false, true, 'offline'],
    ['feed landed', true, false, 'ready'],
    ['a failed refetch keeps the landed feed', true, true, 'ready']
  ])('%s', (_, loaded, failed, expected) => {
    expect(panelPhase({ loaded, failed })).toBe(expected)
  })
})

describe('rowTitle', () => {
  it('prefers the company name', () => {
    expect(rowTitle(sold('L1'))).toBe('Co L1')
  })

  it('falls back to the link host when the company name is missing', () => {
    expect(rowTitle({ ...sold('L1'), companyName: null })).toBe('l1.example')
  })

  it('is null when neither is available', () => {
    expect(rowTitle({ ...sold('L1'), companyName: null, linkHost: '' })).toBeNull()
  })
})
