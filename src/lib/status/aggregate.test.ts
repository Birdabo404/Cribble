import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceId, ServiceStatus, Severity } from './types'
import { STATUS_PROVIDERS, assembleStatusPayload, unknownStatusPayload } from './aggregate'

// The rollup is pure once the fetching is settled — these tests feed it
// fabricated settled results in provider order and check worst-of,
// unknown handling, the incomplete flag, and the all-feeds-down floor.

const NOW = new Date('2026-08-17T15:30:00.000Z')
const ORDER: ServiceId[] = ['origin', 'github', 'chatgpt', 'claude', 'cursor', 'grok', 'cribble']

const row = (id: ServiceId, severity: Severity): ServiceStatus => ({
  id,
  name: id,
  severity,
  description: 'fixture row',
  sourceUrl: 'https://example.com',
  fetchedAt: NOW.toISOString(),
  components: []
})

const ok = (value: ServiceStatus): PromiseSettledResult<ServiceStatus> => ({
  status: 'fulfilled',
  value
})

const down = (): PromiseSettledResult<ServiceStatus> => ({
  status: 'rejected',
  reason: new Error('feed unreachable')
})

const allOk = (severities: Partial<Record<ServiceId, Severity>> = {}) =>
  ORDER.map((id) => ok(row(id, severities[id] ?? 'operational')))

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('assembleStatusPayload', () => {
  it('keeps the contract service order', () => {
    expect(STATUS_PROVIDERS.map((provider) => provider.id)).toEqual(ORDER)
    const payload = assembleStatusPayload(allOk(), NOW)
    expect(payload.services.map((service) => service.id)).toEqual(ORDER)
    expect(payload.overall).toBe('operational')
    expect(payload.incomplete).toBe(false)
    expect(payload.checkedAt).toBe(NOW.toISOString())
  })

  it('rolls overall up to the worst readable severity', () => {
    expect(assembleStatusPayload(allOk({ cursor: 'degraded' }), NOW).overall).toBe('degraded')
    expect(assembleStatusPayload(allOk({ cursor: 'degraded', github: 'outage' }), NOW).overall).toBe(
      'outage'
    )
  })

  it('turns a rejected feed into an honest unknown row and flags incomplete', () => {
    const settled = allOk({ github: 'degraded' })
    settled[5] = down() // grok
    const payload = assembleStatusPayload(settled, NOW)

    const grok = payload.services[5]
    expect(grok.id).toBe('grok')
    expect(grok.severity).toBe('unknown')
    expect(grok.description).toBe('Could not reach the Grok status feed this pass')
    expect(grok.sourceUrl).toBe('https://status.x.ai')
    expect(grok.components).toEqual([])

    expect(payload.incomplete).toBe(true)
    // The unknown row never drags overall around — degraded still wins.
    expect(payload.overall).toBe('degraded')
  })

  it('flags incomplete for a fulfilled row that is itself unknown', () => {
    // e.g. Cribble's database probe in an env without service-role keys.
    const payload = assembleStatusPayload(allOk({ cribble: 'unknown' }), NOW)
    expect(payload.incomplete).toBe(true)
    expect(payload.overall).toBe('operational')
  })

  it('floors at overall operational + incomplete when every feed is down', () => {
    const payload = assembleStatusPayload(ORDER.map(() => down()), NOW)
    expect(payload.services).toHaveLength(7)
    expect(payload.services.every((service) => service.severity === 'unknown')).toBe(true)
    expect(payload.overall).toBe('operational')
    expect(payload.incomplete).toBe(true)
  })
})

describe('unknownStatusPayload', () => {
  it('builds the same all-unknown floor for the route catch path', () => {
    const payload = unknownStatusPayload(NOW)
    expect(payload.services.map((service) => service.id)).toEqual(ORDER)
    expect(payload.services.every((service) => service.severity === 'unknown')).toBe(true)
    expect(payload.overall).toBe('operational')
    expect(payload.incomplete).toBe(true)
  })
})
