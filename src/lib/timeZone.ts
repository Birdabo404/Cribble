const DATE_PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>()

/**
 * Validate and canonicalize a timezone with the runtime's IANA tz database.
 * This intentionally does more than a character check: unknown zones throw.
 */
export function normalizeIanaTimeZone(value: string | null | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate || candidate.length > 64) return null
  // ECMA-402 also accepts fixed-offset identifiers in newer runtimes. The
  // ingest contract requires a named IANA zone so future DST rules exist.
  if (/^[+-]/.test(candidate)) return null

  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: candidate })
      .resolvedOptions()
      .timeZone
  } catch {
    return null
  }
}

function datePartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = DATE_PARTS_FORMATTERS.get(timeZone)
  if (existing) return existing

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  DATE_PARTS_FORMATTERS.set(timeZone, formatter)
  return formatter
}

export function calendarDateInTimeZone(ms: number, timeZone: string): string {
  const parts = datePartsFormatter(timeZone).formatToParts(new Date(ms))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function calendarDaysBetween(earlier: string, later: string): number {
  const toUtcDay = (value: string) => {
    const [year, month, day] = value.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((toUtcDay(later) - toUtcDay(earlier)) / 86_400_000)
}
