import type { MeUser } from '@/types/dashboard'
import type { NavIconName } from './NavIcon'

export interface NavItemDef {
  href: string
  label: string
  icon: NavIconName
  /** Active only on an exact pathname match (e.g. /dashboard must not
   *  light up while on /dashboard/achievements). */
  exact?: boolean
  /** Rendered as a chip in the top-bar variant. Items excluded here stay
   *  reachable via the rail, the mobile drawer, and the account menu. */
  topBar?: boolean
  /** Only rendered when the session may open the team console
   *  (see visibleNavItems / seesTeamNav). */
  teamOnly?: boolean
}

export const NAV_ITEMS: NavItemDef[] = [
  { href: '/profile', label: 'PROFILE', icon: 'pilot' },
  { href: '/dashboard', label: 'DASHBOARD', icon: 'console', exact: true, topBar: true },
  { href: '/leaderboard', label: 'LEADERBOARD', icon: 'standings', topBar: true },
  // SHOP earns a top-bar chip: it is the revenue surface, and its label is
  // short enough that a third chip still fits the md bar comfortably.
  { href: '/shop', label: 'SHOP', icon: 'shop', topBar: true },
  // BAG earns a top-bar chip too: it is the collection page, and its
  // short label lets a fourth chip fit without crowding the md bar.
  { href: '/bag', label: 'BAG', icon: 'bag', topBar: true },
  // Company accounts, owners, and signed members get /teams (the page
  // adapts: command deck / read-only console / buy page). The roster
  // console at /team stays reachable from the deck. Everyone else never
  // sees the row (visibleNavItems filters it out).
  { href: '/teams', label: 'TEAM', icon: 'team', exact: true, teamOnly: true }
]

export type TeamNavUser = Pick<
  MeUser,
  'subscription_tier' | 'team_authority' | 'team_member'
>

/** True when the session may open the team console: any TEAM-tier
 *  account (even mid-review; the page itself explains the pending
 *  state), an active OWNER affiliate, or a signed ACTIVE member — /me
 *  carries both resolveTeamAuthority and resolveTeamMembership so the
 *  surface they can already open is one click away. */
export function seesTeamNav(user: TeamNavUser | null | undefined): boolean {
  return (
    user?.subscription_tier === 'TEAM' ||
    user?.team_authority === 'owner' ||
    user?.team_member === true
  )
}

/** Nav items the current session may see. Signed-out visitors get the
 *  base set; TEAM is gated through seesTeamNav. */
export function visibleNavItems(user: TeamNavUser | null | undefined): NavItemDef[] {
  const seesTeamRow = seesTeamNav(user)
  return NAV_ITEMS.filter((item) => !item.teamOnly || seesTeamRow)
}

export function isNavItemActive(item: NavItemDef, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
