import { describe, expect, it } from 'vitest'
import {
  TRACKER_MAX_HTML_BYTES,
  TRACKER_MAX_PAGES,
  parseGoatcounterDashboard,
  parseTrackerApiSnapshot,
  readResponseTextBounded
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

  it('fails closed on malformed totals instead of stripping arbitrary characters', () => {
    const html = `
      <span class="hide js-total">12oops3</span>
      <tr id="/ok" data-id="2" data-count="3" class=" ">
    `
    expect(parseGoatcounterDashboard(html)).toBeNull()
  })

  it('redacts query, fragment, and invite-code data before aggregation', () => {
    const html = `
      <span class="hide js-total">31</span>
      <tr id="/login?invite=CRIB-secret" data-id="1" data-count="12" class=" ">
      <tr id="/login?error=oauth_denied#retry" data-id="2" data-count="3" class=" ">
      <tr id="/join/CRIB-AAAA-BBBB" data-id="3" data-count="9" class=" ">
      <tr id="/join/CRIB-CCCC-DDDD" data-id="4" data-count="7" class=" ">
    `
    expect(parseGoatcounterDashboard(html)).toEqual({
      schemaVersion: 1,
      periodVisits: 31,
      pagesShown: 2,
      pages: [
        { path: '/join/[code]', count: 16 },
        { path: '/login', count: 15 }
      ]
    })
  })

  it('fails the snapshot when any path row is unsafe', () => {
    const html = `
      <span class="hide js-total">12</span>
      <tr id="not-a-path" data-id="1" data-count="9"></tr>
      <tr id="/ok" data-id="2" data-count="3"></tr>
    `

    expect(parseGoatcounterDashboard(html)).toBeNull()
  })

  it('fails on a partially malformed path table instead of returning partial data', () => {
    const html = `
      <span class="hide js-total">12</span>
      <tr id="/ok" data-id="1" data-count="9"></tr>
      <tr id="/drifted" data-id="2" data-total="3"></tr>
    `

    expect(parseGoatcounterDashboard(html)).toBeNull()
  })
})

describe('parseTrackerApiSnapshot', () => {
  const valid = {
    success: true,
    schemaVersion: 1,
    periodVisits: 20,
    pagesShown: 2,
    pages: [
      { path: '/', count: 12 },
      { path: '/leaderboard', count: 8 }
    ]
  }

  it('accepts the exact versioned snapshot contract', () => {
    expect(parseTrackerApiSnapshot(valid)).toEqual({
      schemaVersion: 1,
      periodVisits: 20,
      pagesShown: 2,
      pages: valid.pages
    })
  })

  it('rejects partial rows instead of silently presenting a partial snapshot', () => {
    expect(
      parseTrackerApiSnapshot({
        ...valid,
        pages: [...valid.pages, { path: '/broken', count: '9' }],
        pagesShown: 3
      })
    ).toBeNull()
  })

  it('rejects unredacted query data at the client boundary', () => {
    expect(
      parseTrackerApiSnapshot({
        ...valid,
        pages: [{ path: '/login?invite=secret', count: 2 }],
        pagesShown: 1
      })
    ).toBeNull()
  })
})

describe('readResponseTextBounded', () => {
  it('reads a chunked response without relying on Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello '))
        controller.enqueue(new TextEncoder().encode('world'))
        controller.close()
      }
    })

    await expect(readResponseTextBounded(new Response(stream), 11)).resolves.toBe('hello world')
  })

  it('rejects a chunked response as soon as decoded bytes cross the cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('1234'))
        controller.enqueue(new TextEncoder().encode('56'))
        controller.close()
      }
    })

    await expect(readResponseTextBounded(new Response(stream), 5)).rejects.toThrow(
      'Tracker payload too large'
    )
  })

  it('applies the cap to UTF-8 bytes rather than JavaScript characters', async () => {
    await expect(readResponseTextBounded(new Response('ééé'), 5)).rejects.toThrow(
      'Tracker payload too large'
    )
  })

  it('rejects an advertised oversized response before reading its body', async () => {
    const response = new Response('small', { headers: { 'content-length': '999' } })
    await expect(readResponseTextBounded(response, 10)).rejects.toThrow('Tracker payload too large')
  })
})
