import { describe, expect, it } from 'vitest'
import {
  LOCAL_PREVIEW_PULSE,
  nextArenaStatsPhase,
  parseVisitorPulseJson,
  visitorPulseResponse
} from './visitorPulse'

describe('parseVisitorPulseJson', () => {
  it('accepts a successful pulse', () => {
    expect(parseVisitorPulseJson({ success: true, live: 3, last12h: 41 })).toEqual({
      live: 3,
      last12h: 41
    })
  })

  it('accepts zeros', () => {
    expect(parseVisitorPulseJson({ success: true, live: 0, last12h: 0 })).toEqual({
      live: 0,
      last12h: 0
    })
  })

  it('rejects unconfigured or partial payloads (the empty localhost bug)', () => {
    expect(parseVisitorPulseJson({ success: false, configured: false })).toBeNull()
    expect(parseVisitorPulseJson({ success: true, live: 1 })).toBeNull()
    expect(parseVisitorPulseJson(null)).toBeNull()
  })
})

describe('visitorPulseResponse', () => {
  it('serves the local preview pulse when analytics DB is not configured', () => {
    expect(visitorPulseResponse({ configured: false, pulse: null })).toEqual({
      success: true,
      ...LOCAL_PREVIEW_PULSE,
      source: 'local-preview'
    })
  })

  it('fails closed when configured but RPC is empty', () => {
    expect(visitorPulseResponse({ configured: true, pulse: null })).toEqual({
      success: false,
      configured: true
    })
  })

  it('passes through a real RPC pulse', () => {
    expect(visitorPulseResponse({ configured: true, pulse: { live: 4, last12h: 12 } })).toEqual({
      success: true,
      live: 4,
      last12h: 12,
      source: 'rpc'
    })
  })
})

describe('nextArenaStatsPhase', () => {
  it('opens from the compact ticker, dismisses into reverse, then settles closed', () => {
    expect(nextArenaStatsPhase('closed', 'open')).toBe('open')
    expect(nextArenaStatsPhase('open', 'dismiss')).toBe('closing')
    expect(nextArenaStatsPhase('closing', 'settled')).toBe('closed')
  })

  it('ignores dismiss while already closed and open while already open', () => {
    expect(nextArenaStatsPhase('closed', 'dismiss')).toBe('closed')
    expect(nextArenaStatsPhase('open', 'open')).toBe('open')
    expect(nextArenaStatsPhase('closing', 'open')).toBe('closing')
  })
})
