import { describe, expect, it } from 'vitest'
import {
  CURSOR_HOUSE_RATE_USD_PER_MTOK,
  cursorBurnDayFloor,
  cursorEstimateUsd,
  sumCursorTokensFromDay
} from './cursorBurn'

describe('CURSOR_HOUSE_RATE_USD_PER_MTOK', () => {
  it('is pinned at $1.00/MTok — cursorEstimateUsd IS this rate as a decimal shift, so a season re-price must change both together', () => {
    expect(CURSOR_HOUSE_RATE_USD_PER_MTOK).toBe(1)
  })
})

describe('cursorEstimateUsd', () => {
  it('shifts tokens six decimal places into exact dollars', () => {
    expect(cursorEstimateUsd('0')).toBe('0')
    expect(cursorEstimateUsd('1')).toBe('0.000001')
    expect(cursorEstimateUsd('500000')).toBe('0.5')
    expect(cursorEstimateUsd('1000000')).toBe('1')
    expect(cursorEstimateUsd('1234567')).toBe('1.234567')
  })

  it('normalizes trailing zeros the exact-decimal way', () => {
    expect(cursorEstimateUsd('2500000')).toBe('2.5')
    expect(cursorEstimateUsd('310000000')).toBe('310')
  })

  it('stays exact past 2^53 — no float round-trip', () => {
    expect(cursorEstimateUsd('92233720368547758081234567')).toBe(
      '92233720368547758081.234567'
    )
  })

  it('accepts safe-integer numbers and rejects garbage as 0', () => {
    expect(cursorEstimateUsd(1500000)).toBe('1.5')
    expect(cursorEstimateUsd(null)).toBe('0')
    expect(cursorEstimateUsd(undefined)).toBe('0')
    expect(cursorEstimateUsd(-5)).toBe('0')
    expect(cursorEstimateUsd('not-tokens')).toBe('0')
  })
})

describe('cursorBurnDayFloor', () => {
  const SEASON_START = '2026-08-01'

  it('floors at the verification day when it is the latest', () => {
    expect(
      cursorBurnDayFloor(
        '2026-08-20T15:00:00.000Z',
        '2026-08-05T09:00:00.000Z',
        SEASON_START
      )
    ).toBe('2026-08-20')
  })

  it('floors at the affiliation activation day when it is the latest', () => {
    expect(
      cursorBurnDayFloor(
        '2026-08-03T00:00:00.000Z',
        '2026-08-25T12:00:00.000Z',
        SEASON_START
      )
    ).toBe('2026-08-25')
  })

  it('floors at the season start when both timestamps predate it', () => {
    expect(
      cursorBurnDayFloor(
        '2026-07-10T00:00:00.000Z',
        '2026-07-20T00:00:00.000Z',
        SEASON_START
      )
    ).toBe('2026-08-01')
  })

  it('drops the season bound when no calendar exists (all-time window)', () => {
    expect(
      cursorBurnDayFloor('2026-07-10T00:00:00.000Z', '2026-07-20T00:00:00.000Z', null)
    ).toBe('2026-07-20')
  })

  it('converts timestamps to UTC calendar days — a 23:59Z verification stays on its UTC day', () => {
    expect(
      cursorBurnDayFloor(
        '2026-08-04T23:59:59.000Z',
        '2026-08-01T00:00:00.000Z',
        SEASON_START
      )
    ).toBe('2026-08-04')
  })
})

describe('sumCursorTokensFromDay', () => {
  const days = [
    { day: '2026-08-01', tokens: 100 },
    { day: '2026-08-02', tokens: '200' },
    { day: '2026-08-03', tokens: 300 }
  ]

  it('counts days on or after the floor and skips the history before it', () => {
    expect(sumCursorTokensFromDay(days, '2026-08-02')).toBe('500')
    expect(sumCursorTokensFromDay(days, '2026-08-01')).toBe('600')
    expect(sumCursorTokensFromDay(days, '2026-08-04')).toBe('0')
  })

  it('answers 0 for an empty series', () => {
    expect(sumCursorTokensFromDay([], '2026-08-01')).toBe('0')
  })

  it('adds in exact-integer strings — big days never lose precision', () => {
    expect(
      sumCursorTokensFromDay(
        [
          { day: '2026-08-01', tokens: '9007199254740993' },
          { day: '2026-08-02', tokens: '9007199254740993' }
        ],
        '2026-08-01'
      )
    ).toBe('18014398509481986')
  })

  it('treats null tokens as 0', () => {
    expect(
      sumCursorTokensFromDay([{ day: '2026-08-01', tokens: null }], '2026-08-01')
    ).toBe('0')
  })
})
