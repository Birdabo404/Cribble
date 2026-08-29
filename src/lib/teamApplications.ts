import { TEAM_SEAT_LIMIT } from '@/lib/teams'

// Pure guards for the member-initiated "transfer request" flow — the
// mirror image of team invites. The /api/team/apply routes gather the
// facts (rows, counts, the team's users row) and every APPLY surface
// renders the verdict verbatim, so button states and POST-time guards
// can never drift apart. No I/O here — same contract as teamRoster.

/** A pilot may court at most this many teams at once. Applications are
 *  seatless (the 10-seat cap bites at SIGN time), so this per-pilot cap
 *  is what keeps one pilot from papering the whole board. */
export const MAX_OPEN_APPLICATIONS = 3

/** Length cap for the pilot's pitch. The message column is plain TEXT
 *  (migration 064), so the limit is enforced here, app-side. */
export const APPLICATION_MESSAGE_MAX = 280

/** Every value team_affiliations.status can hold after migration 064.
 *  'pending' = team-initiated invite (holds a seat), 'applied' =
 *  member-initiated application (seatless), 'active' = signed member. */
export type AffiliationStatus = 'pending' | 'active' | 'applied'

/** What an APPLY surface can learn about a (viewer, team) pair. The
 *  apply API returns this verbatim as target.state. */
export type ApplyState =
  | 'can-apply'
  | 'applied'
  | 'invited'
  | 'member'
  | 'has-team'
  | 'roster-closed'
  | 'roster-full'
  | 'own-team'
  | 'team-account'
  | 'not-live'

/** Rows that count against MAX_OPEN_APPLICATIONS: open ('applied')
 *  requests whose team has not been banned. Banned-team rows are hidden
 *  from every member surface (they cannot be signed and must not
 *  advertise the team), so counting them would burn cap slots the pilot
 *  can neither see nor withdraw — the visible list must always explain
 *  the cap. Suspended/lapsed teams still show (greyed via live: false),
 *  so their rows still count. Used by both the POST guard and the GET
 *  verdict so the two can never drift. */
export function countOpenApplications(
  rows: { status: string; team?: { status: string | null } | null }[]
): number {
  return rows.filter(
    (row) => row.status === 'applied' && row.team?.status !== 'banned'
  ).length
}

export interface ApplyViewerFacts {
  /** users.id of the signed-in pilot. */
  userId: number
  /** TEAM-tier accounts recruit; they never apply. */
  isTeamTier: boolean
  /** Team behind the viewer's one ACTIVE affiliation, or null. */
  activeTeamUserId: number | null
  /** The viewer's existing affiliation row with THIS team, if any. */
  existingStatus: AffiliationStatus | null
  /** Open ('applied') rows the viewer holds across all teams. */
  openApplicationCount: number
}

export interface ApplyTeamFacts {
  /** users.id of the target team account. */
  userId: number
  /** teamIsLive over the team's users row: approved TEAM tier, not
   *  banned/suspended. */
  live: boolean
  /** users.team_recruiting — the OPEN ROSTER / CLOSED lamp. */
  recruiting: boolean
  /** getTeamSeatUsage: pending + active rows (applications don't count). */
  seatsUsed: number
}

/** The per-pilot open-application cap is deliberately not an ApplyState:
 *  it says nothing about THIS team, and a capped pilot should still see
 *  which rosters are open. It rides the 'can-apply' arm instead — the
 *  POST route turns a true flag into its 409, the UI into a disabled
 *  APPLY with the "3 OPEN REQUESTS MAX" copy. */
export type ApplyVerdict =
  | { state: Exclude<ApplyState, 'can-apply'> }
  | { state: 'can-apply'; atOpenApplicationCap: boolean }

export function canApply(viewer: ApplyViewerFacts, team: ApplyTeamFacts): ApplyVerdict {
  // Identity gates first — a team account gets no APPLY affordance at
  // all, least of all against itself.
  if (viewer.userId === team.userId) return { state: 'own-team' }
  if (viewer.isTeamTier) return { state: 'team-account' }

  // Existing-relationship states outrank the team-side gates: an invite
  // or open application stays actionable (accept / withdraw) even after
  // the team closes its roster, fills up, or lapses.
  switch (viewer.existingStatus) {
    case 'active':
      return { state: 'member' }
    case 'pending':
      return { state: 'invited' }
    case 'applied':
      return { state: 'applied' }
    case null:
      break
    default: {
      const exhaustive: never = viewer.existingStatus
      return exhaustive
    }
  }
  if (viewer.activeTeamUserId !== null) return { state: 'has-team' }

  // Team-side gates, most disqualifying first: a dead team's roster lamp
  // is meaningless, and a closed roster's seat count likewise.
  if (!team.live) return { state: 'not-live' }
  if (!team.recruiting) return { state: 'roster-closed' }
  if (team.seatsUsed >= TEAM_SEAT_LIMIT) return { state: 'roster-full' }

  return {
    state: 'can-apply',
    atOpenApplicationCap: viewer.openApplicationCount >= MAX_OPEN_APPLICATIONS
  }
}
