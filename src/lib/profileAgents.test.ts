import { describe, expect, it } from 'vitest'
import { buildProfileAgents, type AgentProfileRow } from './profileAgents'
import { tokenAgentLabel } from './tokenLeaderboard'

function agentRow(overrides: Partial<AgentProfileRow> = {}): AgentProfileRow {
  return {
    total_tokens: '10000000',
    cost_usd: '18.25',
    active_days: 4,
    agent_breakdown: [
      { name: 'claude-code', totalTokens: '7000000' },
      { name: 'cursor', totalTokens: '3000000' }
    ],
    agent_breakdown_complete: true,
    ...overrides
  }
}

describe('buildProfileAgents', () => {
  it('orders agents by tokens and computes whole-number shares', () => {
    expect(buildProfileAgents(agentRow())).toEqual([
      { name: 'claude-code', totalTokens: '7000000', percent: 70 },
      { name: 'cursor', totalTokens: '3000000', percent: 30 }
    ])
  })

  it('keeps bigint-sized token strings exact and still lands the percent', () => {
    // 2^53 and 2^53+1 — indistinguishable after a Number round trip, so
    // both the passthrough strings and the shares prove the math never
    // left exact-string arithmetic.
    const agents = buildProfileAgents(
      agentRow({
        total_tokens: '18014398509481985',
        agent_breakdown: [
          { name: 'codex', totalTokens: '9007199254740993' },
          { name: 'cursor', totalTokens: '9007199254740992' }
        ]
      })
    )

    expect(agents.map((agent) => agent.totalTokens)).toEqual([
      '9007199254740993',
      '9007199254740992'
    ])
    expect(agents.map((agent) => agent.percent)).toEqual([50, 50])
  })

  it('carries raw collector ids that resolve to display labels', () => {
    const agents = buildProfileAgents(
      agentRow({
        agent_breakdown: [
          { name: 'claude-code', totalTokens: '5000000' },
          { name: 'gemini-cli', totalTokens: '3000000' },
          { name: 'my-new-agent', totalTokens: '2000000' }
        ]
      })
    )

    expect(agents.map((agent) => tokenAgentLabel(agent.name))).toEqual([
      'Claude Code',
      'Gemini CLI',
      'My New Agent'
    ])
  })

  it('caps the list at three by token weight', () => {
    const agents = buildProfileAgents(
      agentRow({
        agent_breakdown: [
          { name: 'opencode', totalTokens: '1000000' },
          { name: 'claude-code', totalTokens: '4000000' },
          { name: 'cursor', totalTokens: '3000000' },
          { name: 'codex', totalTokens: '2000000' }
        ]
      })
    )

    expect(agents.map((agent) => agent.name)).toEqual(['claude-code', 'cursor', 'codex'])
  })

  it('returns an empty list for a missing row or empty breakdown', () => {
    expect(buildProfileAgents(null)).toEqual([])
    expect(buildProfileAgents(agentRow({ agent_breakdown: [] }))).toEqual([])
    expect(buildProfileAgents(agentRow({ agent_breakdown: null }))).toEqual([])
  })

  it('drops malformed breakdown entries and survives a zero total', () => {
    const agents = buildProfileAgents(
      agentRow({
        total_tokens: '0',
        agent_breakdown: [
          { name: '', totalTokens: '1000' },
          { totalTokens: '1000' },
          { name: 'cursor', totalTokens: '1000' }
        ]
      })
    )

    expect(agents).toEqual([{ name: 'cursor', totalTokens: '1000', percent: 0 }])
  })
})
