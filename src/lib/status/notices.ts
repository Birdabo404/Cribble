import type {
  IncidentThread,
  NoticeEntry,
  NoticePhase,
  NoticeSeverity,
  StatusNotices,
  StatusPayload
} from './types'
import { severityRank } from './uptime'

// The operator's status log, as pure functions. The table (migration
// 070) is an append-only ship's log: every post is an immutable line
// carrying its own severity / phase / title, and everything the page
// shows — which incidents are open, what phase each is in, when it was
// resolved — is derived here from the lines. No status column, no
// edit-in-place, nothing to get out of sync. Every function takes an
// explicit `now` so tests can pin the clock.

export const NOTICE_TITLE_MAX = 80
export const NOTICE_BODY_MAX = 600

/** Resolved threads stay on the page this long. */
export const NOTICE_RECENT_WINDOW_DAYS = 14
/** …and at most this many of them. */
export const NOTICE_RECENT_LIMIT = 5

export const NOTICE_PHASES: readonly NoticePhase[] = [
  'investigating',
  'identified',
  'monitoring',
  'maintenance',
  'resolved'
]

export const NOTICE_SEVERITIES: readonly NoticeSeverity[] = [
  'operational',
  'degraded',
  'outage'
]

const DAY_MS = 86_400_000

export function isNoticePhase(value: unknown): value is NoticePhase {
  return typeof value === 'string' && (NOTICE_PHASES as readonly string[]).includes(value)
}

export function isNoticeSeverity(value: unknown): value is NoticeSeverity {
  return (
    typeof value === 'string' && (NOTICE_SEVERITIES as readonly string[]).includes(value)
  )
}

/** Same sanitize pipeline as ticker copy: control characters become
 *  spaces, whitespace collapses, ends trim. Length is the caller's job
 *  (measured in code points to match the table's char_length CHECKs). */
export function cleanNoticeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Oldest first, ties broken by id so two lines in the same millisecond
 *  still order deterministically. */
function chronological(entries: readonly NoticeEntry[]): NoticeEntry[] {
  return [...entries].sort((a, b) => {
    const delta = Date.parse(a.at) - Date.parse(b.at)
    return delta !== 0 ? delta : a.id - b.id
  })
}

/** Fold one incident's lines (any order) into its thread; null for an
 *  empty list. State is the newest line's — latest word wins. */
export function threadOf(entries: readonly NoticeEntry[]): IncidentThread | null {
  if (entries.length === 0) return null
  const ordered = chronological(entries)
  const first = ordered[0]
  const latest = ordered[ordered.length - 1]
  const open = latest.phase !== 'resolved'
  return {
    incidentId: latest.incidentId,
    title: latest.title,
    severity: latest.severity,
    phase: latest.phase,
    open,
    openedAt: first.at,
    updatedAt: latest.at,
    resolvedAt: open ? null : latest.at,
    entries: ordered.reverse()
  }
}

type DeriveOptions = {
  recentWindowDays?: number
  recentLimit?: number
}

/** Group lines by incident and split into open threads (most recently
 *  updated first) and recently resolved ones (newest resolution first,
 *  windowed and capped). */
export function deriveNotices(
  entries: readonly NoticeEntry[],
  now: Date,
  options: DeriveOptions = {}
): StatusNotices {
  const windowDays = options.recentWindowDays ?? NOTICE_RECENT_WINDOW_DAYS
  const limit = options.recentLimit ?? NOTICE_RECENT_LIMIT

  const byIncident = new Map<string, NoticeEntry[]>()
  for (const entry of entries) {
    const bucket = byIncident.get(entry.incidentId)
    if (bucket) bucket.push(entry)
    else byIncident.set(entry.incidentId, [entry])
  }

  const open: IncidentThread[] = []
  const closed: IncidentThread[] = []
  for (const lines of byIncident.values()) {
    const thread = threadOf(lines)
    if (thread === null) continue
    if (thread.open) open.push(thread)
    else closed.push(thread)
  }

  open.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  const cutoff = now.getTime() - windowDays * DAY_MS
  const recent = closed
    .filter((thread) => Date.parse(thread.resolvedAt ?? thread.updatedAt) >= cutoff)
    .sort(
      (a, b) =>
        Date.parse(b.resolvedAt ?? b.updatedAt) - Date.parse(a.resolvedAt ?? a.updatedAt)
    )
    .slice(0, limit)

  return { open, recent }
}

/** Attach the log to a payload and lift `overall` to the worst open
 *  notice. Declared impact never lowers what the probes see — an
 *  operator posting 'operational' (a maintenance note) on a degraded
 *  stack leaves the verdict degraded. */
export function applyNotices(payload: StatusPayload, notices: StatusNotices): StatusPayload {
  let overall = payload.overall
  for (const thread of notices.open) {
    if (severityRank(thread.severity) > severityRank(overall)) overall = thread.severity
  }
  return { ...payload, overall, notices }
}

/** What a follow-up inherits from its thread when the post omits it:
 *  the title always; severity unless the line resolves the incident,
 *  which defaults to operational (the all-clear is the point). */
export function carryForward(
  thread: IncidentThread,
  phase: NoticePhase,
  severity: NoticeSeverity | undefined
): { title: string; severity: NoticeSeverity } {
  return {
    title: thread.title,
    severity: severity ?? (phase === 'resolved' ? 'operational' : thread.severity)
  }
}

/** Raw status_log_entries row → contract entry. Exported so the admin
 *  and public routes map rows identically. */
export type NoticeEntryRow = {
  id: number | string
  incident_id: string
  severity: string
  phase: string
  title: string
  body: string
  created_at: string
}

export function toNoticeEntry(row: NoticeEntryRow): NoticeEntry {
  return {
    id: Number(row.id),
    incidentId: String(row.incident_id),
    at: new Date(String(row.created_at)).toISOString(),
    severity: isNoticeSeverity(row.severity) ? row.severity : 'degraded',
    phase: isNoticePhase(row.phase) ? row.phase : 'investigating',
    title: String(row.title),
    body: String(row.body)
  }
}
