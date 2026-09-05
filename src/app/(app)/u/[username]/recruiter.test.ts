import { describe, expect, it } from 'vitest'
import { onRecruiterRoster, recruitingTeamHandle, type RecruiterInput } from './recruiter'

// INVITE TO TEAM renders iff recruitingTeamHandle is non-null. The gate
// mirrors the server's resolveTeamAuthority verdict as /me reports it:
// both command arms recruit, everyone else — members, pending teams,
// signed-out — does not. These pin that an OWNER's personal account
// (PRO tier, no team_review_status) is let through, which a tier check
// would have refused.

const me = (overrides: Partial<RecruiterInput> = {}): RecruiterInput => ({
  twitter_username: 'skipper',
  team_authority: null,
  team_handle: null,
  ...overrides
})

describe('recruitingTeamHandle', () => {
  it('reads null for a session with no authority — members included', () => {
    expect(recruitingTeamHandle(me())).toBeNull()
    expect(recruitingTeamHandle(me({ team_authority: undefined }))).toBeNull()
    expect(recruitingTeamHandle(null)).toBeNull()
    expect(recruitingTeamHandle(undefined)).toBeNull()
  })

  it("names the franchise for a TEAM login — the login's own handle", () => {
    expect(
      recruitingTeamHandle(
        me({ twitter_username: 'acme', team_authority: 'team-account', team_handle: 'acme' })
      )
    ).toBe('acme')
  })

  it('falls back to the login handle on the franchise arm when /me predates team_handle', () => {
    expect(
      recruitingTeamHandle(
        me({ twitter_username: 'acme', team_authority: 'team-account', team_handle: undefined })
      )
    ).toBe('acme')
  })

  it("names the FRANCHISE, not the owner, for an owner's personal account", () => {
    expect(
      recruitingTeamHandle(me({ team_authority: 'owner', team_handle: 'acme' }))
    ).toBe('acme')
  })

  it('reads null for an owner when /me carries no team handle — never the owner’s own', () => {
    expect(recruitingTeamHandle(me({ team_authority: 'owner', team_handle: null }))).toBeNull()
    expect(recruitingTeamHandle(me({ team_authority: 'owner', team_handle: '  ' }))).toBeNull()
  })

  it('trims the handle it returns', () => {
    expect(recruitingTeamHandle(me({ team_authority: 'owner', team_handle: ' acme ' }))).toBe(
      'acme'
    )
  })
})

describe('onRecruiterRoster', () => {
  it('is true only when the pilot flies the recruiting team, case-insensitively', () => {
    expect(onRecruiterRoster({ username: 'ACME' }, 'acme')).toBe(true)
    expect(onRecruiterRoster({ username: 'other' }, 'acme')).toBe(false)
    expect(onRecruiterRoster(null, 'acme')).toBe(false)
  })
})
