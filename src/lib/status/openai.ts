import type { ServiceComponent, ServiceStatus, Severity } from './types'
import { fetchJson } from './http'
import {
  asArray,
  asRecord,
  parseStatuspageIncidents,
  severityFromComponentStatus,
  severityFromIndicator
} from './statuspage'
import {
  buildDays,
  quietRatioOf,
  sanitizeIncidentTitle,
  severityRank,
  type IncidentInterval
} from './uptime'

// The ChatGPT row. status.openai.com runs incident.io, whose widget proxy
// is the only feed carrying the component-group tree — and this row is
// the ChatGPT product, not the whole OpenAI page, so the APIs / Codex /
// FedRAMP / Ads Platform groups must be filtered out. The page also
// serves a Statuspage-compatible shim (/api/v2/*.json), but it is lossy:
// components come flat with no group fields at all, incident component
// lists are empty, and every impact is downgraded to minor/none. It only
// works as a page-wide fallback when the proxy is unreachable.

export const OPENAI_SOURCE_URL = 'https://status.openai.com'

const PROXY_SUMMARY_URL = 'https://status.openai.com/proxy/status.openai.com'
const PROXY_INCIDENTS_URL = 'https://status.openai.com/proxy/status.openai.com/incidents'
const SHIM_SUMMARY_URL = 'https://status.openai.com/api/v2/summary.json'
const SHIM_INCIDENTS_URL = 'https://status.openai.com/api/v2/incidents.json'

const PRODUCT_GROUP = 'ChatGPT'

type GroupMember = { id: string; name: string }

/** The ChatGPT group out of the proxy's structure tree, or null when the
 *  shape has drifted — the caller then falls back to the shim. */
function findProductGroup(summary: Record<string, unknown>): GroupMember[] | null {
  for (const item of asArray(asRecord(summary.structure)?.items)) {
    const group = asRecord(asRecord(item)?.group)
    if (!group || group.name !== PRODUCT_GROUP) continue
    const members: GroupMember[] = []
    for (const entry of asArray(group.components)) {
      const raw = asRecord(entry)
      if (!raw || typeof raw.component_id !== 'string' || typeof raw.name !== 'string') continue
      if (raw.hidden === true) continue
      members.push({ id: raw.component_id, name: raw.name })
    }
    return members.length > 0 ? members : null
  }
  return null
}

/** Live state for one component out of an affected_components entry —
 *  `current_status` is the live word, `status` the incident's impact. An
 *  affected component with an unrecognized word still reads as degraded:
 *  the feed says something is wrong even if we can't classify it. */
function severityFromAffectedEntry(entry: Record<string, unknown>): Severity {
  const word = typeof entry.current_status === 'string' ? entry.current_status : entry.status
  const severity = severityFromComponentStatus(word)
  return severity === 'unknown' ? 'degraded' : severity
}

/** Incident entries that touch the ChatGPT set, from either the impact
 *  intervals or the affected-components list. */
function touchingEntries(incident: Record<string, unknown>, ids: Set<string>): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = []
  for (const list of [incident.component_impacts, incident.affected_components]) {
    for (const item of asArray(list)) {
      const raw = asRecord(item)
      if (raw && typeof raw.component_id === 'string' && ids.has(raw.component_id)) entries.push(raw)
    }
  }
  return entries
}

function proxyIncidentInterval(incident: Record<string, unknown>, ids: Set<string>): IncidentInterval | null {
  if (typeof incident.name !== 'string') return null
  const impacts = asArray(incident.component_impacts)
    .map(asRecord)
    .filter((raw): raw is Record<string, unknown> => raw !== null)
    .filter((raw) => typeof raw.component_id === 'string' && ids.has(raw.component_id))
  if (impacts.length === 0) return null

  let worstWord = 'degraded_performance'
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY
  for (const impact of impacts) {
    const word = typeof impact.status === 'string' ? impact.status : ''
    if (severityRank(severityFromComponentStatus(word)) > severityRank(severityFromComponentStatus(worstWord))) {
      worstWord = word
    }
    const start = typeof impact.start_at === 'string' ? Date.parse(impact.start_at) : NaN
    if (!Number.isNaN(start)) startMs = Math.min(startMs, start)
    const end = typeof impact.end_at === 'string' ? Date.parse(impact.end_at) : NaN
    if (!Number.isNaN(end)) endMs = Math.max(endMs, end)
  }
  const published = typeof incident.published_at === 'string' ? Date.parse(incident.published_at) : NaN
  if (!Number.isFinite(startMs)) startMs = published
  if (Number.isNaN(startMs)) return null

  const resolved = incident.status === 'resolved'
  const resolvedAt = resolved
    ? new Date(Number.isFinite(endMs) ? endMs : startMs).toISOString()
    : null

  return {
    title: incident.name,
    impact: worstWord,
    startedAt: new Date(startMs).toISOString(),
    resolvedAt
  }
}

