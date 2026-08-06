import { describe, expect, it } from 'vitest'

import { listTrackedAiDomains } from './aiDomains'
import {
  TOOL_CATEGORIES,
  TOOL_TAXONOMY,
  UNKNOWN_TAXONOMY,
  resolveToolTaxonomy
} from './toolTaxonomy'

// The taxonomy feeds daily_tool_aggregates (vendor/category slices) and the
// tool_taxonomy seed in migration 032. These tests pin it to the tracked
// allowlist in both directions: a domain added to aiDomains.ts without a
// taxonomy entry fails here (it would silently aggregate as Unknown/other),
// and a stale taxonomy entry for a de-listed domain fails too.

describe('TOOL_TAXONOMY coverage', () => {
  it('has an explicit entry for every tracked domain — no fallback', () => {
    const missing = listTrackedAiDomains().filter(
      (domain) => !(domain in TOOL_TAXONOMY)
    )
    expect(missing).toEqual([])
  })

  it('carries no entries for domains outside the allowlist', () => {
    const tracked = new Set(listTrackedAiDomains())
    const stale = Object.keys(TOOL_TAXONOMY).filter(
      (domain) => !tracked.has(domain)
    )
    expect(stale).toEqual([])
  })

  it('every entry has a non-empty vendor and a known category', () => {
    const categories = new Set<string>(TOOL_CATEGORIES)
    for (const [domain, entry] of Object.entries(TOOL_TAXONOMY)) {
      expect(entry.vendor.trim(), domain).not.toBe('')
      expect(entry.vendor, domain).not.toBe(UNKNOWN_TAXONOMY.vendor)
      expect(categories.has(entry.category), domain).toBe(true)
    }
  })
})

describe('resolveToolTaxonomy', () => {
  it('resolves canonical domains exactly', () => {
    expect(resolveToolTaxonomy('claude.ai')).toEqual({
      vendor: 'Anthropic',
      category: 'chat'
    })
    expect(resolveToolTaxonomy('bolt.new')).toEqual({
      vendor: 'StackBlitz',
      category: 'coding'
    })
  })

  it('strips www. and walks up parent domains like the ingest resolver', () => {
    expect(resolveToolTaxonomy('www.kimi.com')).toEqual(
      TOOL_TAXONOMY['kimi.com']
    )
    expect(resolveToolTaxonomy('chat.z.ai')).toEqual(TOOL_TAXONOMY['z.ai'])
  })

  it('falls back to Unknown/other for untracked, legacy, and empty input', () => {
    for (const domain of ['anthropic.com', 'example.com', '', null, undefined]) {
      expect(resolveToolTaxonomy(domain)).toEqual(UNKNOWN_TAXONOMY)
    }
  })
})
