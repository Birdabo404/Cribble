import { describe, expect, it } from 'vitest'
import { buildChatgptFromProxy, buildChatgptFromShim } from './openai'
import proxySummary from './__fixtures__/openai-proxy-summary.json'
import proxySummaryDegraded from './__fixtures__/openai-proxy-summary-degraded.json'
import proxyIncidents from './__fixtures__/openai-proxy-incidents.json'
import shimSummary from './__fixtures__/openai-v2-summary.json'
import shimIncidents from './__fixtures__/openai-v2-incidents.json'

// Fixtures captured live from status.openai.com on 2026-08-17. The proxy
// structure carries five groups (APIs, ChatGPT, Codex, FedRAMP, Ads
// Platform); the row must only ever surface the ChatGPT one. The
// degraded summary grafts a real history incident into ongoing_incidents
// (resolved markers removed) since the live capture was all-clear. The
// shim fixtures show why it is only a fallback: flat components with no
// group fields, incidents with impacts flattened to minor/none.

const NOW = new Date('2026-08-17T15:30:00.000Z')

describe('buildChatgptFromProxy', () => {
  it('surfaces only the ChatGPT group, all-clear when nothing is ongoing', () => {
    const status = buildChatgptFromProxy(proxySummary, proxyIncidents, NOW)!

    expect(status).not.toBeNull()
    expect(status.id).toBe('chatgpt')
    expect(status.severity).toBe('operational')
    expect(status.description).toBe('All ChatGPT components operational')
    expect(status.components.map((component) => component.name)).toEqual([
      'Conversations',
      'Login',
      'Voice mode',
      'Image Generation'
    ])
    expect(status.components.every((component) => component.severity === 'operational')).toBe(true)
    // No APIs / Codex / FedRAMP / Ads Platform bleed-through.
    expect(status.components.map((component) => component.name)).not.toContain('Chat Completions')
  })

  it('reconstructs the bar from ChatGPT incidents only', () => {
    const status = buildChatgptFromProxy(proxySummary, proxyIncidents, NOW)!
    const byDate = new Map(status.days!.map((day) => [day.date, day]))

    expect(status.days).toHaveLength(90)
    // Conversations degraded_performance on the 13th → ice.
    expect(byDate.get('2026-08-13')!.severity).toBe('degraded')
    expect(byDate.get('2026-08-13')!.incident).toBe(
      'Elevated errors in ChatGPT conversations for Free users'
    )
    // Voice mode full_outage on July 15th → ember.
    expect(byDate.get('2026-07-15')!.severity).toBe('outage')
    // The Ads Manager incident on the 11th belongs to another group.
    expect(byDate.get('2026-08-11')!.severity).toBe('operational')
    expect(status.quietRatio).toBeCloseTo(88 / 90, 10)
  })

  it('turns an ongoing ChatGPT incident into a degraded row and component', () => {
    const status = buildChatgptFromProxy(proxySummaryDegraded, null, NOW)!

    expect(status.severity).toBe('degraded')
    expect(status.description).toBe('Elevated errors in ChatGPT conversations for Free users')
    const conversations = status.components.find((component) => component.name === 'Conversations')
    expect(conversations!.severity).toBe('degraded')
    // History was unreachable in this pass — no invented bar.
    expect(status.days).toBeUndefined()
  })

  it('returns null on shape drift so the caller can fall back to the shim', () => {
    expect(buildChatgptFromProxy({}, null, NOW)).toBeNull()
    expect(buildChatgptFromProxy({ summary: { structure: { items: [] } } }, null, NOW)).toBeNull()
  })
})

describe('buildChatgptFromShim', () => {
  it('builds an honestly-labelled page-wide row without inventing components', () => {
    const status = buildChatgptFromShim(shimSummary, shimIncidents, NOW)

    expect(status.severity).toBe('operational')
    expect(status.description).toBe('All Systems Operational (OpenAI page-wide)')
    // The shim has no group data — an empty list beats passing 25
    // OpenAI-wide components off as ChatGPT's.
    expect(status.components).toEqual([])

    const byDate = new Map(status.days!.map((day) => [day.date, day]))
    expect(byDate.get('2026-08-13')!.severity).toBe('degraded')
    expect(status.quietRatio).toBeCloseTo(89 / 90, 10)
  })
})
