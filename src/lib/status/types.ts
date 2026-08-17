// Shared contract for cribble.dev/status. The aggregator in this folder
// assembles a StatusPayload from official public feeds, GET /api/status
// serves it verbatim (no envelope), and the /status UI renders it.
// Both sides build against this file — keep it dependency-free.

export type Severity = 'operational' | 'degraded' | 'outage' | 'unknown'

/** Display order is the payload order: github, chatgpt, claude, cursor,
 *  grok, cribble. The UI renders services as received. */
export type ServiceId = 'github' | 'chatgpt' | 'claude' | 'cursor' | 'grok' | 'cribble'

/** Reconstructed vendor history window, in UTC days. */
export const STATUS_WINDOW_DAYS = 90

/** One UTC day in a vendor's reconstructed history bar. */
export type DayCell = {
  /** YYYY-MM-DD (UTC). */
  date: string
  severity: Severity
  /** Title of the worst published incident overlapping this day, if any. */
  incident?: string
}

export type ServiceComponent = {
  name: string
  severity: Severity
}

export type ServiceStatus = {
  id: ServiceId
  name: string
  severity: Severity
  /** Human description straight from the source (or our probe copy). */
  description: string
  /** Official public status page backing the row's source link. */
  sourceUrl: string
  /** ISO timestamp of when this feed was read. */
  fetchedAt: string
  components: ServiceComponent[]
  /** Vendors only — exactly STATUS_WINDOW_DAYS cells, oldest first.
   *  Omitted when history can't be credibly reconstructed (and always
   *  for Cribble, whose row is live probes, never invented history). */
  days?: DayCell[]
  /** Vendors only: fraction of window days with no published incident (0..1). */
  quietRatio?: number
}

/** Response body of GET /api/status — served as-is, no success wrapper. */
export type StatusPayload = {
  services: ServiceStatus[]
  /** Worst severity across services, ignoring 'unknown' feeds; defaults
   *  to 'operational' when every feed is unknown (incomplete covers it). */
  overall: Exclude<Severity, 'unknown'>
  /** True when at least one feed could not be read this pass. */
  incomplete: boolean
  /** ISO timestamp of aggregation. */
  checkedAt: string
}