/** Assemble the row from proxy payloads. Returns null when the ChatGPT
 *  group can't be located (shape drift) so the caller can fall back. */
export function buildChatgptFromProxy(
  summaryPayload: unknown,
  incidentsPayload: unknown | null,
  now: Date
): ServiceStatus | null {
  const summary = asRecord(asRecord(summaryPayload)?.summary)
  if (!summary) return null
  const members = findProductGroup(summary)
  if (!members) return null
  const ids = new Set(members.map((member) => member.id))

  const severityById = new Map<string, Severity>(members.map((member) => [member.id, 'operational']))
  const applyEntry = (entry: Record<string, unknown>) => {
    const id = typeof entry.component_id === 'string' ? entry.component_id : null
    if (!id || !severityById.has(id)) return
    const severity = severityFromAffectedEntry(entry)
    if (severityRank(severity) > severityRank(severityById.get(id)!)) severityById.set(id, severity)
  }

  for (const entry of asArray(summary.affected_components)) {
    const raw = asRecord(entry)
    if (raw) applyEntry(raw)
  }

  let ongoingTitle: string | null = null
  for (const item of asArray(summary.ongoing_incidents)) {
    const incident = asRecord(item)
    if (!incident) continue
    const touching = touchingEntries(incident, ids)
    if (touching.length === 0) continue
    if (ongoingTitle === null && typeof incident.name === 'string') ongoingTitle = incident.name
    for (const entry of touching) applyEntry(entry)
  }

  const components: ServiceComponent[] = members.map((member) => ({
    name: member.name,
    severity: severityById.get(member.id)!
  }))

  // An open incident on the product is at least degraded, even while its
  // components read recovered (monitoring phase).
  let severity: Severity = ongoingTitle !== null ? 'degraded' : 'operational'
  for (const component of components) {
    if (severityRank(component.severity) > severityRank(severity)) severity = component.severity
  }

  const intervals: IncidentInterval[] = []
  if (incidentsPayload !== null) {
    for (const item of asArray(asRecord(incidentsPayload)?.incidents)) {
      const incident = asRecord(item)
      if (!incident) continue
      const interval = proxyIncidentInterval(incident, ids)
      if (interval) intervals.push(interval)
    }
  }
  const days = incidentsPayload === null ? null : buildDays(intervals, now)

  return {
    id: 'chatgpt',
    name: 'ChatGPT',
    severity,
    description: ongoingTitle !== null ? sanitizeIncidentTitle(ongoingTitle) : 'All ChatGPT components operational',
    sourceUrl: OPENAI_SOURCE_URL,
    fetchedAt: now.toISOString(),
    components,
    ...(days ? { days, quietRatio: quietRatioOf(days) } : {})
  }
}

/** Shim fallback: page-wide truth, honestly labelled. Without group data
 *  the component list stays empty rather than passing 25 OpenAI-wide
 *  components off as ChatGPT's. */
export function buildChatgptFromShim(
  summaryPayload: unknown,
  incidentsPayload: unknown | null,
  now: Date
): ServiceStatus {
  const status = asRecord(asRecord(summaryPayload)?.status)
  const line =
    typeof status?.description === 'string' && status.description.trim()
      ? sanitizeIncidentTitle(status.description)
      : 'Status feed answered without a summary line'
  const days = incidentsPayload === null ? null : buildDays(parseStatuspageIncidents(incidentsPayload), now)

  return {
    id: 'chatgpt',
    name: 'ChatGPT',
    severity: severityFromIndicator(status?.indicator),
    description: `${line} (OpenAI page-wide)`,
    sourceUrl: OPENAI_SOURCE_URL,
    fetchedAt: now.toISOString(),
    components: [],
    ...(days ? { days, quietRatio: quietRatioOf(days) } : {})
  }
}

export async function fetchChatgptStatus(): Promise<ServiceStatus> {
  const now = new Date()
  const [proxySummary, proxyIncidents] = await Promise.allSettled([
    fetchJson(PROXY_SUMMARY_URL),
    fetchJson(PROXY_INCIDENTS_URL)
  ])
  if (proxySummary.status === 'fulfilled') {
    const fromProxy = buildChatgptFromProxy(
      proxySummary.value,
      proxyIncidents.status === 'fulfilled' ? proxyIncidents.value : null,
      now
    )
    if (fromProxy) return fromProxy
  }

  const [shimSummary, shimIncidents] = await Promise.allSettled([
    fetchJson(SHIM_SUMMARY_URL),
    fetchJson(SHIM_INCIDENTS_URL)
  ])
  if (shimSummary.status === 'rejected') throw shimSummary.reason
  return buildChatgptFromShim(
    shimSummary.value,
    shimIncidents.status === 'fulfilled' ? shimIncidents.value : null,
    now
  )
}
