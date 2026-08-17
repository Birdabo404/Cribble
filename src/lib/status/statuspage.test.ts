import { describe, expect, it } from 'vitest'
import {
  CURSOR_SOURCE,
  GITHUB_SOURCE,
  ORIGIN_SOURCE,
  buildStatuspageStatus,
  parseStatuspageComponents,
  severityFromComponentStatus,
  severityFromIndicator
} from './statuspage'
import githubSummary from './__fixtures__/github-summary.json'
import githubIncidents from './__fixtures__/github-incidents.json'

// Fixtures captured live from githubstatus.com on 2026-08-17, mid-real-
// incident (indicator "major", API Requests in major_outage, an
// unresolved critical incident). GitHub publishes no group or
// only_show_if_degraded rows, so the fixture grafts three such rows in
// the exact Statuspage field layout to exercise the filters.

const NOW = new Date('2026-08-17T15:30:00.000Z')

describe('severityFromIndicator', () => {
  it('maps the four Statuspage indicators and rejects strangers', () => {
    expect(severityFromIndicator('none')).toBe('operational')
    expect(severityFromIndicator('minor')).toBe('degraded')
    expect(severityFromIndicator('major')).toBe('outage')
    expect(severityFromIndicator('critical')).toBe('outage')
    expect(severityFromIndicator('sideways')).toBe('unknown')
    expect(severityFromIndicator(undefined)).toBe('unknown')
  })
})

describe('severityFromComponentStatus', () => {
  it('maps component words including the incident.io outage spelling', () => {
    expect(severityFromComponentStatus('operational')).toBe('operational')
    expect(severityFromComponentStatus('degraded_performance')).toBe('degraded')
    expect(severityFromComponentStatus('partial_outage')).toBe('degraded')
    expect(severityFromComponentStatus('under_maintenance')).toBe('degraded')
    expect(severityFromComponentStatus('major_outage')).toBe('outage')
    expect(severityFromComponentStatus('full_outage')).toBe('outage')
    expect(severityFromComponentStatus('glowing')).toBe('unknown')
  })
})

describe('parseStatuspageComponents', () => {
  it('keeps real components and drops group rows, hidden-quiet rows and the GitHub info row', () => {
    const components = parseStatuspageComponents(githubSummary)
    expect(components).toEqual([
      { name: 'Git Operations', severity: 'operational' },
      { name: 'Webhooks', severity: 'degraded' },
      { name: 'API Requests', severity: 'outage' },
      // only_show_if_degraded stays visible once it is actually degraded…
      { name: 'Downstream DNS', severity: 'degraded' }
    ])
    // …while the quiet one, the group header and the "Visit … for more
    // information" pseudo-component are gone.
    const names = components.map((component) => component.name)
    expect(names).not.toContain('Downstream CDN')
    expect(names).not.toContain('Core Services')
  })
})

describe('buildStatuspageStatus', () => {
  it('assembles the row from live summary + incident history', () => {
    const status = buildStatuspageStatus(GITHUB_SOURCE, githubSummary, githubIncidents, NOW)

    expect(status.id).toBe('github')
    expect(status.severity).toBe('outage')
    expect(status.description).toBe('Partial System Outage')
    expect(status.sourceUrl).toBe('https://www.githubstatus.com')
    expect(status.components).toHaveLength(4)

    expect(status.days).toHaveLength(90)
    const byDate = new Map(status.days!.map((day) => [day.date, day]))
    // Unresolved critical incident from this morning extends to now.
    expect(byDate.get('2026-08-17')!.severity).toBe('outage')
    expect(byDate.get('2026-08-17')!.incident).toBe('Incident with GitHub.com')
    // Resolved major on the 12th, resolved minor on the 13th.
    expect(byDate.get('2026-08-12')!.severity).toBe('outage')
    expect(byDate.get('2026-08-13')!.severity).toBe('degraded')
    expect(status.quietRatio).toBeCloseTo(87 / 90, 10)
  })

  it('keeps the row but omits the bar when only the history fetch failed', () => {
    const status = buildStatuspageStatus(GITHUB_SOURCE, githubSummary, null, NOW)
    expect(status.severity).toBe('outage')
    expect(status.days).toBeUndefined()
    expect(status.quietRatio).toBeUndefined()
  })

  it('degrades to unknown severity on summary shape drift instead of throwing', () => {
    const status = buildStatuspageStatus(GITHUB_SOURCE, { unexpected: true }, null, NOW)
    expect(status.severity).toBe('unknown')
    expect(status.components).toEqual([])
  })
})

