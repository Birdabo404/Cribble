export const NOTIFICATION_TYPES = [
  'rank',
  'milestone',
  'season',
  'social',
  'system'
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
