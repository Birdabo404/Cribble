// Pure model behind the /teams command deck (TeamDashboard.tsx): which
// sectors a viewer holds and where they land, how the roster is ordered
// and which row is lit, how the KPI numerals are fitted, and the seat
// map. No React, no DOM — every derivation the JSX switches on lives
// here so it can be pinned by deckModel.test.ts.

import { usdDisplayParts } from '@/lib/tokenLeaderboard'

/* ================= viewer + sectors ================= */

export type DeckAuthority = 'team-account' | 'owner' | 'member'

/** The deck is a master-detail console: the roster list is pinned on the
 *  left, and the rail on the right shows ONE sector at a time. Operators
 *  switch between the lit pilot's dossier, the transfer queue and the
 *  hiring bar; members only ever have the roster sector. */
export type DeckSector = 'roster' | 'transfers' | 'bar'

/** Operators (franchise login or signed owner) get the action center —
 *  hiring bar, transfers queue, roster lamp, console link. Members get
 *  none of it. */
export function isDeckOperator(authority: DeckAuthority): boolean {
  switch (authority) {
    case 'team-account':
    case 'owner':
      return true
    case 'member':
      return false
    default: {
      const exhaustive: never = authority
      return exhaustive
    }
  }
}

/** The masthead reads COMMAND DECK for operators, TEAM CONSOLE for the
 *  read-only member cut. */
export function deckTitle(authority: DeckAuthority): string {
  switch (authority) {
    case 'team-account':
    case 'owner':
      return 'COMMAND DECK'
    case 'member':
      return 'TEAM CONSOLE'
    default: {
      const exhaustive: never = authority
      return exhaustive
    }
  }
}

export function sectorLabel(sector: DeckSector): string {
  switch (sector) {
    case 'roster':
      return 'ROSTER'
    case 'transfers':
      return 'TRANSFERS'
    case 'bar':
      return 'HIRING BAR'
    default: {
      const exhaustive: never = sector
      return exhaustive
    }
  }
}

export function sectorsFor(operator: boolean): DeckSector[] {
  return operator ? ['roster', 'transfers', 'bar'] : ['roster']
}

/** Where a viewer lands: operators open on the queue when pilots are
 *  waiting — the one thing on the screen that needs a decision —
 *  everyone else on the roster. */
export function initialSector(operator: boolean, waiting: number): DeckSector {
  return operator && waiting > 0 ? 'transfers' : 'roster'
}

/** A held sector the viewer can't reach (member payload after an
 *  authority change) snaps back to the roster. */
export function resolveSector(sector: DeckSector, sectors: DeckSector[]): DeckSector {
  return sectors.includes(sector) ? sector : 'roster'
}

/** Arrow/Home/End on a tab → the index that takes focus and selection
 *  (WAI-ARIA automatic activation, wrapping at both ends). Keys the
 *  tablist doesn't own answer null so the event propagates. */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/* ================= roster ================= */

export interface RosterLike {
  affiliationId: number
  status: 'pending' | 'active'
  score: number
  share: number
}

/** Actives ranked by contribution, pending invites trailing in the order
 *  the server sent them (it already sorts them by invite time). */
export function orderRoster<T extends RosterLike>(roster: T[]): T[] {
  const actives = roster
    .filter((entry) => entry.status === 'active')
    .sort((a, b) => b.score - a.score)
  const pendings = roster.filter((entry) => entry.status === 'pending')
  return [...actives, ...pendings]
}

/** The lit row: the held selection while it still exists, else the top
 *  of the ordered roster, else nothing. */
export function resolveSelection<T extends RosterLike>(
  ordered: T[],
  selectedId: number | null
): { entry: T | null; index: number } {
  const held = ordered.findIndex((entry) => entry.affiliationId === selectedId)
  if (held >= 0) return { entry: ordered[held], index: held }
  return ordered.length > 0 ? { entry: ordered[0], index: 0 } : { entry: null, index: -1 }
}

/** Share as the bar draws it — the server emits 0–100 integers, but a
 *  malformed payload must never paint a 340%-wide fill. */
export function clampShare(share: number): number {
  if (!Number.isFinite(share)) return 0
  return Math.max(0, Math.min(100, Math.round(share)))
}

export const pad2 = (n: number) => String(n).padStart(2, '0')

/* ================= seat map ================= */

export type SeatKind = 'active' | 'pending' | 'open'

export interface Seat<T> {
  kind: SeatKind
  entry: T | null
}

/** Ten cells: signed pilots first (contribution order), then pending
 *  invites, then open seats — the same order the roster list uses. A
 *  roster past the cap (never in practice) is clipped, not overflowed. */
export function seatMap<T extends RosterLike>(ordered: T[], seatLimit: number): Seat<T>[] {
  const seats: Seat<T>[] = ordered
    .map((entry) => ({ kind: entry.status, entry }))
    .slice(0, seatLimit)
  while (seats.length < seatLimit) seats.push({ kind: 'open', entry: null })
  return seats
}

/* ================= KPI numerals ================= */

export interface KpiInputs {
  score: number
  rank: number | null
  activeCount: number
  seatLimit: number
  burnUsd: string
  burnPilots: number
}

export interface KpiText {
  score: string
  rank: string
  pilots: string
  burn: string
}

export function kpiText(input: KpiInputs): KpiText {
  const burn = usdDisplayParts(input.burnUsd)
  return {
    score: input.score.toLocaleString('en-US'),
    rank: input.rank !== null ? `#${input.rank}` : '—',
    pilots: `${input.activeCount}/${input.seatLimit}`,
    burn: input.burnPilots > 0 ? `${burn.tiny ? '<' : ''}$${burn.number}` : '—'
  }
}

/** Press Start 2P advances exactly 1em per glyph, so the four KPI cells
 *  share one size fitted to the longest value (CSS divides the cell's
 *  inline size by this). Floored at 4 so a lone "#2" never balloons. */
export function kpiChars(text: KpiText): number {
  return Math.max(4, ...Object.values(text).map((value) => value.length))
}