describe('component carve-outs (Origin on the Cursor page)', () => {
  // Shape mirrors status.cursor.com on 2026-08-17: flat components, one
  // unresolved major touching Origin + Automations, plus a resolved
  // Origin-only minor and a resolved unattributed minor.
  const summary = {
    status: { indicator: 'minor', description: 'Minor Service Outage' },
    components: [
      { name: 'Automations', status: 'partial_outage', group: false },
      { name: 'CLI', status: 'operational', group: false },
      { name: 'Origin', status: 'partial_outage', group: false },
      { name: 'IDE', status: 'operational', group: false }
    ]
  }
  const incidents = {
    incidents: [
      {
        name: 'GitHub degradation affecting some Cursor services',
        impact: 'major',
        created_at: '2026-08-17T14:34:00.000Z',
        resolved_at: null,
        components: [{ name: 'Automations' }, { name: 'Origin' }]
      },
      {
        name: 'Origin merge queue stalled',
        impact: 'minor',
        created_at: '2026-08-15T10:00:00.000Z',
        resolved_at: '2026-08-15T11:00:00.000Z',
        components: [{ name: 'Origin' }]
      },
      {
        name: 'Investigating elevated errors',
        impact: 'minor',
        created_at: '2026-08-10T10:00:00.000Z',
        resolved_at: '2026-08-10T12:00:00.000Z',
        components: []
      }
    ]
  }

  it("'only' keeps the carved component, its incidents and the open incident title", () => {
    const status = buildStatuspageStatus(ORIGIN_SOURCE, summary, incidents, NOW)

    expect(status.id).toBe('origin')
    expect(status.components).toEqual([{ name: 'Origin', severity: 'degraded' }])
    expect(status.severity).toBe('degraded')
    expect(status.description).toBe('GitHub degradation affecting some Cursor services')

    const byDate = new Map(status.days!.map((day) => [day.date, day]))
    expect(byDate.get('2026-08-17')!.severity).toBe('outage')
    expect(byDate.get('2026-08-15')!.severity).toBe('degraded')
    expect(byDate.get('2026-08-15')!.incident).toBe('Origin merge queue stalled')
    // The unattributed page-wide incident does not follow the carve-out.
    expect(byDate.get('2026-08-10')!.severity).toBe('operational')
  })

  it("'except' keeps the rest of the page plus unattributed incidents", () => {
    const status = buildStatuspageStatus(CURSOR_SOURCE, summary, incidents, NOW)

    expect(status.components.map((component) => component.name)).toEqual([
      'Automations',
      'CLI',
      'IDE'
    ])
    // Worst of its own components, not the page indicator (which blends
    // Origin's weather in).
    expect(status.severity).toBe('degraded')
    expect(status.description).toBe('GitHub degradation affecting some Cursor services')

    const byDate = new Map(status.days!.map((day) => [day.date, day]))
    expect(byDate.get('2026-08-17')!.severity).toBe('outage')
    // The Origin-only incident left with the carve-out…
    expect(byDate.get('2026-08-15')!.severity).toBe('operational')
    // …while the unattributed one stays page-wide.
    expect(byDate.get('2026-08-10')!.severity).toBe('degraded')
  })

  it('describes a quiet carve-out without borrowing the page-wide line', () => {
    const quietSummary = {
      status: { indicator: 'minor', description: 'Minor Service Outage' },
      components: [
        { name: 'Automations', status: 'partial_outage', group: false },
        { name: 'Origin', status: 'operational', group: false }
      ]
    }
    const status = buildStatuspageStatus(ORIGIN_SOURCE, quietSummary, { incidents: [] }, NOW)
    expect(status.severity).toBe('operational')
    expect(status.description).toBe('Origin operational')
    expect(status.quietRatio).toBe(1)
  })

  it("throws when the carved component is missing so the row reads unknown, not falsely clean", () => {
    const withoutOrigin = {
      status: { indicator: 'none', description: 'All Systems Operational' },
      components: [{ name: 'IDE', status: 'operational', group: false }]
    }
    expect(() => buildStatuspageStatus(ORIGIN_SOURCE, withoutOrigin, null, NOW)).toThrow(
      /No "Origin" component/
    )
  })
})
