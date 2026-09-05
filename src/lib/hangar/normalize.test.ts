import { describe, expect, it } from 'vitest'
import { HANGAR_MAX } from './types'
import { cleanPinUrl, cleanPins, githubRepoOf, hostOf, urlKey } from './normalize'

// urlKey decides which pastes are "the same link" — inside one pilot's
// bays (dedupe) and across pilots (one link_cards row). cleanPins is the
// write-side gate for metadata.pins and the read-side re-check.

describe('urlKey', () => {
  it('lowercases scheme and host and drops www., hash and trailing slash', () => {
    expect(urlKey('HTTPS://WWW.Example.COM/Docs/#intro')).toBe('https://example.com/Docs')
    expect(urlKey('https://example.com/')).toBe('https://example.com')
    expect(urlKey('https://example.com')).toBe('https://example.com')
    expect(urlKey('https://example.com/a/b///')).toBe('https://example.com/a/b')
  })

  it('keeps path case and non-default ports', () => {
    expect(urlKey('https://example.com:8443/CaseMatters')).toBe(
      'https://example.com:8443/CaseMatters'
    )
    expect(urlKey('https://example.com:443/x')).toBe('https://example.com/x')
  })

  it('drops tracking params but keeps and sorts the rest', () => {
    expect(
      urlKey(
        'https://example.com/p?utm_source=x&b=2&ref=twitter&fbclid=abc&a=1&gclid=1&UTM_Medium=m'
      )
    ).toBe('https://example.com/p?a=1&b=2')
    expect(urlKey('https://example.com/p?utm_source=x')).toBe('https://example.com/p')
  })

  it('collapses GitHub repos to lowercase /owner/repo without .git or deep paths', () => {
    const key = 'https://github.com/birdabo404/cribble'
    expect(urlKey('https://github.com/Birdabo404/Cribble')).toBe(key)
    expect(urlKey('https://github.com/Birdabo404/Cribble.git')).toBe(key)
    expect(urlKey('https://www.github.com/Birdabo404/Cribble/tree/main/src?tab=readme#x')).toBe(
      key
    )
    expect(urlKey('https://github.com/Birdabo404/Cribble/issues/12')).toBe(key)
  })

  it('treats a bare GitHub owner page as a plain URL', () => {
    expect(urlKey('https://github.com/Birdabo404/')).toBe('https://github.com/Birdabo404')
  })

  it('returns null for non-http(s) or unparseable input', () => {
    expect(urlKey('ftp://example.com/x')).toBeNull()
    expect(urlKey('javascript:alert(1)')).toBeNull()
    expect(urlKey('not a url')).toBeNull()
    expect(urlKey('')).toBeNull()
  })
})

describe('githubRepoOf / hostOf', () => {
  it('extracts owner/repo and strips .git', () => {
    expect(githubRepoOf('https://github.com/Owner/Repo.git/tree/main')).toEqual({
      owner: 'Owner',
      repo: 'Repo'
    })
    expect(githubRepoOf('https://github.com/Owner')).toBeNull()
    expect(githubRepoOf('https://gitlab.com/Owner/Repo')).toBeNull()
    expect(githubRepoOf('nope')).toBeNull()
  })

  it('hostOf lowercases and strips www.', () => {
    expect(hostOf('https://WWW.Cribble.dev/x')).toBe('cribble.dev')
    expect(hostOf('garbage')).toBe('')
  })
})

describe('cleanPinUrl', () => {
  it('adds https:// to bare domains and strips hash + tracking noise', () => {
    expect(cleanPinUrl('cribble.dev/launch?utm_source=x&plan=pro#top')).toBe(
      'https://cribble.dev/launch?plan=pro'
    )
  })

  it('preserves case and www. but cuts GitHub links back to the repo', () => {
    expect(cleanPinUrl('https://www.github.com/Birdabo404/Cribble/tree/main/src?x=1#L1')).toBe(
      'https://www.github.com/Birdabo404/Cribble'
    )
    expect(cleanPinUrl('https://github.com/Birdabo404/Cribble.git')).toBe(
      'https://github.com/Birdabo404/Cribble'
    )
  })

  it('rejects what cleanHttpUrl rejects', () => {
    expect(cleanPinUrl('http://localhost:3000')).toBeNull()
    expect(cleanPinUrl('http://127.0.0.1/admin')).toBeNull()
    expect(cleanPinUrl('http://10.0.0.5/')).toBeNull()
    expect(cleanPinUrl('http://router.local/')).toBeNull()
    expect(cleanPinUrl('https://user:pw@example.com/')).toBeNull()
    expect(cleanPinUrl('https://nodots/')).toBeNull()
    expect(cleanPinUrl(`https://example.com/${'a'.repeat(200)}`)).toBeNull()
    expect(cleanPinUrl(42)).toBeNull()
    expect(cleanPinUrl('')).toBeNull()
  })
})

describe('cleanPins', () => {
  it('returns [] for anything that is not an array', () => {
    expect(cleanPins(undefined)).toEqual([])
    expect(cleanPins(null)).toEqual([])
    expect(cleanPins('https://example.com')).toEqual([])
    expect(cleanPins({ 0: 'https://example.com' })).toEqual([])
  })

  it('keeps order, drops invalid entries silently and dedupes on urlKey', () => {
    expect(
      cleanPins([
        'https://github.com/Birdabo404/Cribble',
        'http://localhost/secret',
        'https://www.GitHub.com/birdabo404/cribble.git',
        42,
        'cribble.dev',
        'https://cribble.dev/?utm_source=x',
        'https://example.com/a/'
      ])
    ).toEqual([
      'https://github.com/Birdabo404/Cribble',
      'https://cribble.dev/',
      'https://example.com/a'
    ])
  })

  it('caps at HANGAR_MAX after filtering', () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://example.com/p${i}`)
    const pins = cleanPins(['http://localhost/x', ...many])
    expect(pins).toHaveLength(HANGAR_MAX)
    expect(pins[0]).toBe('https://example.com/p0')
    expect(pins[HANGAR_MAX - 1]).toBe(`https://example.com/p${HANGAR_MAX - 1}`)
  })
})
