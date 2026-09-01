import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { resolveTeamAuthority, teamIsLive, type TeamUserRow } from './teamRoster'

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

// resolveTeamAuthority is the who-may-command gate every /api/team/*
// route shares (066): a live TEAM login speaks for itself; a signed
// member speaks for the live team behind their ACTIVE + role='owner'
// affiliation; everyone else — plain members, non-owner actives,
// owners of lapsed or banned teams, unknown users — resolves null.
// A failed read never grants authority either. The fake below honors
// the probe's filters against staged rows, so a wrong filter in the
// implementation would surface as a wrong verdict here, not be papered
// over by the mock.

/** An affiliation row as the owner probe's join sees it. */
interface FakeAffiliationRow {
  member_user_id: number
  status: string
  role: string
  team_user_id: number
  team: TeamUserRow | null
}

function fakeClient({
  users = {},
  affiliations = [],
  usersError = false,
  affiliationsError = false
}: {
  users?: Record<number, TeamUserRow>
  affiliations?: FakeAffiliationRow[]
  usersError?: boolean
  affiliationsError?: boolean
}): SupabaseClient {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      if (table === 'users') {
        const builder = {
          select: () => builder,
          eq(column: string, value: unknown) {
            filters[column] = value
            return builder
          },
          // loadUserRow terminal, keyed by the id filter.
          maybeSingle: () =>
            Promise.resolve(
              usersError
                ? { data: null, error: { message: 'users read down' } }
                : { data: users[Number(filters.id)] ?? null, error: null }
            )
        }
        return builder
      }
      if (table === 'team_affiliations') {
        const builder = {
          select: () => builder,
          eq(column: string, value: unknown) {
            filters[column] = value
            return builder
          },
          // The owner probe's terminal: applies every eq the caller set,
          // so member/status/role scoping is genuinely under test.
          maybeSingle: () => {
            if (affiliationsError) {
              return Promise.resolve({
                data: null,
                error: { message: 'affiliation read down' }
              })
            }
            const match = affiliations.find(
              (candidate) =>
                candidate.member_user_id === filters.member_user_id &&
                candidate.status === filters.status &&
                candidate.role === filters.role
            )
            return Promise.resolve({
              data: match
                ? { team_user_id: match.team_user_id, team: match.team }
                : null,
              error: null
            })
          }
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  } as unknown as SupabaseClient
}

/** A FREE-tier pilot row — the caller shape on the owner arm. */
function pilot(id: number): TeamUserRow {
  return row({ id, subscription_tier: 'FREE', team_review_status: null })
}

/** An ACTIVE owner affiliation binding pilot 33 to the given team. */
function ownerAffiliation(
  overrides: Partial<FakeAffiliationRow> = {}
): FakeAffiliationRow {
  return {
    member_user_id: 33,
    status: 'active',
    role: 'owner',
    team_user_id: 42,
    team: row(),
    ...overrides
  }
}

describe('resolveTeamAuthority', () => {
  it('grants a live TEAM login authority over itself, via team-account', async () => {
    const client = fakeClient({ users: { 42: row() } })

    await expect(resolveTeamAuthority(client, 42)).resolves.toEqual({
      teamUserId: 42,
      via: 'team-account'
    })
  })

  it("grants an ACTIVE owner authority over their live team's id, via owner", async () => {
    const client = fakeClient({
      users: { 33: pilot(33) },
      affiliations: [ownerAffiliation()]
    })

    await expect(resolveTeamAuthority(client, 33)).resolves.toEqual({
      teamUserId: 42,
      via: 'owner'
    })
  })

  it('resolves null for a pilot with no affiliation at all', async () => {
    const client = fakeClient({ users: { 33: pilot(33) } })

    await expect(resolveTeamAuthority(client, 33)).resolves.toBeNull()
  })

  it("resolves null for an ACTIVE member without the owner role — the probe's role filter", async () => {
    const client = fakeClient({
      users: { 33: pilot(33) },
      affiliations: [ownerAffiliation({ role: 'member' })]
    })

    await expect(resolveTeamAuthority(client, 33)).resolves.toBeNull()
  })

  it("resolves null for a PENDING owner-role row — the probe's status filter", async () => {
    const client = fakeClient({
      users: { 33: pilot(33) },
      affiliations: [ownerAffiliation({ status: 'pending' })]
    })

    await expect(resolveTeamAuthority(client, 33)).resolves.toBeNull()
  })

  it('dissolves owner authority when the team lapses or is banned — no cleanup writes needed', async () => {
    const lapsed = fakeClient({
      users: { 33: pilot(33) },
      affiliations: [ownerAffiliation({ team: row({ subscription_tier: 'FREE' }) })]
    })
    const banned = fakeClient({
      users: { 33: pilot(33) },
      affiliations: [ownerAffiliation({ team: row({ status: 'banned' }) })]
    })

    await expect(resolveTeamAuthority(lapsed, 33)).resolves.toBeNull()
    await expect(resolveTeamAuthority(banned, 33)).resolves.toBeNull()
  })

  it('resolves null for an unknown user', async () => {
    const client = fakeClient({})

    await expect(resolveTeamAuthority(client, 999)).resolves.toBeNull()
  })

  it('never grants authority off a failed read — either lookup erroring resolves null', async () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const usersDown = fakeClient({ usersError: true })
      const affiliationsDown = fakeClient({
        users: { 33: pilot(33) },
        affiliations: [ownerAffiliation()],
        affiliationsError: true
      })

      await expect(resolveTeamAuthority(usersDown, 42)).resolves.toBeNull()
      await expect(resolveTeamAuthority(affiliationsDown, 33)).resolves.toBeNull()
    } finally {
      silence.mockRestore()
    }
  })
})
