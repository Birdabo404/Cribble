// The right-hand micro readout of the pane frame's PanelHeader — the
// pane titles moved up out of the panes into the content column, and the
// figure that used to sit beside each title comes along through this one
// pure mapping (RECORD's enlist date, HANGAR's bay count, LOADOUT's
// unit, SERVICE RECORD's tally, AFFILIATES' head count). Restricted
// viewers read PRIVATE where the pane is follower-only. Pure so the
// spelling is pinned by a test instead of by reading five JSX files.

import { ACHIEVEMENTS } from '@/lib/achievements'
import { HANGAR_MAX } from '@/lib/hangar/types'
import type { PublicProfileData } from '@/types/profile'
import type { ProfileTabId } from './ProfileMenu'
import { monthYear } from './parts'

/** The slice of the payload the readouts need. */
export type PaneAsideInput = Pick<
  PublicProfileData,
  'memberSince' | 'hangar' | 'restricted' | 'badges' | 'affiliates'
>

export function paneAside(tab: ProfileTabId, profile: PaneAsideInput): string | null {
  switch (tab) {
    case 'record':
      return `ENLISTED ${monthYear(profile.memberSince)}`
    case 'hangar':
      return `${(profile.hangar ?? []).length} / ${HANGAR_MAX} BAYS`
    case 'loadout':
      return profile.restricted ? 'PRIVATE' : 'SHARE OF SCORE'
    case 'service-record':
      return profile.restricted ? 'PRIVATE' : `${profile.badges.length} / ${ACHIEVEMENTS.length}`
    case 'affiliates': {
      if (!profile.affiliates) return null
      const n = profile.affiliates.total
      return `${n.toLocaleString('en-US')} ${n === 1 ? 'MEMBER' : 'MEMBERS'}`
    }
    default: {
      const exhaustive: never = tab
      return exhaustive
    }
  }
}
