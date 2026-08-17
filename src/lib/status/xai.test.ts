import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildXaiStatus, parseXaiFeed } from './xai'

// The real feed.xml captured 2026-08-17 (trimmed to two items). Notably
// the live feed's lastBuildDate was six weeks old at capture time —
// everything in it resolved — so the unresolved cases below are crafted
// by string surgery on the real item markup.

const REAL_FEED = readFileSync(new URL('./__fixtures__/xai-feed.xml', import.meta.url), 'utf8')

const NOW = new Date('2026-08-17T15:30:00.000Z')

const feedWith = (items: string) => `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"><channel><title>xAI System Status</title>${items}</channel></rss>`

const openItem = (severity: string, pubDate: string) => `<item>
  <title>[API (us-east-1.api.x.ai)] Grok responses failing</title>
  <guid isPermaLink="false">INCfixture1</guid>
  <description><![CDATA[
    <h3>Status: ONGOING</h3>
    <p>Severity: ${severity}</p>
    <p>We are currently investigating the issue.</p>
  ]]></description>
  <pubDate>${pubDate}</pubDate>
  <category>${severity}</category>
</item>`

describe('parseXaiFeed', () => {
  it('extracts items with dates, resolution markers and severity words', () => {
    const items = parseXaiFeed(REAL_FEED)!
    expect(items).toHaveLength(2)
    expect(items[0].title).toContain('Imagine Video 1.5')
    expect(items[0].resolved).toBe(true)
    expect(items[0].severityWord).toBe('available')
    expect(items[0].startedAt).toBe('2026-07-07T15:40:26.000Z')
    expect(items[0].resolvedAt).toBe('2026-07-07T16:37:02.000Z')
  })

  it('returns null for non-RSS payloads', () => {
    expect(parseXaiFeed('<html>403 blocked</html>')).toBeNull()
    expect(parseXaiFeed('')).toBeNull()
  })
})

describe('buildXaiStatus', () => {
  it('reads the real all-resolved feed as operational with a painted bar', () => {
    const status = buildXaiStatus(REAL_FEED, NOW)

    expect(status.id).toBe('grok')
    expect(status.severity).toBe('operational')
    expect(status.description).toBe('No unresolved incidents in the published feed')
    // RSS carries history, not live component states.
    expect(status.components).toEqual([])

    expect(status.days).toHaveLength(90)
    const byDate = new Map(status.days!.map((day) => [day.date, day]))
    expect(byDate.get('2026-07-07')!.severity).toBe('degraded')
    expect(byDate.get('2026-07-07')!.incident).toContain('Imagine Video 1.5')
    expect(status.quietRatio).toBeCloseTo(89 / 90, 10)
  })

  it('reads a recent unresolved disruption as degraded', () => {
    const status = buildXaiStatus(feedWith(openItem('disruption', 'Sat, 15 Aug 2026 10:00:00 GMT')), NOW)
    expect(status.severity).toBe('degraded')
    expect(status.description).toContain('Grok responses failing')
    // The open incident extends to now on the bar.
    const byDate = new Map(status.days!.map((day) => [day.date, day]))
    expect(byDate.get('2026-08-17')!.severity).toBe('degraded')
  })

  it('reads a recent unresolved outage as an outage', () => {
    const status = buildXaiStatus(feedWith(openItem('outage', 'Sat, 15 Aug 2026 10:00:00 GMT')), NOW)
    expect(status.severity).toBe('outage')
  })

  it('treats a stale unresolved item as feed noise, not a live incident', () => {
    const status = buildXaiStatus(feedWith(openItem('disruption', 'Tue, 07 Jul 2026 10:00:00 GMT')), NOW)
    expect(status.severity).toBe('operational')
    // …and its bar footprint collapses to the start day instead of
    // smearing degraded from July to today.
    const byDate = new Map(status.days!.map((day) => [day.date, day]))
    expect(byDate.get('2026-07-07')!.severity).toBe('degraded')
    expect(byDate.get('2026-07-08')!.severity).toBe('operational')
  })

  it('degrades to unknown with no bar when the feed is unparseable', () => {
    const status = buildXaiStatus('<html>blocked</html>', NOW)
    expect(status.severity).toBe('unknown')
    expect(status.description).toBe('Could not parse the xAI status feed')
    expect(status.days).toBeUndefined()
    expect(status.quietRatio).toBeUndefined()
  })

  it('reads a valid feed with zero items as quiet, not unknown', () => {
    const status = buildXaiStatus(feedWith(''), NOW)
    expect(status.severity).toBe('operational')
    expect(status.days).toHaveLength(90)
    expect(status.quietRatio).toBe(1)
  })
})
