// Which panes a profile column offers, in bar order. Pure so the
// presence rules are pinned by a test instead of by reading JSX:
// RECORD is always first (rank and score stay the first thing seen),
// HANGAR shows when something is docked or the owner is looking
// (visitors never meet an empty tab, owners always discover it),
// AFFILIATES only when the API attached a roster (approved teams).
// ProfileClient feeds the result to both ProfileMenu and useProfileTab,
// so the same list decides what renders and what a #hash may resolve to.

import type { ProfileTabId } from './ProfileMenu'

export interface TabsForInput {
  /** profile.hangar.length, or 0 before the payload lands. */
  hangarCount: number
  /** Viewer is the profile owner (profile.viewer.isYou). */
  isYou: boolean
  /** profile.affiliates is non-null. */
  hasAffiliates: boolean
}

export function tabsFor({ hangarCount, isYou, hasAffiliates }: TabsForInput): ProfileTabId[] {
  const tabs: ProfileTabId[] = ['record']
  if (hangarCount > 0 || isYou) tabs.push('hangar')
  tabs.push('loadout', 'service-record')
  if (hasAffiliates) tabs.push('affiliates')
  return tabs
}
