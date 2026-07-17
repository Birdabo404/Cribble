import { describe, expect, it } from 'vitest'
import { rankToolsFromEvents } from './topTools'
import type { ScoreEventWithTimestamp } from './scoring'

const T0 = Date.parse('2026-07-02T10:00:00.000Z')

const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

/** A 5s activity heartbeat, the row shape the extension actually produces. */
const heartbeat = (
  offsetMs: number,
  domain: string,
  activeMs = 5_000
): ScoreEventWithTimestamp => ({
  timestamp: iso(offsetMs),
  domain,
  active_ms: activeMs,
  total_ms: activeMs,
  visits: 0
})

/** A visit marker; active/total hold unverified wall-clock page time. */
const visit = (
  offsetMs: number,
  domain: string,
  wallMs = 2_000
): ScoreEventWithTimestamp => ({
  timestamp: iso(offsetMs),
  domain,
  active_ms: wallMs,
  total_ms: wallMs,
  visits: 1
})

/** n heartbeats every 5s starting at offsetMs. */
const heartbeatRun = (offsetMs: number, n: number, domain: string) =>
  Array.from({ length: n }, (_, i) => heartbeat(offsetMs + i * 5_000, domain))

describe('rankToolsFromEvents', () => {
  it('ranks by score contribution, not visit count', () => {
    // The dashboard/leaderboard mismatch: many short cursor.com visits
    // (visits pay a flat 40 pts) vs one long verified Claude work session.
    // Visit-count ranking crowned Cursor; score ranking must crown Claude.
    const cursorVisits = Array.from({ length: 10 }, (_, i) =>
      visit(i * 60_000, 'cursor.com')
    )
    // 30 min of heartbeats ≈ 1800s ≈ 1800 base pts before multipliers.
    const claudeSession = heartbeatRun(0, 360, 'claude.ai')

    const ranked = rankToolsFromEvents([...cursorVisits, ...claudeSession])

    expect(ranked.map((t) => t.name)).toEqual(['Claude', 'Cursor'])
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    expect(ranked[0].visits).toBe(0)
    expect(ranked[1].visits).toBe(10)
  })

  it('merges domains that resolve to the same tool', () => {
    const ranked = rankToolsFromEvents([
      ...heartbeatRun(0, 12, 'chatgpt.com'),
      ...heartbeatRun(120_000, 12, 'chat.openai.com')
    ])

    expect(ranked).toHaveLength(1)
    expect(ranked[0].name).toBe('ChatGPT')
    expect(ranked[0].active_ms).toBe(24 * 5_000)
  })

  it('normalizes legacy rows: heartbeats are not visits, visit rows carry no active time', () => {
    const ranked = rankToolsFromEvents([
      heartbeat(0, 'claude.ai', 5_000),
      { timestamp: iso(5_000), domain: 'claude.ai', active_ms: 1_716_000, visits: 1 }
    ])

    expect(ranked[0].visits).toBe(1)
    expect(ranked[0].active_ms).toBe(5_000)
  })

  it('drops events with a blank domain', () => {
    const ranked = rankToolsFromEvents([
      visit(0, ''),
      visit(1_000, 'cursor.com')
    ])

    expect(ranked.map((t) => t.name)).toEqual(['Cursor'])
  })

  it('breaks score ties by visits', () => {
    const ranked = rankToolsFromEvents([
      // Perplexity: one 40s heartbeat at 0.8 focus → exactly 40 pts, 0 visits.
      {
        timestamp: iso(0),
        domain: 'perplexity.ai',
        active_ms: 40_000,
        total_ms: 50_000,
        visits: 0
      },
      // Poe: one visit → exactly 40 pts, 1 visit.
      visit(0, 'poe.com')
    ])

    expect(ranked.map((t) => t.score)).toEqual([40, 40])
    expect(ranked.map((t) => t.name)).toEqual(['Poe', 'Perplexity'])
  })

  it('computes percent as share of total score', () => {
    const ranked = rankToolsFromEvents([
      ...heartbeatRun(0, 360, 'claude.ai'),
      ...heartbeatRun(0, 360, 'cursor.com')
    ])

    expect(ranked).toHaveLength(2)
    expect(ranked[0].percent).toBe(50)
    expect(ranked[1].percent).toBe(50)
  })

  it('returns an empty list for no events', () => {
    expect(rankToolsFromEvents([])).toEqual([])
  })
})
