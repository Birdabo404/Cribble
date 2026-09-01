export const NOTIFICATION_TYPES = [
  'rank',
  'milestone',
  'achievement',
  'season',
  'social',
  'premium',
  'shop',
  'system',
  'team_invite',
  'team_invite_accepted',
  'team_removed',
  'team_application',
  'team_application_accepted',
  'team_application_declined',
  'team_promotion'
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface AppNotification {
  id: number
  type: NotificationType
  title: string
  body: string | null
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

/** Rows come off the wire with `type` as an open string; unknown values
 *  (added by future server versions) degrade gracefully to 'system'. */
export function normalizeNotificationType(raw: unknown): NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(String(raw))
    ? (raw as NotificationType)
    : 'system'
}

export interface FollowActor {
  username: string | null
  avatarUrl: string | null
}

const TEAM_ACTOR_TYPES: ReadonlySet<NotificationType> = new Set([
  'team_invite',
  'team_invite_accepted',
  'team_removed',
  'team_application',
  'team_application_accepted',
  'team_application_declined',
  'team_promotion'
])

/** Team-flow rows (invites and transfer requests, in both directions)
 *  persist the counterparty's identity in `data` at write time — the team
 *  for member-facing rows, the member for team-facing ones. Returns those
 *  display fields, or null when the row isn't part of the team flow. */
export function teamActor(
  n: Pick<AppNotification, 'type' | 'data'>
): FollowActor | null {
  if (!TEAM_ACTOR_TYPES.has(n.type)) {
    return null
  }
  const data = n.data ?? {}
  return {
    username: typeof data.username === 'string' ? data.username : null,
    avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : null
  }
}

/** A follow event is a social row carrying the follower's id (all rows the
 *  follow API writes) or an explicit `kind: 'follow'` — never a referral
 *  reward. Returns the actor's display fields, or null when the row isn't
 *  a follow. `avatarUrl` is joined into `data` at read time by the feed API. */
export function followActor(
  n: Pick<AppNotification, 'type' | 'data'>
): FollowActor | null {
  if (n.type !== 'social') return null
  const data = n.data ?? {}
  if (data.kind === 'referral') return null
  const hasFollowerId =
    typeof data.followerId === 'number' || typeof data.followerId === 'string'
  if (data.kind !== 'follow' && !hasFollowerId) return null
  return {
    username: typeof data.username === 'string' ? data.username : null,
    avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : null
  }
}
