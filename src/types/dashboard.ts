import type { ActivityDay } from '@/lib/activity'

export type Tier = 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'PREMIUM+' | 'AFFILIATE' | 'TEAM'

export interface MeUser {
  id: number
  twitter_username: string
  twitter_name: string
  twitter_profile_image: string
  subscription_tier?: Tier
  /** Team anti-impersonation review ('pending' | 'approved' | 'rejected');
   *  null for accounts that never bought the Team plan. Feed it together
   *  with subscription_tier to isApprovedTeam() — never read it alone. */
  team_review_status?: string | null
  /** resolveTeamAuthority verdict: 'team-account' for a live TEAM login,
   *  'owner' for an active OWNER affiliate of a live team, else null.
   *  Optional defensively: older server builds don't send it. */
  team_authority?: 'team-account' | 'owner' | null
  last_extension_sync?: string | null
  active_device_uuid?: string | null
  created_at?: string
  last_login?: string
}

export interface MeScores {
  total_score: number
  today_score: number
  week_score: number
  month_score: number
}

export interface MeStats {
  total_visits: number
  today_visits: number
  total_time: number
  today_time: number
  active_time: number
  today_active_time: number
  efficiency: number
}

export interface ActiveDevice {
  device_uuid: string
  device_name: string
  last_sync_at: string | null
}

export interface ToolRow {
  name: string
  visits: number
  active_ms: number
  score: number
  percent: number
}

export interface RankInfo {
  position: number
  total: number
}

export interface GlobalTotals {
  totalPlayers: number
  activePlayers: number
  totalPoints: number
}

export interface MeResponsePayload {
  user: MeUser
  scores?: MeScores
  stats?: MeStats
  activeDevice?: ActiveDevice | null
  /** Leaderboard standing computed server-side; null while unranked.
   *  Optional defensively: older server builds don't send it. */
  rank?: RankInfo | null
}

export type MeFetchResult =
  | { ok: true; data: MeResponsePayload }
  | { ok: false }

export const EMPTY_SCORES: MeScores = {
  total_score: 0,
  today_score: 0,
  week_score: 0,
  month_score: 0
}

export const EMPTY_STATS: MeStats = {
  total_visits: 0,
  today_visits: 0,
  total_time: 0,
  today_time: 0,
  active_time: 0,
  today_active_time: 0,
  efficiency: 0
}

export type { ActivityDay }
