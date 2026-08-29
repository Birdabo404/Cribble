import { describe, expect, it } from 'vitest'
import { isXAvatarUrl, xAvatarRefreshUrl } from '@/lib/avatarRefresh'

describe('isXAvatarUrl', () => {
  it('matches pbs.twimg.com avatars only', () => {
    expect(
      isXAvatarUrl('https://pbs.twimg.com/profile_images/123/abc_normal.jpg')
    ).toBe(true)
    expect(
      isXAvatarUrl('https://avatars.githubusercontent.com/u/9919?v=4')
    ).toBe(false)
    // Suffix spoof must not take the refresh hop.
    expect(isXAvatarUrl('https://evil.example/pbs.twimg.com/x.jpg')).toBe(false)
    expect(isXAvatarUrl('not a url')).toBe(false)
  })
})

describe('xAvatarRefreshUrl', () => {
  it('builds an unavatar URL that 404s instead of placeholding', () => {
    expect(xAvatarRefreshUrl('emzerielo')).toBe(
      'https://unavatar.io/x/emzerielo?fallback=false'
    )
  })

  it('rejects strings that cannot be X handles', () => {
    // GitHub logins allow hyphens; X handles never do.
    expect(xAvatarRefreshUrl('some-github-user')).toBeNull()
    expect(xAvatarRefreshUrl('sixteen_chars_xx1')).toBeNull()
    expect(xAvatarRefreshUrl('')).toBeNull()
    expect(xAvatarRefreshUrl('  ')).toBeNull()
    expect(xAvatarRefreshUrl(null)).toBeNull()
    expect(xAvatarRefreshUrl(undefined)).toBeNull()
  })
})
