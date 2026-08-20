import { describe, expect, it } from 'vitest'
import { canonicalizeJoinPathname, isJoinInvitePath } from './joinPath'

describe('canonicalizeJoinPathname', () => {
  it('rewrites uppercase /JOIN/ to the canonical invite path', () => {
    expect(canonicalizeJoinPathname('/JOIN/CRIB-THDM-AVQZ')).toBe('/join/CRIB-THDM-AVQZ')
    expect(canonicalizeJoinPathname('/Join/crib-thdm-avqz')).toBe('/join/crib-thdm-avqz')
  })

  it('leaves an already-canonical /join/ path alone', () => {
    expect(canonicalizeJoinPathname('/join/CRIB-THDM-AVQZ')).toBeNull()
    expect(canonicalizeJoinPathname('/join')).toBeNull()
  })

  it('does not treat neighboring paths as invite links', () => {
    expect(canonicalizeJoinPathname('/joining')).toBeNull()
    expect(canonicalizeJoinPathname('/login')).toBeNull()
    expect(isJoinInvitePath('/JOIN/CRIB-THDM-AVQZ')).toBe(true)
    expect(isJoinInvitePath('/joining')).toBe(false)
  })
})
