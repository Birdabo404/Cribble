import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_TRACKS,
  DEFAULT_MUSIC_VOLUME,
  MUSIC_PLAY_ROUTES,
  clampMusicVolume,
  isMusicPlayPath,
  nextTrackIndex,
  parseStoredMuted,
  parseStoredVolume
} from './backgroundMusic'

// The allowlist is the whole feature: play on the four main surfaces,
// silence everywhere else. These tables pin the boundary so a route
// rename or a loose startsWith doesn't quietly leak music onto (or drop
// it from) the wrong pages.

describe('isMusicPlayPath', () => {
  for (const route of MUSIC_PLAY_ROUTES) {
    it(`plays on the allowlisted route ${route}`, () => {
      expect(isMusicPlayPath(route)).toBe(true)
    })
  }

  const cases: { name: string; pathname: string; plays: boolean }[] = [
    { name: 'dashboard subroutes stay musical', pathname: '/dashboard/achievements', plays: true },
    { name: 'profile nav target /u/[username]', pathname: '/u/birdabo', plays: true },
    { name: 'nested profile paths', pathname: '/u/birdabo/highlights', plays: true },
    { name: 'a dashboard-prefixed sibling route is not the dashboard', pathname: '/dashboards', plays: false },
    { name: 'bare /u without a username', pathname: '/u', plays: false },
    { name: 'bag is exact-match only', pathname: '/bag/checkout', plays: false },
    { name: 'shop is exact-match only', pathname: '/shop/item', plays: false },
    { name: 'marketing home stays silent', pathname: '/', plays: false },
    { name: 'login stays silent', pathname: '/login', plays: false },
    { name: 'welcome keeps its own ambience', pathname: '/welcome', plays: false },
    { name: 'leaderboard pauses', pathname: '/leaderboard', plays: false },
    { name: 'settings pause', pathname: '/settings/appearance', plays: false },
    { name: 'empty pathname (router not ready) stays silent', pathname: '', plays: false }
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(isMusicPlayPath(c.pathname)).toBe(c.plays)
    })
  }
})

describe('BACKGROUND_TRACKS', () => {
  it('opens with Yellow — the playlist starts at index 0', () => {
    expect(BACKGROUND_TRACKS[0].id).toBe('yellow')
    expect(BACKGROUND_TRACKS[1].id).toBe('mellow')
  })
})

describe('nextTrackIndex', () => {
  it('advances through the playlist and wraps back to the first track', () => {
    // Walk one full cycle from 0: every hop is +1 until the last track
    // wraps to 0 — the shared advance logic for both ended and skip.
    let index = 0
    for (let hop = 1; hop < BACKGROUND_TRACKS.length; hop += 1) {
      index = nextTrackIndex(index)
      expect(index).toBe(hop)
    }
    expect(nextTrackIndex(index)).toBe(0)
  })
})

describe('parseStoredVolume', () => {
  const cases: { name: string; raw: string | null; volume: number }[] = [
    { name: 'missing key falls back to the 40% default', raw: null, volume: DEFAULT_MUSIC_VOLUME },
    { name: 'blank value reads as unset, not silent', raw: '   ', volume: DEFAULT_MUSIC_VOLUME },
    { name: 'stored float round-trips', raw: '0.75', volume: 0.75 },
    { name: 'zero is a legitimate saved volume', raw: '0', volume: 0 },
    { name: 'full volume round-trips', raw: '1', volume: 1 },
    { name: 'out-of-range high clamps to 1', raw: '3.5', volume: 1 },
    { name: 'out-of-range low clamps to 0', raw: '-0.4', volume: 0 },
    { name: 'garbage falls back to the default', raw: 'loud', volume: DEFAULT_MUSIC_VOLUME }
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(parseStoredVolume(c.raw)).toBe(c.volume)
    })
  }
})

describe('clampMusicVolume', () => {
  it('passes in-range values through', () => {
    expect(clampMusicVolume(0.4)).toBe(0.4)
  })

  it('clamps to the 0–1 range', () => {
    expect(clampMusicVolume(1.2)).toBe(1)
    expect(clampMusicVolume(-1)).toBe(0)
  })

  it('rejects non-finite values in favor of the default', () => {
    expect(clampMusicVolume(Number.NaN)).toBe(DEFAULT_MUSIC_VOLUME)
    expect(clampMusicVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MUSIC_VOLUME)
  })
})

describe('parseStoredMuted', () => {
  it("only the literal '1' means muted", () => {
    expect(parseStoredMuted('1')).toBe(true)
    expect(parseStoredMuted('0')).toBe(false)
    expect(parseStoredMuted('true')).toBe(false)
    expect(parseStoredMuted(null)).toBe(false)
  })
})
