import type { NotificationType } from '@/types/notifications'

// Per-category notification preferences, stored in
// users.metadata.preferences.notifications (JSONB — no dedicated table).
// The resolver fails open: only a literal stored `false` mutes a
// category, so missing or malformed metadata can never silence a feed.
// 'system' rows are always delivered and intentionally have no toggle.

export interface NotificationPrefs {
  rank: boolean
  achievements: boolean
  social: boolean
  team: boolean
  season: boolean
  shop: boolean
}

export type NotificationPrefCategory = keyof NotificationPrefs

/** Feed types muted by each category toggle. Typed as a full Record so a
 *  new category can't ship without its type expansion. 'system' is never
 *  listed — it is not filterable by design. */
export const CATEGORY_NOTIFICATION_TYPES: Record<
  NotificationPrefCategory,
  readonly NotificationType[]
> = {
  rank: ['rank', 'milestone'],
  achievements: ['achievement'],
  social: ['social'],
  team: [
    'team_invite',
    'team_invite_accepted',
    'team_removed',
    'team_application',
    'team_application_accepted',
    'team_application_declined'
  ],
  season: ['season'],
  shop: ['shop', 'premium']
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  rank: true,
  achievements: true,
  social: true,
  team: true,
  season: true,
  shop: true
}

const PREF_CATEGORIES = Object.keys(
  DEFAULT_NOTIFICATION_PREFS
) as NotificationPrefCategory[]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Reads metadata.preferences.notifications off a raw users.metadata
 *  value. Each key must be a literal boolean to count; anything else
 *  (missing, string "false", null, ...) falls back to the default. */
export function resolveNotificationPrefs(metadata: unknown): NotificationPrefs {
  const meta = isRecord(metadata) ? metadata : {}
  const preferences = isRecord(meta.preferences) ? meta.preferences : {}
  const stored = isRecord(preferences.notifications) ? preferences.notifications : {}

  const prefs: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS }
  for (const category of PREF_CATEGORIES) {
    const value = stored[category]
    if (typeof value === 'boolean') prefs[category] = value
  }
  return prefs
}

/** Flat list of notification types the feed must exclude for these
 *  prefs. Never contains 'system'. */
export function disabledNotificationTypes(prefs: NotificationPrefs): NotificationType[] {
  const disabled: NotificationType[] = []
  for (const category of PREF_CATEGORIES) {
    if (!prefs[category]) disabled.push(...CATEGORY_NOTIFICATION_TYPES[category])
  }
  return disabled
}

/** Shallow merge of a partial patch. Only literal booleans apply, so an
 *  explicit `undefined` (or runtime garbage that slipped past
 *  validation) can't clobber a stored value. */
export function mergeNotificationPrefs(
  current: NotificationPrefs,
  patch: Partial<NotificationPrefs>
): NotificationPrefs {
  const merged: NotificationPrefs = { ...current }
  for (const category of PREF_CATEGORIES) {
    const value = patch[category]
    if (typeof value === 'boolean') merged[category] = value
  }
  return merged
}
