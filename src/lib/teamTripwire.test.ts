import { describe, expect, it } from 'vitest'
import {
  describeTripwireChanges,
  diffTeamIdentity,
  tripwireDedupeKey,
  type TeamIdentityFields
} from './teamTripwire'

const identity = (over: Partial<TeamIdentityFields> = {}): TeamIdentityFields => ({
  username: 'acme',
  name: 'Acme Corp',
  avatar: 'https://pbs.twimg.com/profile_images/1/acme.jpg',
  ...over
})

describe('diffTeamIdentity', () => {
  it('returns no changes for identical snapshots', () => {
    expect(diffTeamIdentity(identity(), identity())).toEqual([])
  })

  it('treats null, undefined-ish empty and whitespace as the same value', () => {
    expect(
      diffTeamIdentity(identity({ avatar: null }), identity({ avatar: '' }))
    ).toEqual([])
    expect(
      diffTeamIdentity(identity({ name: '  Acme Corp  ' }), identity({ name: 'Acme Corp' }))
    ).toEqual([])
  })

  it('reports each genuinely changed field with old and new values', () => {
    const changes = diffTeamIdentity(
      identity(),
      identity({ username: 'not-acme', avatar: 'https://pbs.twimg.com/profile_images/2/fake.jpg' })
    )
    expect(changes).toEqual([
      { field: 'username', from: 'acme', to: 'not-acme' },
      {
        field: 'avatar',
        from: 'https://pbs.twimg.com/profile_images/1/acme.jpg',
        to: 'https://pbs.twimg.com/profile_images/2/fake.jpg'
      }
    ])
  })

  it('counts a case-only handle change as a change', () => {
    expect(diffTeamIdentity(identity(), identity({ username: 'Acme' }))).toEqual([
      { field: 'username', from: 'acme', to: 'Acme' }
    ])
  })

  it('surfaces cleared values as null', () => {
    expect(diffTeamIdentity(identity(), identity({ avatar: '' }))).toEqual([
      { field: 'avatar', from: 'https://pbs.twimg.com/profile_images/1/acme.jpg', to: null }
    ])
  })
})

describe('tripwireDedupeKey', () => {
  it('is deterministic for the same team and change set', () => {
    const changes = diffTeamIdentity(identity(), identity({ username: 'not-acme' }))
    expect(tripwireDedupeKey(7, changes)).toBe(tripwireDedupeKey(7, changes))
    expect(tripwireDedupeKey(7, changes)).toMatch(/^team_tripwire_7_[0-9a-f]{16}$/)
  })

  it('differs across teams and across change sets', () => {
    const rename = diffTeamIdentity(identity(), identity({ username: 'not-acme' }))
    const reavatar = diffTeamIdentity(identity(), identity({ avatar: 'https://x/y.png' }))
    expect(tripwireDedupeKey(7, rename)).not.toBe(tripwireDedupeKey(8, rename))
    expect(tripwireDedupeKey(7, rename)).not.toBe(tripwireDedupeKey(7, reavatar))
  })
})

describe('describeTripwireChanges', () => {
  it('renders old → new pairs, with (empty) for cleared values', () => {
    const changes = diffTeamIdentity(
      identity(),
      identity({ username: 'not-acme', name: '' })
    )
    expect(describeTripwireChanges(changes)).toBe(
      'username: acme → not-acme · name: Acme Corp → (empty)'
    )
  })
})
