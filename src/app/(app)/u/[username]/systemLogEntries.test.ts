import { describe, expect, it } from 'vitest'
import type { HangarCard } from '@/lib/hangar/types'
import type { PublicProfileBadge } from '@/lib/publicProfile'
import {
  buildSystemLog,
  SYSTEM_LOG_LIMIT,
  type LogKind,
  type SystemLogInput
} from './systemLogEntries'

// The log is the RECORD pane's "what happened lately" strip. These pin
// the line vocabulary, newest-first order, the cap, and the tolerance
// for the ragged data a public profile can carry.

const NOW = new Date('2026-09-03T12:00:00.000Z')

const badge = (name: string, unlockedAt: string): PublicProfileBadge => ({
  id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  description: '',
  rarity: 'common',
  icon: 'flame',
  unlockedAt
})

const github = (
  owner: string,
  repo: string,
  pushedAt: string | null,
  inFlight = false
): HangarCard => ({
  kind: 'github',
  url: `https://github.com/${owner}/${repo}`,
  owner,
  repo,
  description: null,
  stars: 0,
  forks: 0,
  language: null,
  languageColor: null,
  pushedAt,
  archived: false,
  homepage: null,
  inFlight
})

const site = (host: string, title: string | null, inFlight = false): HangarCard => ({
  kind: 'site',
  url: `https://${host}`,
  host,
  title,
  description: null,
  icon: null,
  inFlight
})

const pending = (host: string, inFlight = false): HangarCard => ({
  kind: 'pending',
  url: `https://${host}`,
  host,
  inFlight
})

const base: SystemLogInput = {
  badges: [],
  hangar: [],
  memberSince: '2026-01-10T09:00:00.000Z',
  lastSeen: '2026-08-20T09:00:00.000Z',
  isActive: true
}

