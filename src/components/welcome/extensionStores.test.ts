import { describe, expect, it } from 'vitest'
import {
  SIGNAL_GRID_SIZE,
  signalSurfaces,
  storeSublabel
} from './extensionStores'

const CHROME = { family: 'chrome' as const, storeName: 'Chrome Web Store' }
const FIREFOX = { family: 'firefox' as const, storeName: 'Firefox Add-ons' }

describe('storeSublabel', () => {
  it('names the store alone on Google Chrome itself', () => {
    expect(storeSublabel(CHROME, null)).toBe('Chrome Web Store')
  })

  it('puts the running fork first', () => {
    expect(storeSublabel(CHROME, 'Edge')).toBe(
      'Chrome Web Store · works in Edge, Brave, Arc'
    )
    expect(storeSublabel(CHROME, 'Brave')).toBe(
      'Chrome Web Store · works in Brave, Edge, Arc'
    )
  })

  it('names an unlisted fork without repeating the listed ones', () => {
    expect(storeSublabel(CHROME, 'Opera')).toBe(
      'Chrome Web Store · works in Opera, Brave, Edge'
    )
  })

  it('leaves the Firefox card alone whatever the fork says', () => {
    expect(storeSublabel(FIREFOX, 'Brave')).toBe('Firefox Add-ons')
  })
})

describe('signalSurfaces', () => {
  it('fills six from the fallback list when the loadout is empty', () => {
    const ids = signalSurfaces([]).map((s) => s.id)
    expect(ids).toEqual([
      'chatgpt',
      'claude',
      'gemini',
      'perplexity',
      'grok',
      'deepseek'
    ])
  })

  it('leads with the picked tools, in pick order, then tops up', () => {
    const ids = signalSurfaces(['grok', 'lovable']).map((s) => s.id)
    expect(ids).toEqual(['grok', 'lovable', 'chatgpt', 'claude', 'gemini', 'perplexity'])
    expect(ids).toHaveLength(SIGNAL_GRID_SIZE)
  })

  it('skips tools with no browser surface and never repeats one', () => {
    const ids = signalSurfaces(['cursor', 'claude-code', 'codex', 'claude', 'other']).map(
      (s) => s.id
    )
    expect(ids).toEqual(['claude', 'chatgpt', 'gemini', 'perplexity', 'grok', 'deepseek'])
  })

  it('opens every surface in a new tab at a real host', () => {
    for (const surface of signalSurfaces(['copilot', 'v0', 'bolt', 'replit', 'midjourney'])) {
      expect(surface.href.startsWith('https://')).toBe(true)
      expect(surface.href).toContain(surface.host.split('/')[0])
    }
  })
})
