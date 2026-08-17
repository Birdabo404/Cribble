import type { ServiceId, ServiceStatus, Severity, StatusPayload } from './types'
import {
  CLAUDE_SOURCE,
  CURSOR_SOURCE,
  GITHUB_SOURCE,
  fetchStatuspageStatus
} from './statuspage'
import { OPENAI_SOURCE_URL, fetchChatgptStatus } from './openai'
import { XAI_SOURCE_URL, fetchXaiStatus } from './xai'
import { fetchCribbleStatus } from './cribble'
import { severityRank } from './uptime'

// Page-level rollup. Every provider runs behind Promise.allSettled with
// its own short-fused fetches, so one dead feed costs one unknown row —
// never the payload. Only the fixed vendor hostnames in this folder are
// ever fetched; nothing here takes a user-controlled URL.

type ProviderSpec = {
  id: ServiceId
  name: string
  /** Source link for the placeholder row when the feed can't be read. */
  sourceUrl: string
  load: () => Promise<ServiceStatus>
}

/** Contract order — the payload renders as listed here. */
export const STATUS_PROVIDERS: readonly ProviderSpec[] = [
  { id: 'github', name: 'GitHub', sourceUrl: GITHUB_SOURCE.origin, load: () => fetchStatuspageStatus(GITHUB_SOURCE) },
  { id: 'chatgpt', name: 'ChatGPT', sourceUrl: OPENAI_SOURCE_URL, load: fetchChatgptStatus },
  { id: 'claude', name: 'Claude', sourceUrl: CLAUDE_SOURCE.origin, load: () => fetchStatuspageStatus(CLAUDE_SOURCE) },
  { id: 'cursor', name: 'Cursor', sourceUrl: CURSOR_SOURCE.origin, load: () => fetchStatuspageStatus(CURSOR_SOURCE) },
  { id: 'grok', name: 'Grok', sourceUrl: XAI_SOURCE_URL, load: fetchXaiStatus },
  { id: 'cribble', name: 'Cribble', sourceUrl: 'https://cribble.dev', load: fetchCribbleStatus }
]

/** Assemble the payload from settled provider results (index-aligned
 *  with STATUS_PROVIDERS). Missing or rejected entries become honest
 *  unknown rows; `overall` is the worst severity among readable feeds,
 *  defaulting to operational when nothing is readable — `incomplete`
 *  carries that caveat. */
export function assembleStatusPayload(
  settled: PromiseSettledResult<ServiceStatus>[],
  now: Date
): StatusPayload {
  const services: ServiceStatus[] = STATUS_PROVIDERS.map((provider, index) => {
    const result = settled[index]
    if (result?.status === 'fulfilled') return result.value
    if (result?.status === 'rejected') {
      console.warn(`[Status] ${provider.id} feed failed:`, result.reason)
    }
    return {
      id: provider.id,
      name: provider.name,
      severity: 'unknown',
      description: `Could not reach the ${provider.name} status feed this pass`,
      sourceUrl: provider.sourceUrl,
      fetchedAt: now.toISOString(),
      components: []
    }
  })

  let overall: Exclude<Severity, 'unknown'> = 'operational'
  for (const service of services) {
    if (service.severity === 'unknown') continue
    if (severityRank(service.severity) > severityRank(overall)) overall = service.severity
  }

  return {
    services,
    overall,
    incomplete: services.some((service) => service.severity === 'unknown'),
    checkedAt: now.toISOString()
  }
}

export async function fetchStatusPayload(): Promise<StatusPayload> {
  const settled = await Promise.allSettled(STATUS_PROVIDERS.map((provider) => provider.load()))
  return assembleStatusPayload(settled, new Date())
}

/** Payload of last resort for the route's catch: every row unknown, but
 *  still a valid StatusPayload — the page renders "watch incomplete"
 *  instead of a 500. */
export function unknownStatusPayload(now: Date): StatusPayload {
  return assembleStatusPayload([], now)
}
