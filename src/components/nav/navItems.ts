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
}

export const NAV_ITEMS: NavItemDef[] = [
  { href: '/profile', label: 'PROFILE', icon: 'pilot' },
  { href: '/dashboard', label: 'DASHBOARD', icon: 'console', exact: true, topBar: true },
  { href: '/leaderboard', label: 'LEADERBOARD', icon: 'standings', topBar: true },
  // Achievements stays out of the top bar on purpose — it is one click away
  // in the account menu (and in the rail/drawer), and a third chip crowded
  // the bar without earning its place.
  { href: '/dashboard/achievements', label: 'ACHIEVEMENTS', icon: 'award' }
]

export function isNavItemActive(item: NavItemDef, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
