// SYSTEM LOG for the RECORD pane: the last few dated events a profile
// already carries, assembled client-side — no new data. Badge unlocks,
// GitHub pushes on hangar pins, the NOW BUILDING pin, the enlist date and
// (for a pilot who is not currently active) the last sync. Pure so the
// ordering and cap are pinned by tests. Named apart from the SystemLog
// component on purpose: systemLog.ts + SystemLog.tsx collide on a
// case-insensitive filesystem (see ActivityGrid.tsx).

import type { HangarCard } from '@/lib/hangar/types'
import type { PublicProfileData } from '@/types/profile'

export type LogKind = 'joined' | 'seen' | 'badge' | 'push' | 'inflight'

export interface LogEntry {
  /** ISO timestamp (normalized). */
  at: string
  kind: LogKind
  text: string
}

/** The slice of the profile payload the log reads. */
export type SystemLogInput = Pick<
  PublicProfileData,
  'badges' | 'hangar' | 'memberSince' | 'lastSeen' | 'isActive'
>

export const SYSTEM_LOG_LIMIT = 6

const SEPARATOR = ' · '

/** What a hangar bay is called in a log line. */
function cardName(card: HangarCard): string {
  switch (card.kind) {
    case 'github':
      return `${card.owner}/${card.repo}`
    case 'site':
      return card.title ?? card.host
    case 'pending':
      return card.host
    default: {
      const exhaustive: never = card
      return exhaustive
    }
  }
}

/** Last push for a GitHub bay; null for every other kind. */
function pushedAt(card: HangarCard): string | null {
  switch (card.kind) {
    case 'github':
      return card.pushedAt
    case 'site':
    case 'pending':
      return null
    default: {
      const exhaustive: never = card
      return exhaustive
    }
  }
}

/**
 * Newest first, capped at `limit`. Entries with an unparseable timestamp
 * are dropped; one dated after `now` (client/server clock skew) is
 * clamped to `now` so the log never reads as the future. The in-flight
 * bay is logged once as IN FLIGHT (at its last push, else the enlist
 * date) rather than as a second PUSH line.
 */
export function buildSystemLog(
  profile: SystemLogInput,
  now: Date,
  limit = SYSTEM_LOG_LIMIT
): LogEntry[] {
  const nowMs = now.getTime()
  const entries: Array<LogEntry & { ms: number }> = []

  const push = (at: string | null | undefined, kind: LogKind, text: string) => {
    if (!at) return
    const parsed = Date.parse(at)
    if (!Number.isFinite(parsed)) return
    const ms = Number.isFinite(nowMs) ? Math.min(parsed, nowMs) : parsed
    entries.push({ at: new Date(ms).toISOString(), kind, text, ms })
  }

  for (const badge of profile.badges) {
    push(badge.unlockedAt, 'badge', `DECORATION${SEPARATOR}${badge.name}`)
  }

  // Optional-chained like every other hangar reader: a Data Cache entry
  // written before the field existed serves without it for up to 60s.
  for (const card of profile.hangar ?? []) {
    if (card.inFlight) {
      push(
        pushedAt(card) ?? profile.memberSince,
        'inflight',
        `IN FLIGHT${SEPARATOR}${cardName(card)}`
      )
    } else {
      push(pushedAt(card), 'push', `PUSH${SEPARATOR}${cardName(card)}`)
    }
  }

  push(profile.memberSince, 'joined', 'ENLISTED')

  if (!profile.isActive) push(profile.lastSeen, 'seen', 'LAST SEEN')

  entries.sort((a, b) => b.ms - a.ms)

  return entries.slice(0, Math.max(0, limit)).map(({ at, kind, text }) => ({ at, kind, text }))
}
