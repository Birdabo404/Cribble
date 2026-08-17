// Severity → ink for the /status console, plus the UTC formatting the
// whole page shares. Colors resolve through the scoped --sev-* custom
// properties declared in StatusConsole's style block: dark mode reads
// the repo tokens verbatim (accent = operational, ice = degraded,
// ember = outage), light mode re-pins outage to stamp-red ink because
// the dossier paper theme pins ember to the same orange as the accent —
// and a status page must never let "quiet" and "down" share a hue.
// Alpha accepts a calc() string so glows can ride --status-glow.

import type { DayCell, Severity } from '@/lib/status/types'

export function severityColor(
  severity: Severity,
  alpha: number | string = 1
): string {
  switch (severity) {
    case 'operational':
      return `rgb(var(--sev-ok) / ${alpha})`
    case 'degraded':
      return `rgb(var(--sev-warn) / ${alpha})`
    case 'outage':
      return `rgb(var(--sev-down) / ${alpha})`
    case 'unknown':
      return `rgb(var(--z500) / ${alpha})`
    default: {
      const exhaustive: never = severity
      return exhaustive
    }
  }
}

export function severityLabel(severity: Severity): string {
  switch (severity) {
    case 'operational':
      return 'OPERATIONAL'
    case 'degraded':
      return 'DEGRADED'
    case 'outage':
      return 'OUTAGE'
    case 'unknown':
      return 'NO SIGNAL'
    default: {
      const exhaustive: never = severity
      return exhaustive
    }
  }
}

/** Cockpit-lamp state word for the Cribble probes row. */
export function lampWord(severity: Severity): string {
  switch (severity) {
    case 'operational':
      return 'LIVE'
    case 'degraded':
      return 'STRAINED'
    case 'outage':
      return 'DOWN'
    case 'unknown':
      return 'NO SIGNAL'
    default: {
      const exhaustive: never = severity
      return exhaustive
    }
  }
}

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
] as const

/** 'YYYY-MM-DD' → 'AUG 17 2026' — string math only, no Date() timezone traps. */
export function formatUtcDay(date: string): string {
  const [year, month, day] = date.split('-')
  const name = MONTHS[Number(month) - 1]
  if (!year || !name || !day) return date
  return `${name} ${Number(day)} ${year}`
}

/** ISO timestamp → 'HH:MM:SS' in UTC. */
export function formatUtcTime(iso: string): string {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return '··:··:··'
  return time.toISOString().slice(11, 19)
}

/** Tooltip line for one history cell: the UTC date plus the worst
 *  published incident's title, or the quiet / no-data stamp. */
export function dayCellTip(cell: DayCell): string {
  const day = formatUtcDay(cell.date)
  if (cell.incident) return `${day} · ${cell.incident}`
  if (cell.severity === 'operational') return `${day} · QUIET`
  if (cell.severity === 'unknown') return `${day} · NO DATA`
  return `${day} · ${severityLabel(cell.severity)}`
}
