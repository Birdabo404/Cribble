import type { ServiceComponent, ServiceId, ServiceStatus, Severity } from './types'
import { fetchJson } from './http'
import {
  buildDays,
  quietRatioOf,
  sanitizeIncidentTitle,
  severityRank,
  type IncidentInterval
} from './uptime'

// Shared Atlassian Statuspage v2 parser. GitHub, Claude and Cursor all
// run stock Statuspage, so one adapter reads all three: summary.json for
// the page indicator + live component states, incidents.json for the
// last ~50 published incidents the 90-day bar is reconstructed from
// (their real SLA calculator is not public — published incidents are).
// A source may also carve one page into product rows (Origin lives on
// Cursor's page): 'only' keeps just the named component, 'except' keeps
// the rest, and incidents follow their affected-component lists.

/** Carve one vendor page into product rows. Incidents pinned solely to
 *  the carved component leave with it; unattributed incidents stay with
 *  the 'except' side, which is the page-wide product row. */
export type ComponentFilter = {
  mode: 'only' | 'except'
  component: string
}

export type StatuspageSource = {
  id: ServiceId
  name: string
  /** Origin serving /api/v2/*.json; doubles as the row's source link. */
  origin: string
  filter?: ComponentFilter
}

export const GITHUB_SOURCE: StatuspageSource = {
  id: 'github',
  name: 'GitHub',
  origin: 'https://www.githubstatus.com'
}

export const CLAUDE_SOURCE: StatuspageSource = {
  id: 'claude',
  name: 'Claude',
  origin: 'https://status.claude.com'
}

export const CURSOR_SOURCE: StatuspageSource = {
  id: 'cursor',
  name: 'Cursor',
  origin: 'https://status.cursor.com',
  // Origin rides this same page as a component but gets its own row at
  // the top of the watchlist — carved out here so one vendor incident
  // never lights both rows.
  filter: { mode: 'except', component: 'Origin' }
}

export const ORIGIN_SOURCE: StatuspageSource = {
  id: 'origin',
  name: 'Origin',
  origin: 'https://status.cursor.com',
  filter: { mode: 'only', component: 'Origin' }
}

// Tolerant readers for feed payloads we do not control — a shape drift
// should degrade a row, never throw mid-parse.
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function severityFromIndicator(indicator: unknown): Severity {
  switch (indicator) {
    case 'none':
      return 'operational'
    case 'minor':
    case 'maintenance':
      return 'degraded'
    case 'major':
    case 'critical':
      return 'outage'
    default:
      return 'unknown'
  }
}

/** Component words. `full_outage` is incident.io's spelling of the same
 *  state — accepted here so the OpenAI adapter can share this mapper. */
export function severityFromComponentStatus(status: unknown): Severity {
  switch (status) {
    case 'operational':
      return 'operational'
    case 'degraded_performance':
    case 'partial_outage':
    case 'under_maintenance':
      return 'degraded'
    case 'major_outage':
    case 'full_outage':
      return 'outage'
    default:
      return 'unknown'
  }
}

// GitHub ships a permanent "Visit www.githubstatus.com for more
// information" pseudo-component — an informational row, not a system.
const NOISE_COMPONENT_RE = /^visit .+ for more information$/i

export function parseStatuspageComponents(summaryPayload: unknown): ServiceComponent[] {
  const components: ServiceComponent[] = []
  for (const item of asArray(asRecord(summaryPayload)?.components)) {
    const raw = asRecord(item)
    if (!raw || typeof raw.name !== 'string') continue
    if (raw.group === true) continue
    const name = raw.name.trim()
    if (NOISE_COMPONENT_RE.test(name)) continue
    const severity = severityFromComponentStatus(raw.status)
    // only_show_if_degraded components are hidden on the vendor's own
    // page until they act up — mirror that.
    if (raw.only_show_if_degraded === true && severity === 'operational') continue
    components.push({ name, severity })
  }
  return components
}

export function parseStatuspageIncidents(incidentsPayload: unknown): IncidentInterval[] {
  const intervals: IncidentInterval[] = []
  for (const item of asArray(asRecord(incidentsPayload)?.incidents)) {
    const raw = asRecord(item)
    if (!raw || typeof raw.name !== 'string') continue
    const startedAt =
      typeof raw.started_at === 'string'
        ? raw.started_at
        : typeof raw.created_at === 'string'
          ? raw.created_at
          : null
    if (!startedAt) continue
    const componentNames: string[] = []
    for (const entry of asArray(raw.components)) {
      const component = asRecord(entry)
      if (component && typeof component.name === 'string') componentNames.push(component.name)
    }
    intervals.push({
      title: raw.name,
      impact: typeof raw.impact === 'string' ? raw.impact : 'none',
      startedAt,
      resolvedAt: typeof raw.resolved_at === 'string' ? raw.resolved_at : null,
      componentNames
    })
  }
  return intervals
}

