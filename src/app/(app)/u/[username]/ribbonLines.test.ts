import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '@/lib/achievements'
import type { HangarCard } from '@/lib/hangar/types'
import type { PublicProfileBadge } from '@/lib/publicProfile'
import {
  agoUpper,
  chaseText,
  revStamp,
  ribbonLines,
  sysTime,
  type RibbonInput
} from './ribbonLines'

// The ribbon cycles these one at a time and decodes each on its flip, so
// the vocabulary, the order and the hazard flag are pinned here.

const NOW = new Date('2026-09-03T12:00:00.000Z')

const github = (owner: string, repo: string, inFlight = false): HangarCard => ({
  kind: 'github',
  url: `https://github.com/${owner}/${repo}`,
  owner,
  repo,
  description: null,
  stars: 0,
  forks: 0,
  language: null,
  languageColor: null,
  pushedAt: null,
  archived: false,
  homepage: null,
  inFlight
})

const badge = (id: string): PublicProfileBadge => ({
  id,
  name: id,
  description: '',
  rarity: 'common',
  icon: 'flame',
  unlockedAt: '2026-01-01T00:00:00.000Z'
})

const base: RibbonInput = {
  rank: 7,
  rankDelta: 0,
  score: 142_500,
  todayScore: 1_200,
  isActive: true,
  lastSeen: '2026-09-03T10:00:00.000Z',
  hangar: [],
  badges: [],
  restricted: false
}

const texts = (input: RibbonInput, chase: string | null = null) =>
  ribbonLines(input, chase, NOW).map((l) => l.text)

describe('ribbonLines', () => {
  it('runs rank, score, presence, fleet, decorations in that order', () => {
    expect(ribbonLines(base, null, NOW).map((l) => l.key)).toEqual([
      'rank',
      'score',
      'presence',
      'fleet',
      'decorations'
    ])
  })

  it('appends the CHASE line only when there is one', () => {
    expect(ribbonLines(base, null, NOW).some((l) => l.key === 'chase')).toBe(false)
    const lines = ribbonLines(base, 'YOU 1 · LEVEL', NOW)
    expect(lines[lines.length - 1]).toEqual({ key: 'chase', text: 'YOU 1 · LEVEL', alert: false })
  })

  describe('rank', () => {
    it('prints movement with ▲ and the plural', () => {
      expect(texts({ ...base, rankDelta: 3 })[0]).toBe('RANK #7 · ▲ 3 PLACES')
      expect(texts({ ...base, rankDelta: 1 })[0]).toBe('RANK #7 · ▲ 1 PLACE')
    })

    it('flags a loss as alert with ▼', () => {
      const [rank] = ribbonLines({ ...base, rankDelta: -2 }, null, NOW)
      expect(rank).toEqual({ key: 'rank', text: 'RANK #7 · ▼ 2 PLACES', alert: true })
    })

    it('omits movement at zero and never flags it', () => {
      const [rank] = ribbonLines(base, null, NOW)
      expect(rank).toEqual({ key: 'rank', text: 'RANK #7', alert: false })
    })

    it('reads UNRANKED without a rank', () => {
      expect(texts({ ...base, rank: null, rankDelta: 0 })[0]).toBe('UNRANKED')
    })
  })

  it('groups the score and the day gain', () => {
    expect(texts(base)[1]).toBe('SCORE 142,500 · +1,200 TODAY')
  })

  it('reads ONLINE while active, LAST SEEN otherwise', () => {
    expect(texts(base)[2]).toBe('ONLINE')
    expect(texts({ ...base, isActive: false })[2]).toBe('LAST SEEN 2H AGO')
  })

  it('counts the fleet and names the in-flight bay', () => {
    expect(texts(base)[3]).toBe('FLEET 0 / 6')
    expect(texts({ ...base, hangar: [github('a', 'b'), github('c', 'd', true)] })[3]).toBe(
      'FLEET 2 / 6 · IN FLIGHT c/d'
    )
  })

  it('tallies decorations against the catalogue, PRIVATE when gated', () => {
    expect(texts({ ...base, badges: [badge('x')] })[4]).toBe(`DECORATIONS 1 / ${ACHIEVEMENTS.length}`)
    expect(texts({ ...base, restricted: true })[4]).toBe('DECORATIONS · PRIVATE')
  })
})

describe('chaseText', () => {
  it('reads BEHIND when the profile leads', () => {
    expect(chaseText(98_240, 142_530)).toBe('YOU 98,240 · GAP 44,290 PTS BEHIND')
  })

  it('reads AHEAD when the visitor leads', () => {
    expect(chaseText(150_000, 142_530)).toBe('YOU 150,000 · GAP 7,470 PTS AHEAD')
  })

  it('reads LEVEL at a tie', () => {
    expect(chaseText(10, 10)).toBe('YOU 10 · LEVEL')
  })
})

describe('agoUpper', () => {
  it.each<[string, string]>([
    ['2026-09-03T11:59:30.000Z', 'JUST NOW'],
    ['2026-09-03T11:55:00.000Z', '5M AGO'],
    ['2026-09-03T09:00:00.000Z', '3H AGO'],
    ['2026-08-31T12:00:00.000Z', '3D AGO']
  ])('%s -> %s', (iso, out) => {
    expect(agoUpper(iso, NOW)).toBe(out)
  })

  it('tolerates missing or unreadable stamps', () => {
    expect(agoUpper(null, NOW)).toBe('—')
    expect(agoUpper('nope', NOW)).toBe('—')
  })
})

describe('sysTime', () => {
  it('prints HH:MM:SS and the local UTC offset', () => {
    const out = sysTime(new Date(2026, 8, 3, 7, 4, 9))
    expect(out).toMatch(/^SYS\.TIME 07:04:09 UTC[+-]\d{1,2}(:\d{2})?$/)
  })
})

describe('revStamp', () => {
  it('is YYMM of the enlist date', () => {
    expect(revStamp('2025-11-14T08:00:00.000Z')).toBe('REV 2511')
    expect(revStamp('2026-01-02T00:00:00.000Z')).toBe('REV 2601')
  })

  it('falls back on a missing or bad date', () => {
    expect(revStamp(null)).toBe('REV —')
    expect(revStamp('garbage')).toBe('REV —')
  })
})
