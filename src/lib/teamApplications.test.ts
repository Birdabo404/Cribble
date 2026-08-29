import { describe, expect, it } from 'vitest'

import {
  APPLICATION_MESSAGE_MAX,
  MAX_OPEN_APPLICATIONS,
  canApply,
  type ApplyTeamFacts,
  type ApplyViewerFacts
} from './teamApplications'
import { TEAM_SEAT_LIMIT } from './teams'

// canApply is the one verdict both the apply route and every APPLY
// button render from, so its precedence ladder is pinned here: identity
// gates (own-team, team-account) outrank existing-relationship states
// (member / invited / applied / has-team), which outrank team-side
// gates (not-live, roster-closed, roster-full); only a viewer with no
// relationship facing a live, open, non-full roster can apply. The
// per-pilot open-application cap is not a state of its own — it rides
// the 'can-apply' arm as a flag.

function viewer(overrides: Partial<ApplyViewerFacts> = {}): ApplyViewerFacts {
  return {
    userId: 7,
    isTeamTier: false,
    activeTeamUserId: null,
    existingStatus: null,
    openApplicationCount: 0,
    ...overrides
  }
}

/** A live, recruiting team with seats to spare — every gate open. */
function team(overrides: Partial<ApplyTeamFacts> = {}): ApplyTeamFacts {
  return {
    userId: 42,
    live: true,
    recruiting: true,
    seatsUsed: 3,
    ...overrides
  }
}

/** Every team-side gate shut at once — for proving relationship states
 *  outrank all of them. */
const deadTeam = () =>
  team({ live: false, recruiting: false, seatsUsed: TEAM_SEAT_LIMIT })

describe('canApply', () => {
  it('lets a clean viewer apply to a live, open, non-full roster', () => {
    expect(canApply(viewer(), team())).toEqual({
      state: 'can-apply',
      atOpenApplicationCap: false
    })
  })

  describe('identity gates come first', () => {
    it('own-team wins over everything, including the team-account gate', () => {
      expect(
        canApply(
          viewer({ userId: 42, isTeamTier: true, existingStatus: 'applied' }),
          deadTeam()
        )
      ).toEqual({ state: 'own-team' })
    })

    it('team-account wins over relationship states and team-side gates', () => {
      expect(
        canApply(viewer({ isTeamTier: true, existingStatus: 'applied' }), deadTeam())
      ).toEqual({ state: 'team-account' })
    })
  })

  describe('existing-relationship states outrank team-side gates', () => {
    it('an active row with this team is member, even on a dead team', () => {
      expect(canApply(viewer({ existingStatus: 'active' }), deadTeam())).toEqual({
        state: 'member'
      })
    })

    it('a pending row with this team is invited, even on a dead team', () => {
      expect(canApply(viewer({ existingStatus: 'pending' }), deadTeam())).toEqual({
        state: 'invited'
      })
    })

    it('an applied row with this team is applied, even on a dead team', () => {
      expect(canApply(viewer({ existingStatus: 'applied' }), deadTeam())).toEqual({
        state: 'applied'
      })
    })

    it('a leftover applied row outranks an active affiliation elsewhere', () => {
      // Apply to B, then sign with A: B's button must say applied (offer
      // WITHDRAW), not the dead-end has-team.
      expect(
        canApply(viewer({ existingStatus: 'applied', activeTeamUserId: 99 }), team())
      ).toEqual({ state: 'applied' })
    })

    it('an active affiliation elsewhere is has-team, even on a dead team', () => {
      expect(canApply(viewer({ activeTeamUserId: 99 }), deadTeam())).toEqual({
        state: 'has-team'
      })
    })
  })

  describe('team-side gates: not-live > roster-closed > roster-full', () => {
    it('a dead team is not-live regardless of its lamp or seats', () => {
      expect(canApply(viewer(), deadTeam())).toEqual({ state: 'not-live' })
    })

    it('a closed roster outranks a full one', () => {
      expect(
        canApply(viewer(), team({ recruiting: false, seatsUsed: TEAM_SEAT_LIMIT }))
      ).toEqual({ state: 'roster-closed' })
    })

    it('roster-full bites exactly at the seat limit', () => {
      expect(canApply(viewer(), team({ seatsUsed: TEAM_SEAT_LIMIT }))).toEqual({
        state: 'roster-full'
      })
      expect(canApply(viewer(), team({ seatsUsed: TEAM_SEAT_LIMIT - 1 }))).toEqual({
        state: 'can-apply',
        atOpenApplicationCap: false
      })
    })
  })

  describe('the open-application cap', () => {
    it('flips the flag at the cap without changing the state', () => {
      expect(
        canApply(viewer({ openApplicationCount: MAX_OPEN_APPLICATIONS - 1 }), team())
      ).toEqual({ state: 'can-apply', atOpenApplicationCap: false })
      expect(
        canApply(viewer({ openApplicationCount: MAX_OPEN_APPLICATIONS }), team())
      ).toEqual({ state: 'can-apply', atOpenApplicationCap: true })
    })

    it('never rides a non-can-apply verdict', () => {
      // toEqual pins the exact shape: no stray cap flag on member.
      expect(
        canApply(viewer({ existingStatus: 'active', openApplicationCount: 9 }), team())
      ).toEqual({ state: 'member' })
    })
  })

  it('pins the app-side constants the routes and copy lean on', () => {
    expect(MAX_OPEN_APPLICATIONS).toBe(3)
    expect(APPLICATION_MESSAGE_MAX).toBe(280)
  })
})
