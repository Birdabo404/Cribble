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
  /** Only rendered for TEAM-tier accounts (see visibleNavItems). */
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
  // Company accounts get their command deck (/teams adapts: deck for
  // TEAM tier, buy page for everyone else); the roster/invite console
  // at /team stays reachable from the deck. Everyone else never sees
  // the row (visibleNavItems filters it out).
  { href: '/teams', label: 'TEAM', icon: 'team', exact: true, teamOnly: true }
]

/** Nav items the current session may see. The TEAM row shows for any
 *  TEAM-tier account (even mid-review; the page itself explains the
 *  pending state) and for active OWNER affiliates — /api/user/me carries
 *  the resolveTeamAuthority verdict so the deck they can already run is
 *  one click away. Signed-out visitors get the base set. */
export function visibleNavItems(
  user: Pick<MeUser, 'subscription_tier' | 'team_authority'> | null | undefined
): NavItemDef[] {
  const seesTeamRow =
    user?.subscription_tier === 'TEAM' || user?.team_authority === 'owner'
  return NAV_ITEMS.filter((item) => !item.teamOnly || seesTeamRow)
}

export function isNavItemActive(item: NavItemDef, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