describe('buildSystemLog', () => {
  it('an active pilot with nothing else logs only ENLISTED', () => {
    expect(buildSystemLog(base, NOW)).toEqual([
      { at: '2026-01-10T09:00:00.000Z', kind: 'joined', text: 'ENLISTED' }
    ])
  })

  it('tolerates a payload without a hangar field (pre-068 Data Cache entry)', () => {
    const stale = { ...base, hangar: undefined } as unknown as SystemLogInput
    expect(buildSystemLog(stale, NOW)).toEqual([
      { at: '2026-01-10T09:00:00.000Z', kind: 'joined', text: 'ENLISTED' }
    ])
  })

  it('adds LAST SEEN only when the pilot is not active', () => {
    const inactive = buildSystemLog({ ...base, isActive: false }, NOW)
    expect(inactive.map((e) => e.kind)).toEqual(['seen', 'joined'])
    expect(inactive[0]).toEqual({
      at: '2026-08-20T09:00:00.000Z',
      kind: 'seen',
      text: 'LAST SEEN'
    })
    expect(buildSystemLog({ ...base, isActive: true }, NOW).some((e) => e.kind === 'seen')).toBe(
      false
    )
  })

  it('skips LAST SEEN when lastSeen is null', () => {
    expect(
      buildSystemLog({ ...base, isActive: false, lastSeen: null }, NOW).map((e) => e.kind)
    ).toEqual(['joined'])
  })

  it('logs a DECORATION per badge', () => {
    const log = buildSystemLog(
      { ...base, badges: [badge('Night Owl', '2026-08-01T00:00:00.000Z')] },
      NOW
    )
    expect(log[0]).toEqual({
      at: '2026-08-01T00:00:00.000Z',
      kind: 'badge',
      text: 'DECORATION · Night Owl'
    })
  })

  it('logs a PUSH per GitHub bay with a push date, named owner/repo', () => {
    const log = buildSystemLog(
      {
        ...base,
        hangar: [
          github('birdabo', 'cribble', '2026-08-30T10:00:00.000Z'),
          github('birdabo', 'stale', null),
          site('example.com', 'Example'),
          pending('pending.dev')
        ]
      },
      NOW
    )
    expect(log.filter((e) => e.kind === 'push')).toEqual([
      { at: '2026-08-30T10:00:00.000Z', kind: 'push', text: 'PUSH · birdabo/cribble' }
    ])
  })

  it('logs the in-flight bay once as IN FLIGHT at its push date', () => {
    const log = buildSystemLog(
      { ...base, hangar: [github('birdabo', 'cribble', '2026-08-30T10:00:00.000Z', true)] },
      NOW
    )
    expect(log.filter((e) => e.kind === 'push')).toEqual([])
    expect(log[0]).toEqual({
      at: '2026-08-30T10:00:00.000Z',
      kind: 'inflight',
      text: 'IN FLIGHT · birdabo/cribble'
    })
  })

  it('falls back to memberSince for an in-flight bay without a push date', () => {
    const log = buildSystemLog({ ...base, hangar: [github('a', 'b', null, true)] }, NOW)
    const inflight = log.find((e) => e.kind === 'inflight')
    expect(inflight?.at).toBe(base.memberSince)
  })

  it.each<[string, HangarCard, string]>([
    ['github', github('a', 'b', null, true), 'IN FLIGHT · a/b'],
    ['site with title', site('example.com', 'Example Site', true), 'IN FLIGHT · Example Site'],
    ['site without title', site('example.com', null, true), 'IN FLIGHT · example.com'],
    ['pending', pending('pending.dev', true), 'IN FLIGHT · pending.dev']
  ])('names an in-flight %s bay', (_name, card, text) => {
    const log = buildSystemLog({ ...base, hangar: [card] }, NOW)
    expect(log.find((e) => e.kind === 'inflight')?.text).toBe(text)
  })

  it('sorts newest first across kinds', () => {
    const log = buildSystemLog(
      {
        ...base,
        isActive: false,
        lastSeen: '2026-09-01T00:00:00.000Z',
        badges: [
          badge('Old', '2026-02-01T00:00:00.000Z'),
          badge('New', '2026-08-31T00:00:00.000Z')
        ],
        hangar: [github('a', 'b', '2026-08-15T00:00:00.000Z')]
      },
      NOW
    )
    expect(log.map((e) => e.text)).toEqual([
      'LAST SEEN',
      'DECORATION · New',
      'PUSH · a/b',
      'DECORATION · Old',
      'ENLISTED'
    ])
    for (let i = 1; i < log.length; i++) {
      expect(Date.parse(log[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(log[i].at))
    }
  })

  it('caps at the limit (default 6), keeping the newest', () => {
    const badges = Array.from({ length: 10 }, (_, i) =>
      badge(`B${i}`, `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`)
    )
    const log = buildSystemLog({ ...base, badges }, NOW)
    expect(log).toHaveLength(SYSTEM_LOG_LIMIT)
    expect(log[0].text).toBe('DECORATION · B9')
    expect(log.some((e) => e.kind === 'joined')).toBe(false)

    expect(buildSystemLog({ ...base, badges }, NOW, 2)).toHaveLength(2)
    expect(buildSystemLog({ ...base, badges }, NOW, 0)).toEqual([])
  })

  it('drops entries with unparseable dates', () => {
    const log = buildSystemLog(
      {
        ...base,
        isActive: false,
        lastSeen: 'never',
        memberSince: '',
        badges: [badge('Good', '2026-08-01T00:00:00.000Z'), badge('Bad', 'not a date')],
        hangar: [github('a', 'b', 'garbage')]
      },
      NOW
    )
    expect(log).toEqual([
      { at: '2026-08-01T00:00:00.000Z', kind: 'badge', text: 'DECORATION · Good' }
    ])
  })

  it('normalizes timestamps to ISO', () => {
    const log = buildSystemLog({ ...base, memberSince: '2026-01-10T09:00:00+02:00' }, NOW)
    expect(log[0].at).toBe('2026-01-10T07:00:00.000Z')
  })

  it('clamps future-dated entries to now', () => {
    const log = buildSystemLog(
      { ...base, badges: [badge('Skewed', '2026-09-03T12:00:05.000Z')] },
      NOW
    )
    expect(log[0]).toEqual({
      at: NOW.toISOString(),
      kind: 'badge',
      text: 'DECORATION · Skewed'
    })
  })

  it('only emits the documented kinds', () => {
    const kinds: LogKind[] = ['joined', 'seen', 'badge', 'push', 'inflight']
    const log = buildSystemLog(
      {
        ...base,
        isActive: false,
        badges: [badge('X', '2026-08-01T00:00:00.000Z')],
        hangar: [github('a', 'b', '2026-08-02T00:00:00.000Z'), site('s.dev', null, true)]
      },
      NOW,
      100
    )
    expect(new Set(log.map((e) => e.kind))).toEqual(new Set(kinds))
  })
})
