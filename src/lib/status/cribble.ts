import { resolveShareOrigin } from '@/lib/appUrl'
import { checkDatabaseHealth, isDatabaseConfigured } from '@/lib/supabaseAdmin'
import type { ServiceComponent, ServiceStatus, Severity } from './types'
import { fetchFeed, fetchJson } from './http'
import { asRecord } from './statuspage'

// The Cribble row is live probes only — Web, API, Database — never a
// reconstructed history bar. We are the vendor here, and inventing a
// 90-day record from nothing would be exactly the dishonesty the vendor
// bars avoid by using published incidents.

async function probeWeb(origin: string): Promise<boolean> {
  try {
    await fetchFeed(origin, 'text/html')
    return true
  } catch {
    return false
  }
}

/** /api/season is already public, cheap and force-dynamic — a perfect
 *  canary for the API surface. Expect 200 + `success: true`. */
async function probeApi(origin: string): Promise<boolean> {
  try {
    const body = await fetchJson(`${origin}/api/season`)
    return asRecord(body)?.success === true
  } catch {
    return false
  }
}

async function probeDatabase(): Promise<ServiceComponent> {
  // No service-role env (local dev, preview without secrets) means "we
  // can't see the database from here" — unknown, not an outage.
  if (!isDatabaseConfigured()) return { name: 'Database', severity: 'unknown' }
  const healthy = await checkDatabaseHealth()
  return { name: 'Database', severity: healthy ? 'operational' : 'outage' }
}

/** One component down is a degradation, two or more is an outage; a row
 *  with nothing down but something unverifiable stays unknown. */
export function cribbleSeverity(components: ServiceComponent[]): Severity {
  const down = components.filter((component) => component.severity === 'outage').length
  if (down >= 2) return 'outage'
  if (down === 1) return 'degraded'
  if (components.some((component) => component.severity === 'unknown')) return 'unknown'
  return 'operational'
}

function describeCribble(components: ServiceComponent[], severity: Severity): string {
  const named = (want: Severity) =>
    components
      .filter((component) => component.severity === want)
      .map((component) => component.name)
      .join(' + ')
  switch (severity) {
    case 'operational':
      return 'Web, API and database answering live probes'
    case 'degraded':
      return `${named('outage')} probe failing`
    case 'outage':
      return `${named('outage')} probes failing`
    case 'unknown':
      return `${named('unknown')} unverifiable from this environment`
    default: {
      const exhausted: never = severity
      return exhausted
    }
  }
}

export async function fetchCribbleStatus(): Promise<ServiceStatus> {
  const origin = resolveShareOrigin()
  const [webUp, apiUp, database] = await Promise.all([
    probeWeb(origin),
    probeApi(origin),
    probeDatabase()
  ])

  const components: ServiceComponent[] = [
    { name: 'Web', severity: webUp ? 'operational' : 'outage' },
    { name: 'API', severity: apiUp ? 'operational' : 'outage' },
    database
  ]
  const severity = cribbleSeverity(components)

  return {
    id: 'cribble',
    name: 'Cribble',
    severity,
    description: describeCribble(components, severity),
    sourceUrl: origin,
    fetchedAt: new Date().toISOString(),
    components
  }
}