function filterIntervals(intervals: IncidentInterval[], filter: ComponentFilter): IncidentInterval[] {
  switch (filter.mode) {
    case 'only':
      return intervals.filter((interval) => (interval.componentNames ?? []).includes(filter.component))
    case 'except':
      // Unattributed incidents read page-wide and stay here; only ones
      // pinned exclusively to the carved component leave with it.
      return intervals.filter((interval) => {
        const names = interval.componentNames ?? []
        return names.length === 0 || names.some((name) => name !== filter.component)
      })
    default: {
      const exhaustive: never = filter.mode
      return exhaustive
    }
  }
}

/** Quiet-state line for a carved row, in the hero subline's voice — the
 *  vendor's page-wide description would leak the other rows' weather. */
function filteredDescription(source: StatuspageSource, severity: Severity): string {
  switch (severity) {
    case 'operational':
      return source.filter?.mode === 'only'
        ? `${source.name} operational`
        : `All ${source.name} components operational`
    case 'degraded':
      return `${source.name} running degraded`
    case 'outage':
      return `${source.name} down`
    case 'unknown':
      return `${source.name} state unreadable this pass`
    default: {
      const exhaustive: never = severity
      return exhaustive
    }
  }
}

/** Assemble a row from already-fetched payloads. `incidentsPayload` is
 *  null when only the incident history was unreachable — the row keeps
 *  its live severity and just omits the bar. */
export function buildStatuspageStatus(
  source: StatuspageSource,
  summaryPayload: unknown,
  incidentsPayload: unknown | null,
  now: Date
): ServiceStatus {
  const filter = source.filter
  const allComponents = parseStatuspageComponents(summaryPayload)
  const components = !filter
    ? allComponents
    : allComponents.filter((component) =>
        filter.mode === 'only'
          ? component.name === filter.component
          : component.name !== filter.component
      )

  // A carved row whose component vanished from the vendor page must not
  // claim anything — throw so the aggregate marks it honestly unknown.
  if (filter?.mode === 'only' && components.length === 0) {
    throw new Error(`No "${filter.component}" component on ${source.origin}`)
  }

  const allIntervals = incidentsPayload === null ? null : parseStatuspageIncidents(incidentsPayload)
  const intervals =
    allIntervals === null ? null : filter ? filterIntervals(allIntervals, filter) : allIntervals
  const days = intervals === null ? null : buildDays(intervals, now)

  const status = asRecord(asRecord(summaryPayload)?.status)
  let severity: Severity
  let description: string
  if (!filter) {
    severity = severityFromIndicator(status?.indicator)
    description =
      typeof status?.description === 'string' && status.description.trim()
        ? sanitizeIncidentTitle(status.description)
        : 'Status feed answered without a summary line'
  } else {
    // The page indicator blends every component, so a carved row scores
    // itself: worst of its own components, floored at degraded while an
    // incident naming them stays open (the monitoring phase).
    severity = 'operational'
    for (const component of components) {
      if (severityRank(component.severity) > severityRank(severity)) severity = component.severity
    }
    const ongoing = intervals?.find((interval) => interval.resolvedAt === null) ?? null
    if (ongoing && severity === 'operational') severity = 'degraded'
    description = ongoing ? sanitizeIncidentTitle(ongoing.title) : filteredDescription(source, severity)
  }

  return {
    id: source.id,
    name: source.name,
    severity,
    description,
    sourceUrl: source.origin,
    fetchedAt: now.toISOString(),
    components,
    ...(days ? { days, quietRatio: quietRatioOf(days) } : {})
  }
}

export async function fetchStatuspageStatus(source: StatuspageSource): Promise<ServiceStatus> {
  const [summary, incidents] = await Promise.allSettled([
    fetchJson(`${source.origin}/api/v2/summary.json`),
    fetchJson(`${source.origin}/api/v2/incidents.json`)
  ])
  // No summary, no row — the aggregate turns the rejection into an
  // honest unknown. A missing history alone only costs the day bar.
  if (summary.status === 'rejected') throw summary.reason
  return buildStatuspageStatus(
    source,
    summary.value,
    incidents.status === 'fulfilled' ? incidents.value : null,
    new Date()
  )
}
