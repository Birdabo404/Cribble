import { STATUS_WINDOW_DAYS, type DayCell, type Severity } from './types'

// Pure day-bar math. Vendors publish incidents, not uptime — the 90-day
// bar is reconstructed by painting each UTC day with the worst incident
// interval that overlaps it. Everything here takes an explicit `now` so
// tests can pin the clock.

const DAY_MS = 86_400_000
const TITLE_MAX_CHARS = 140

/** A vendor incident reduced to what day painting needs. `impact` keeps
 *  the feed's own word — Statuspage none/minor/major/critical, incident.io
 *  degraded_performance/partial_outage/full_outage, xAI disruption/outage —
 *  and is mapped to a day colour here. */
export type IncidentInterval = {
  title: string
  impact: string
  /** ISO start; unparseable starts drop the incident from the bar. */
  startedAt: string
  /** null while the incident is still open — it then extends to `now`. */
  resolvedAt: string | null
  /** Affected component names when the feed publishes them — lets one
   *  vendor page be split into per-product rows (Origin on Cursor's). */
  componentNames?: readonly string[]
}

/** Worst-of ordering. `unknown` sits between operational and degraded:
 *  it never wins against a real signal but beats a clean bill. */
export function severityRank(severity: Severity): number {
  switch (severity) {
    case 'operational':
      return 0
    case 'unknown':
      return 1
    case 'degraded':
      return 2
    case 'outage':
      return 3
    default: {
      const exhausted: never = severity
      return exhausted
    }
  }
}

/** Incident titles land in tooltips — strip markup and control chars from
 *  feed text (RSS descriptions arrive as HTML) and cap the length. */
export function sanitizeIncidentTitle(raw: string): string {
  const flat = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= TITLE_MAX_CHARS) return flat
  return `${flat.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`
}

/** Day colour for a feed's impact word: hard-outage words go ember, any
 *  other published incident (minor/none/maintenance-ish) paints ice. */
export function impactDaySeverity(impact: string): Extract<Severity, 'degraded' | 'outage'> {
  switch (impact.trim().toLowerCase()) {
    case 'critical':
    case 'major':
    case 'major_outage':
    case 'full_outage':
    case 'outage':
      return 'outage'
    default:
      return 'degraded'
  }
}

/** Exactly STATUS_WINDOW_DAYS UTC cells, oldest first, ending on `now`'s
 *  UTC day. Each cell carries the worst overlapping incident's severity
 *  and title; unresolved incidents extend to `now`. */
export function buildDays(incidents: IncidentInterval[], now: Date): DayCell[] {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const windowStart = todayStart - (STATUS_WINDOW_DAYS - 1) * DAY_MS

  const cells: DayCell[] = []
  for (let i = 0; i < STATUS_WINDOW_DAYS; i++) {
    cells.push({
      date: new Date(windowStart + i * DAY_MS).toISOString().slice(0, 10),
      severity: 'operational'
    })
  }

  for (const incident of incidents) {
    const start = Date.parse(incident.startedAt)
    if (Number.isNaN(start)) continue
    const parsedEnd = incident.resolvedAt === null ? now.getTime() : Date.parse(incident.resolvedAt)
    const end = Number.isNaN(parsedEnd) ? start : Math.max(parsedEnd, start)
    if (end < windowStart) continue

    const severity = impactDaySeverity(incident.impact)
    const firstIndex = Math.max(0, Math.floor((start - windowStart) / DAY_MS))
    const lastIndex = Math.min(STATUS_WINDOW_DAYS - 1, Math.floor((end - windowStart) / DAY_MS))
    for (let i = firstIndex; i <= lastIndex; i++) {
      if (severityRank(severity) > severityRank(cells[i].severity)) {
        cells[i].severity = severity
        cells[i].incident = sanitizeIncidentTitle(incident.title)
      }
    }
  }

  return cells
}

/** Fraction of window days with no published incident (0..1). */
export function quietRatioOf(days: DayCell[]): number {
  if (days.length === 0) return 1
  const quiet = days.filter((day) => day.severity === 'operational').length
  return quiet / days.length
}
