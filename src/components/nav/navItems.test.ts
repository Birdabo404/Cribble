import { describe, expect, it } from 'vitest'
import { seesTeamNav, visibleNavItems, type TeamNavUser } from './navItems'

function user(partial: TeamNavUser): TeamNavUser {
  return partial
}

function showsTeam(session: TeamNavUser | null | undefined): boolean {
  return visibleNavItems(session).some((item) => item.href === '/teams')
}

describe('seesTeamNav', () => {
  it('is hidden for signed-out visitors and ordinary pilots', () => {
    expect(seesTeamNav(null)).toBe(false)
    expect(seesTeamNav(undefined)).toBe(false)
    expect(seesTeamNav(user({ subscription_tier: 'PRO' }))).toBe(false)
    expect(seesTeamNav(user({ team_authority: null, team_member: false }))).toBe(false)
  })

  it('shows for a TEAM-tier account, even mid-review', () => {
    expect(seesTeamNav(user({ subscription_tier: 'TEAM' }))).toBe(true)
  })

  it('shows for an active OWNER affiliate', () => {
    expect(seesTeamNav(user({ subscription_tier: 'PRO', team_authority: 'owner' }))).toBe(
      true
    )
  })

  it('shows for a signed ACTIVE member — the read-only console they can already open', () => {
    expect(seesTeamNav(user({ subscription_tier: 'PRO', team_member: true }))).toBe(true)
  })
})

describe('visibleNavItems', () => {
  it('omits TEAM for everyone else', () => {
    expect(showsTeam(null)).toBe(false)
    expect(showsTeam(user({ subscription_tier: 'PRO' }))).toBe(false)
  })

  it('includes TEAM for members, owners, and TEAM-tier accounts', () => {
    expect(showsTeam(user({ team_member: true }))).toBe(true)
    expect(showsTeam(user({ team_authority: 'owner' }))).toBe(true)
    expect(showsTeam(user({ subscription_tier: 'TEAM' }))).toBe(true)
  })
})
