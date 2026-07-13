import type { AchievementIcon, AchievementRarity } from '@/lib/achievements'
import { ROLE_META } from '@/lib/roles'
import type { Tier } from '@/types/dashboard'
import type { SocialKind } from './icons'

// Re-exported so existing imports keep working; the vocabulary itself
// lives in src/lib/roles.ts alongside the welcome wizard options.
export { ROLE_META }

export type Socials = Partial<Record<SocialKind, string | null>>

export interface TopTool {
  name: string
  visits: number
  active_ms: number
  percent: number
}

/** One standings row, as served by /api/leaderboard. */
export interface LeaderRow {
  userId: number
  rank: number
  username: string
  display_name: string
  profile_image: string | null
  score: number
  todayScore: number
  weekScore: number
  isActive: boolean
  lastSeen: string | null
  memberSince?: string | null
  tier: Tier
  topTools?: TopTool[]
  provider?: 'x' | 'github' | 'other'
  banner_image?: string | null
  socials?: Socials
  role?: string | null
  /** prev rank − current rank at the last movement. Positive = climbed. */
  rankDelta: number
  movedAt: string | null
  isNew: boolean
}

export interface PlayerBadge {
  id: string
  name: string
  description: string
  rarity: AchievementRarity
  icon: AchievementIcon
  unlockedAt: string
}

/** Extended profile, as served by /api/profile/[username] (superset of
 *  the legacy /api/leaderboard/profile payload — follow fields are
 *  optional so both endpoints satisfy this shape). */
export interface PlayerProfile {
  userId: number
  username: string
  display_name: string
  profile_image: string | null
  banner_image: string | null
  bio?: string | null
  location?: string | null
  website?: string | null
  socials: Socials
  role: string | null
  tier: string
  memberSince: string
  lastSeen: string | null
  isActive: boolean
  rank: number | null
  rankDelta: number
  score: number
  todayScore: number
  weekScore: number
  activeDays: number
  longestStreak: number
  totalActiveMs: number
  topTools: TopTool[]
  badges: PlayerBadge[]
  followers?: number
  following?: number
  viewer?: { isYou: boolean; isFollowing: boolean; followsYou: boolean } | null
}

/** Medal treatment per podium rank; null below the podium. */
export interface Medal {
  /** solid hue */
  fg: string
  /** rgb triplet var reference for alpha mixing, e.g. 'var(--lb-gold)' */
  rgb: string
  /** bright rgb triplet literal for chips sitting on the dark banner scrim
   * (theme-independent — the scrim stays dark even in light mode, where the
   * themed metal hues go muddy) */
  plate: string
  label: string
}

export const medalFor = (rank: number): Medal | null => {
  if (rank === 1)
    return { fg: 'rgb(var(--lb-gold))', rgb: 'var(--lb-gold)', plate: '255 214 68', label: 'CHAMPION' }
  if (rank === 2)
    return { fg: 'rgb(var(--lb-silver))', rgb: 'var(--lb-silver)', plate: '216 228 242', label: 'RUNNER-UP' }
  if (rank === 3)
    return { fg: 'rgb(var(--lb-bronze))', rgb: 'var(--lb-bronze)', plate: '255 145 77', label: 'THIRD' }
  return null
}

/** Movement hues for chips on the dark banner scrim. */
export const PLATE_UP = '74 222 128'
export const PLATE_DOWN = '251 113 133'

export const medalA = (rgb: string, alpha: number) => `rgb(${rgb} / ${alpha})`
