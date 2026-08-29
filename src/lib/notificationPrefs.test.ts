import { describe, expect, it } from 'vitest'

import {
  CATEGORY_NOTIFICATION_TYPES,
  DEFAULT_NOTIFICATION_PREFS,
  disabledNotificationTypes,
  mergeNotificationPrefs,
  resolveNotificationPrefs,
  type NotificationPrefs
} from './notificationPrefs'

// These prefs gate what the notification feed shows, so the fail-open
// contract is pinned here: missing or malformed metadata never mutes a
// category (only a stored literal `false` does), and 'system' rows can
// never be filtered out no matter what the prefs claim.

const allOff: NotificationPrefs = {
  rank: false,
  achievements: false,
  social: false,
  team: false,
  season: false,
  shop: false
}

describe('resolveNotificationPrefs', () => {
  it('returns all-enabled defaults for missing or non-object metadata', () => {
    for (const metadata of [undefined, null, 'metadata', 42, true, []]) {
      expect(resolveNotificationPrefs(metadata)).toEqual(DEFAULT_NOTIFICATION_PREFS)
    }
  })

  it('returns defaults when the nesting is absent or malformed', () => {
    expect(resolveNotificationPrefs({})).toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect(resolveNotificationPrefs({ preferences: null })).toEqual(
      DEFAULT_NOTIFICATION_PREFS
    )
    expect(resolveNotificationPrefs({ preferences: 'oops' })).toEqual(
      DEFAULT_NOTIFICATION_PREFS
    )
    expect(
      resolveNotificationPrefs({ preferences: { notifications: [false] } })
    ).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })

  it('reads stored booleans and fills the gaps with defaults', () => {
    const prefs = resolveNotificationPrefs({
      bio: 'unrelated key',
      preferences: { notifications: { rank: false, season: false } }
    })
    expect(prefs).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, rank: false, season: false })
  })

  it('treats non-boolean values as missing — only a literal false mutes', () => {
    const prefs = resolveNotificationPrefs({
      preferences: {
        notifications: { rank: 'false', social: 0, team: null, season: undefined, shop: false }
      }
    })
    expect(prefs).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, shop: false })
  })

  it('drops unknown keys instead of carrying them into the result', () => {
    const prefs = resolveNotificationPrefs({
      preferences: { notifications: { system: false, bogus: false } }
    })
    expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect('system' in prefs).toBe(false)
    expect('bogus' in prefs).toBe(false)
  })

  it('returns a fresh object, never the shared default', () => {
    expect(resolveNotificationPrefs(undefined)).not.toBe(DEFAULT_NOTIFICATION_PREFS)
  })
})

describe('mergeNotificationPrefs', () => {
  it('applies only the patched keys', () => {
    const merged = mergeNotificationPrefs(DEFAULT_NOTIFICATION_PREFS, { social: false })
    expect(merged).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, social: false })
  })

  it('re-enabling one category leaves the others muted', () => {
    const merged = mergeNotificationPrefs(allOff, { team: true })
    expect(merged).toEqual({ ...allOff, team: true })
  })

  it('ignores explicit undefined instead of clobbering the stored value', () => {
    expect(mergeNotificationPrefs(allOff, { rank: undefined })).toEqual(allOff)
  })

  it('ignores runtime garbage that slipped past validation', () => {
    const patch = { rank: 'nope' } as unknown as Partial<NotificationPrefs>
    expect(mergeNotificationPrefs(DEFAULT_NOTIFICATION_PREFS, patch)).toEqual(
      DEFAULT_NOTIFICATION_PREFS
    )
  })

  it('does not mutate its inputs', () => {
    const current = { ...DEFAULT_NOTIFICATION_PREFS }
    mergeNotificationPrefs(current, { shop: false })
    expect(current).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })
})

describe('disabledNotificationTypes', () => {
  it('is empty when everything is enabled', () => {
    expect(disabledNotificationTypes(DEFAULT_NOTIFICATION_PREFS)).toEqual([])
  })

  it('expands a muted category into all of its feed types', () => {
    expect(
      disabledNotificationTypes({ ...DEFAULT_NOTIFICATION_PREFS, rank: false }).sort()
    ).toEqual(['milestone', 'rank'])
    expect(
      disabledNotificationTypes({ ...DEFAULT_NOTIFICATION_PREFS, team: false }).sort()
    ).toEqual([
      'team_application',
      'team_application_accepted',
      'team_application_declined',
      'team_invite',
      'team_invite_accepted',
      'team_removed'
    ])
    expect(
      disabledNotificationTypes({ ...DEFAULT_NOTIFICATION_PREFS, shop: false }).sort()
    ).toEqual(['premium', 'shop'])
  })

  it('never excludes system, even with everything muted', () => {
    const disabled = disabledNotificationTypes(allOff)
    expect(disabled).not.toContain('system')
    expect(disabled.sort()).toEqual(
      Object.values(CATEGORY_NOTIFICATION_TYPES).flat().sort()
    )
  })

  it('has no system category to mute in the first place', () => {
    expect('system' in CATEGORY_NOTIFICATION_TYPES).toBe(false)
    expect('system' in DEFAULT_NOTIFICATION_PREFS).toBe(false)
  })
})
