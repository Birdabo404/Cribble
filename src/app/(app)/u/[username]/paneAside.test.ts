import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '@/lib/achievements'
import type { HangarCard } from '@/lib/hangar/types'
import type { PublicProfileBadge } from '@/lib/publicProfile'
import { paneAside, type PaneAsideInput } from './paneAside'

// The pane frame's PanelHeader prints this on the right, so the spelling
// of every readout (and PRIVATE for gated panes) is pinned here.

const pending = (host: string): HangarCard => ({
  kind: 'pending',
  url: `https://${host}`,
  host,
  inFlight: false
})

const badge = (id: string): PublicProfileBadge => ({
  id,
  name: id,
  description: '',
  rarity: 'common',
  icon: 'flame',
  unlockedAt: '2026-01-01T00:00:00.000Z'
})

const base: PaneAsideInput = {
  memberSince: '2025-11-14T08:00:00.000Z',
  hangar: [],
  restricted: false,
  badges: [],
  affiliates: null
}

describe('paneAside', () => {
  it('RECORD prints the enlist month', () => {
    expect(paneAside('record', base)).toBe('ENLISTED NOV 2025')
  })

  it('HANGAR counts docked bays out of six', () => {
    expect(paneAside('hangar', base)).toBe('0 / 6 BAYS')
    expect(paneAside('hangar', { ...base, hangar: [pending('a.dev'), pending('b.dev')] })).toBe(
      '2 / 6 BAYS'
    )
  })

  it('LOADOUT names the unit, or PRIVATE when gated', () => {
    expect(paneAside('loadout', base)).toBe('SHARE OF SCORE')
    expect(paneAside('loadout', { ...base, restricted: true })).toBe('PRIVATE')
  })

  it('SERVICE RECORD tallies unlocks against the catalogue, or PRIVATE', () => {
    expect(paneAside('service-record', { ...base, badges: [badge('a'), badge('b')] })).toBe(
      `2 / ${ACHIEVEMENTS.length}`
    )
    expect(paneAside('service-record', { ...base, restricted: true })).toBe('PRIVATE')
  })

  it('AFFILIATES counts members with the singular at one', () => {
    expect(paneAside('affiliates', base)).toBeNull()
    expect(paneAside('affiliates', { ...base, affiliates: { members: [], total: 1 } })).toBe(
      '1 MEMBER'
    )
    expect(paneAside('affiliates', { ...base, affiliates: { members: [], total: 1200 } })).toBe(
      '1,200 MEMBERS'
    )
  })
})
