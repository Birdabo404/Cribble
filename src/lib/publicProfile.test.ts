import { describe, expect, it, vi } from 'vitest'

// gateProfileForViewer is the only privacy boundary between the cached
// (viewer-agnostic) profile and what a request gets. These pin which
// sections a restricted viewer loses — top tools, agents, badges, and the
// activity grid — and that everything else stays exactly as assembled.

vi.mock('next/cache', () => ({
  unstable_cache:
    (loader: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      loader(...args)
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({})
}))

import { gateProfileForViewer, type PublicProfile } from './publicProfile'

const profile: PublicProfile = {
  userId: 26,
  username: 'pilot',
  display_name: 'Pilot',
  profile_image: null,
  banner_image: null,
  banner_frame: null,
  plate: null,
  bio: 'hello',
  location: null,
  website: null,
  project: null,
  hangar: [],
  socials: { x: 'pilot', github: null, youtube: null, linkedin: null },
  role: 'Developer',
  tier: 'FREE',
  isTeam: false,
  team: null,
  memberSince: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-09-01T00:00:00.000Z',
  isActive: false,
  rank: 7,
  rankDelta: 0,
  score: 1_000,
  todayScore: 0,
  weekScore: 0,
  activeDays: 3,
  longestStreak: 2,
  totalActiveMs: 9_000,
  topTools: [{ name: 'cursor.com', visits: 1, active_ms: 9_000, percent: 100 }],
  topAgents: [],
  badges: [
    {
      id: 'first-sync',
      name: 'First Sync',
      description: '',
      rarity: 'common',
      icon: 'flame',
      unlockedAt: '2026-02-01T00:00:00.000Z'
    }
  ],
  activity: {
    windowDays: 91,
    days: [
      { date: '2026-09-01', activeMs: 4_000 },
      { date: '2026-09-02', activeMs: 5_000 }
    ]
  },
  isPrivate: true,
  restricted: false
}

describe('gateProfileForViewer', () => {
  it('returns the profile untouched when the account is public', () => {
    const open = { ...profile, isPrivate: false }
    expect(gateProfileForViewer(open, null)).toBe(open)
  })

  it('lets the owner and followers through a private account', () => {
    const you = { isYou: true, isFollowing: false, followsYou: false }
    const follower = { isYou: false, isFollowing: true, followsYou: false }
    expect(gateProfileForViewer(profile, you)).toBe(profile)
    expect(gateProfileForViewer(profile, follower)).toBe(profile)
  })

  it.each([
    ['signed out', null],
    ['signed in, not following', { isYou: false, isFollowing: false, followsYou: true }]
  ])('empties the gated sections for a restricted viewer (%s)', (_name, viewer) => {
    const gated = gateProfileForViewer(profile, viewer)
    expect(gated.restricted).toBe(true)
    expect(gated.topTools).toEqual([])
    expect(gated.topAgents).toEqual([])
    expect(gated.badges).toEqual([])
    expect(gated.activity).toEqual({ windowDays: 91, days: [] })
  })

  it('keeps identity, score and consistency counts visible when restricted', () => {
    const gated = gateProfileForViewer(profile, null)
    expect(gated.username).toBe('pilot')
    expect(gated.bio).toBe('hello')
    expect(gated.score).toBe(1_000)
    expect(gated.rank).toBe(7)
    expect(gated.activeDays).toBe(3)
    expect(gated.isPrivate).toBe(true)
  })

  it('does not mutate the cached input', () => {
    const snapshot = JSON.parse(JSON.stringify(profile))
    gateProfileForViewer(profile, null)
    expect(profile).toEqual(snapshot)
  })
})
