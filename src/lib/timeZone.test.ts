import { describe, expect, it } from 'vitest'
import {
  addCalendarDays,
  calendarDateInTimeZone,
  calendarDaysBetween,
  normalizeIanaTimeZone
} from './timeZone'

describe('IANA timezone helpers', () => {
  it('canonicalizes real zones and rejects regex-shaped inventions', () => {
    expect(normalizeIanaTimeZone('Asia/Manila')).toBe('Asia/Manila')
    expect(normalizeIanaTimeZone('America/New_York')).toBe('America/New_York')
    expect(normalizeIanaTimeZone('Mars/Olympus_Mons')).toBeNull()
    expect(normalizeIanaTimeZone('+08:00')).toBeNull()
  })

  it('derives calendar dates in the requested zone', () => {
    const instant = Date.parse('2026-08-22T18:30:00.000Z')
    expect(calendarDateInTimeZone(instant, 'UTC')).toBe('2026-08-22')
    expect(calendarDateInTimeZone(instant, 'Asia/Manila')).toBe('2026-08-23')
  })

  it('does calendar arithmetic without DST-sized millisecond assumptions', () => {
    expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(calendarDaysBetween('2026-08-01', '2026-08-23')).toBe(22)
  })
})
