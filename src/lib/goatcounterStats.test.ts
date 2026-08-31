import { describe, expect, it } from 'vitest'
import {
  TRACKER_MAX_HTML_BYTES,
  TRACKER_MAX_PAGES,
  parseGoatcounterDashboard
} from './goatcounterStats'

const SAMPLE = `
<span class="hide js-total">2\u00a0199</span>
<table class="count-list count-list-pages">
<tr id="/" data-id="1" data-count="977" class=" ">
<tr id="/leaderboard" data-id="2" data-count="527" class=" ">
<tr id="/welcome" data-id="3" data-count="100" class=" ">
</table>
`

describe('parseGoatcounterDashboard', () => {
  it('reads the versioned snapshot from public dashboard HTML', () => {
    expect(parseGoatcounterDashboard(SAMPLE)).toEqual({
      schemaVersion: 1,
      periodVisits: 2199,
      pagesShown: 3,
      pages: [
        { path: '/', count: 977 },
        { path: '/leaderboard', count: 527 },
        { path: '/welcome', count: 100 }
      ]
    })
  })

  it('caps pages at TRACKER_MAX_PAGES', () => {
    const rows = Array.from({ length: TRACKER_MAX_PAGES + 5 }, (_, i) => {
      return `<tr id="/p${i}" data-id="${i}" data-count="${i + 1}" class=" ">`
    }).join('\n')
    const html = `<span class="hide js-total">99</span>${rows}`
    const parsed = parseGoatcounterDashboard(html)
    expect(parsed?.pagesShown).toBe(TRACKER_MAX_PAGES)
    expect(parsed?.pages).toHaveLength(TRACKER_MAX_PAGES)
  })

  it('fails closed on missing totals, empty pages, or oversized HTML', () => {
    expect(parseGoatcounterDashboard('<tr id="/" data-id="1" data-count="1" class=" ">')).toBeNull()
    expect(parseGoatcounterDashboard('<span class="hide js-total">12</span>')).toBeNull()
    expect(
      parseGoatcounterDashboard(
        `<span class="hide js-total">1</span>${'x'.repeat(TRACKER_MAX_HTML_BYTES)}`
      )
    ).toBeNull()
  })

  it('skips unsafe paths instead of guessing them into the snapshot', () => {
    const html = `
      <span class="hide js-total">3</span>
      <tr id="javascript:alert(1)" data-id="1" data-count="9" class=" ">
      <tr id="/ok" data-id="2" data-count="3" class=" ">
    `
    expect(parseGoatcounterDashboard(html)).toEqual({
      schemaVersion: 1,
      periodVisits: 3,
      pagesShown: 1,
      pages: [{ path: '/ok', count: 3 }]
    })
  })
})
