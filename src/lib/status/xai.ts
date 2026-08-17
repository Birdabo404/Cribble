import type { ServiceStatus, Severity } from './types'
import { fetchText } from './http'
import {
  buildDays,
  quietRatioOf,
  sanitizeIncidentTitle,
  type IncidentInterval
} from './uptime'

// The Grok row. status.x.ai is a custom site whose only machine-readable
// feed is RSS at /feed.xml — every JSON-looking sibling path answers a
// 403 block page (probed 2026-08-17). Items carry the incident start in
// <pubDate>, paired <category> tags (a severity word like available/
// disruption/outage/info plus `resolved` once closed), and an HTML
// description with "Status: RESOLVED" / "Resolved: <date>" markers. The
// feed has gone weeks between rebuilds, so an unresolved item only
// colours the row while it is recent.

export const XAI_SOURCE_URL = 'https://status.x.ai'

const FEED_URL = 'https://status.x.ai/feed.xml'
const UNRESOLVED_RECENT_MS = 7 * 86_400_000

export type XaiItem = {
  title: string
  startedAt: string
  resolvedAt: string | null
  resolved: boolean
  /** The item's severity category: outage, disruption, available, info… */
  severityWord: string
}

function textBetween(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  if (!match) return null
  return match[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim()
}

/** Hand-rolled tolerant extractor — no XML dependency for one feed. An
 *  item without a parseable <pubDate> is dropped; anything else missing
 *  degrades to safe defaults. */
export function parseXaiFeed(xml: string): XaiItem[] | null {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) return null

  const items: XaiItem[] = []
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1]
    const pubDate = textBetween(block, 'pubDate')
    const startMs = pubDate ? Date.parse(pubDate) : NaN
    if (Number.isNaN(startMs)) continue

    const description = textBetween(block, 'description') ?? ''
    const categories = [...block.matchAll(/<category>([^<]*)<\/category>/g)].map((entry) =>
      entry[1].trim().toLowerCase()
    )
    const resolved = categories.includes('resolved') || /status:\s*resolved/i.test(description)

    // "Resolved: Tue, 07 Jul 2026 16:37:02 GMT" pins the end; a resolved
    // item without one collapses to its start day rather than staying open.
    const resolvedMatch = description.match(/resolved:\s*([^<\n]+)/i)
    const resolvedMs = resolvedMatch ? Date.parse(resolvedMatch[1].trim()) : NaN
    const resolvedAt = !Number.isNaN(resolvedMs)
      ? new Date(resolvedMs).toISOString()
      : resolved
        ? new Date(startMs).toISOString()
        : null

    const severityMatch = description.match(/severity:\s*([a-z_ -]+)/i)
    const severityWord =
      categories.find((word) => word !== 'resolved') ??
      (severityMatch ? severityMatch[1].trim().toLowerCase() : 'disruption')

    items.push({
      title: textBetween(block, 'title') ?? 'Untitled incident',
      startedAt: new Date(startMs).toISOString(),
      resolvedAt,
      resolved,
      severityWord
    })
  }
  return items
}

/** `info` items are announcements, not incidents — they neither colour
 *  the row nor paint days. */
function isIncidentItem(item: XaiItem): boolean {
  return item.severityWord !== 'info'
}

export function buildXaiStatus(xml: string, now: Date): ServiceStatus {
  const items = parseXaiFeed(xml)
  if (items === null) {
    return {
      id: 'grok',
      name: 'Grok',
      severity: 'unknown',
      description: 'Could not parse the xAI status feed',
      sourceUrl: XAI_SOURCE_URL,
      fetchedAt: now.toISOString(),
      components: []
    }
  }

  const incidents = items.filter(isIncidentItem)
  const openRecent = incidents.filter(
    (item) => !item.resolved && now.getTime() - Date.parse(item.startedAt) <= UNRESOLVED_RECENT_MS
  )

  let severity: Severity = 'operational'
  if (openRecent.length > 0) {
    severity = openRecent.some((item) => item.severityWord === 'outage' || /outage/i.test(item.title))
      ? 'outage'
      : 'degraded'
  }

  const days = buildDays(
    incidents.map((item): IncidentInterval => {
      // A stale unresolved item is feed noise (same stance the row takes
      // above) — close it on its start day instead of smearing degraded
      // from there to today.
      const recent = now.getTime() - Date.parse(item.startedAt) <= UNRESOLVED_RECENT_MS
      return {
        title: item.title,
        impact: item.severityWord,
        startedAt: item.startedAt,
        resolvedAt: item.resolvedAt ?? (recent ? null : item.startedAt)
      }
    }),
    now
  )

  return {
    id: 'grok',
    name: 'Grok',
    severity,
    description:
      openRecent.length > 0
        ? sanitizeIncidentTitle(openRecent[0].title)
        : 'No unresolved incidents in the published feed',
    sourceUrl: XAI_SOURCE_URL,
    fetchedAt: now.toISOString(),
    // RSS carries incident history, not live per-component states — an
    // empty list is honest here.
    components: [],
    days,
    quietRatio: quietRatioOf(days)
  }
}

export async function fetchXaiStatus(): Promise<ServiceStatus> {
  const xml = await fetchText(FEED_URL)
  return buildXaiStatus(xml, new Date())
}
