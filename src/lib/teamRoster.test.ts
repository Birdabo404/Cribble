import { describe, expect, it } from 'vitest'

import { teamIsLive, type TeamUserRow } from './teamRoster'

// teamIsLive is the join/stay gate every affiliation surface shares —
// invites, applications, badge joins. Pinned here: liveness requires
// the paid TEAM tier AND passed review AND no ban/suspension, with the
// pre-003 NULL status reading as active.

function row(overrides: Partial<TeamUserRow> = {}): TeamUserRow {
  return {
    id: 42,
    twitter_username: 'acme',
    twitter_name: 'ACME',
    twitter_profile_image: null,
    subscription_tier: 'TEAM',
    team_review_status: 'approved',
    status: 'active',
    ...overrides
  }
}

describe('teamIsLive', () => {
  it('accepts an approved TEAM row whether status is active or the pre-003 NULL', () => {
    expect(teamIsLive(row())).toBe(true)
    expect(teamIsLive(row({ status: null }))).toBe(true)
  })

  it('rejects a lapsed tier, an unfinished review, and a ban or suspension', () => {
    expect(teamIsLive(row({ subscription_tier: 'PRO' }))).toBe(false)
    expect(teamIsLive(row({ team_review_status: 'pending' }))).toBe(false)
    expect(teamIsLive(row({ team_review_status: null }))).toBe(false)
    expect(teamIsLive(row({ status: 'banned' }))).toBe(false)
    expect(teamIsLive(row({ status: 'suspended' }))).toBe(false)
  })
})
