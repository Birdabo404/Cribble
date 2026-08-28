import { describe, expect, it } from 'vitest'
import type { PublicProfileResult } from '@/lib/publicProfile'
import { isMissingProfile, profileMetadata } from '@/lib/profilePage'

const missing: PublicProfileResult = { ok: false, status: 404, error: 'Profile not found' }
const outage: PublicProfileResult = { ok: false, status: 500, error: 'Profile lookup failed' }
const valid = {
  ok: true,
  profile: {
    username: 'Ada',
    display_name: 'Ada Lovelace',
    bio: 'Computing pioneer'
  }
} as PublicProfileResult

describe('public profile page route contract', () => {
  it('promotes an absent profile to a framework-native not-found response', () => {
    expect(isMissingProfile(missing)).toBe(true)
  })

  it('does not mislabel a backend outage as missing content', () => {
    expect(isMissingProfile(outage)).toBe(false)
  })

  it('makes missing-profile metadata non-indexable and non-social', () => {
    const metadata = profileMetadata(missing)
    expect(metadata.title).toBe('Profile not found — Cribble')
    expect(metadata.description).not.toContain('Ada')
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.openGraph).toMatchObject({ type: 'website' })
    expect(metadata.twitter).toBeUndefined()
  })

  it('keeps profile-specific metadata for valid profiles', () => {
    const metadata = profileMetadata(valid)
    expect(metadata.title).toBe('@Ada — Cribble')
    expect(metadata.description).toBe('Computing pioneer')
    expect(metadata.openGraph).toMatchObject({ type: 'profile' })
    expect(metadata.twitter).toMatchObject({ card: 'summary' })
    expect(metadata.robots).toBeUndefined()
  })
})
