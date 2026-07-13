// Shared public-profile assembly. One builder feeds both profile
// endpoints (/api/leaderboard/profile by id, /api/profile/[username]
// by handle) so the leaderboard card and the full profile page can
// never drift apart. Exposes only data already visible on the
// leaderboard plus persisted achievement unlocks and the user's own
// published profile fields (bio, location, website, socials) —
// never tokens, emails, devices or admin fields.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACHIEVEMENTS_BY_ID,
  longestStreakFromDayKeys,
  type AchievementIcon,
  type AchievementRarity
} from '@/lib/achievements'
import { fetchAllUserEvents, normalizeLegacyEventValues } from '@/lib/scoring'
import { resolveToolName } from '@/lib/toolNames'

export interface PublicProfileTool {
  name: string
  visits: number
  active_ms: number
  percent: number
}

export interface PublicProfileBadge {
  id: string
  name: string
  description: string
  rarity: AchievementRarity
  icon: AchievementIcon
  unlockedAt: string
}

export interface PublicProfile {
  userId: number
  username: string
  display_name: string
  profile_image: string | null
  banner_image: string | null
  bio: string | null
  location: string | null
  website: string | null
  socials: {
    x: string | null
    github: string | null
    youtube: string | null
    linkedin: string | null
  }
  role: string | null
  tier: 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'AFFILIATE'
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
  topTools: PublicProfileTool[]
  badges: PublicProfileBadge[]
}

interface ProfileUserRow {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
  created_at: string
  last_extension_sync: string | null
  subscription_tier: string | null
  user_type: string | null
  status: string | null
  metadata: Record<string, unknown> | null
  user_scores: {
    total_score: number | null
    today_score: number | null
    week_score: number | null
    last_calculated_at: string | null
  } | null
}

const PROFILE_USER_SELECT = `
  id,
  twitter_username,
  twitter_name,
  twitter_profile_image,
  created_at,
  last_extension_sync,
  subscription_tier,
  user_type,
  status,
  metadata,
  user_scores(total_score, today_score, week_score, last_calculated_at)
`

const sameUtcDay = (iso: string | null | undefined, now: Date) => {
  if (!iso) return false
  const t = new Date(iso)
  return (
    t.getUTCFullYear() === now.getUTCFullYear() &&
    t.getUTCMonth() === now.getUTCMonth() &&
    t.getUTCDate() === now.getUTCDate()
  )
}

// Mirrors the normalization in /api/leaderboard so every endpoint
// reports the same tier labels for the same user.
const normalizeTier = (t: string | null): PublicProfile['tier'] => {
  const v = (t || 'FREE').toUpperCase()
  if (v.includes('AFFILIATE')) return 'AFFILIATE'
  if (v.includes('PREMIUM')) return 'PREMIUM'
  if (v.includes('PRO')) return 'PRO'
  if (v.includes('BASIC')) return 'BASIC'
  return 'FREE'
}

const metaString = (meta: Record<string, unknown>, key: string): string | null => {
  const v = meta[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export type ProfileLookup = { userId: number } | { username: string }

export type PublicProfileResult =
  | { ok: true; profile: PublicProfile }
  | { ok: false; status: number; error: string }

/**
 * Load and assemble the public profile for a user, by id or by handle.
 * Handle lookup is case-insensitive so shared /u/ links survive manual
 * typing. Banned users resolve as 404, indistinguishable from absent.
 */
export async function loadPublicProfile(
  supabase: SupabaseClient,
  lookup: ProfileLookup
): Promise<PublicProfileResult> {
  let query = supabase.from('users').select(PROFILE_USER_SELECT)

  if ('userId' in lookup) {
    query = query.eq('id', lookup.userId)
  } else {
    // ilike with wildcards escaped = case-insensitive equality.
    const escaped = lookup.username.replace(/([%_\\])/g, '\\$1')
    query = query.ilike('twitter_username', escaped)
  }

  const { data: user, error: userError } = await query.limit(1).maybeSingle()

  if (userError) {
    // Details stay in server logs; clients get a generic string so raw
    // Supabase/Postgres messages never leak schema or query internals.
    console.error('[PublicProfile] User query error:', userError)
    return { ok: false, status: 500, error: 'Profile lookup failed' }
  }
  if (!user || (user as unknown as ProfileUserRow).status === 'banned') {
    return { ok: false, status: 404, error: 'Player not found' }
  }

  const row = user as unknown as ProfileUserRow
  const totalScore = Math.round(row.user_scores?.total_score || 0)

  // Rank + movement, unlocked badges, and this player's events — all in
  // parallel. Events are fetched with pagination so profiles of heavy
  // users aren't computed from a 1000-row subset.
  const [rankRes, snapshotRes, badgesRes, eventsRes] = await Promise.all([
    totalScore > 0
      ? supabase
          .from('user_scores')
          .select('user_id', { count: 'exact', head: true })
          .gt('total_score', totalScore)
      : Promise.resolve({ count: null, error: null }),
    supabase
      .from('leaderboard_ranks')
      .select('prev_rank, rank, rank_moved_at, first_seen_at')
      .eq('user_id', row.id)
      .maybeSingle(),
    supabase
      .from('user_achievements')
      .select('achievement_id, unlocked_at')
      .eq('user_id', row.id)
      .order('unlocked_at', { ascending: false }),
    fetchAllUserEvents(supabase, row.id, 'timestamp, domain, visits, active_ms')
  ])

  const rank =
    totalScore > 0 && rankRes.count !== null && !rankRes.error
      ? rankRes.count + 1
      : null

  // Movement is display sugar; ignore errors (e.g. migration 012 missing).
  const snapshot = snapshotRes.error ? null : snapshotRes.data
  const movedAtMs = snapshot?.rank_moved_at
    ? Date.parse(String(snapshot.rank_moved_at))
    : NaN
  const movementFresh =
    Number.isFinite(movedAtMs) && Date.now() - movedAtMs < 48 * 3_600_000
  const rankDelta =
    movementFresh && snapshot?.prev_rank != null && rank !== null
      ? Number(snapshot.prev_rank) - rank
      : 0

  // Badges: persisted unlocks joined against the code catalog.
  const badges: PublicProfileBadge[] = (badgesRes.error ? [] : badgesRes.data || [])
    .map((b) => {
      const def = ACHIEVEMENTS_BY_ID.get(String(b.achievement_id))
      if (!def) return null
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        rarity: def.rarity,
        icon: def.icon,
        unlockedAt: String(b.unlocked_at)
      }
    })
    .filter((b): b is PublicProfileBadge => b !== null)

  // Tools + consistency stats from raw events in a single pass. Counting
  // goes through the scoring normalizer: heartbeat rows are not visits,
  // and visit rows carry no verified active time.
  const events = eventsRes.events || []

  const toolCounts: Record<string, { v: number; a: number }> = {}
  const dayKeys = new Set<string>()
  let totalActiveMs = 0
  for (const ev of events) {
    const normalized = normalizeLegacyEventValues(ev)
    const d = String(ev.domain || '').toLowerCase()
    if (d) {
      const name = resolveToolName(d)
      if (!toolCounts[name]) toolCounts[name] = { v: 0, a: 0 }
      toolCounts[name].v += normalized.visits
      toolCounts[name].a += normalized.activeMs
    }
    totalActiveMs += normalized.activeMs
    const t = ev.timestamp ? Date.parse(String(ev.timestamp)) : NaN
    if (Number.isFinite(t)) {
      dayKeys.add(new Date(t).toISOString().split('T')[0])
    }
  }
  const visitTotal = Object.values(toolCounts).reduce((s, v) => s + v.v, 0)
  const topTools = Object.entries(toolCounts)
    .sort((a, b) => (b[1].v - a[1].v) || (b[1].a - a[1].a))
    .slice(0, 3)
    .map(([name, val]) => ({
      name,
      visits: val.v,
      active_ms: val.a,
      percent: visitTotal > 0 ? Math.round((val.v / visitTotal) * 100) : 0
    }))

  const now = new Date()
  const lastCalc = row.user_scores?.last_calculated_at || null
  const todayScore = sameUtcDay(lastCalc, now)
    ? Math.round(row.user_scores?.today_score || 0)
    : 0
  const weekScore =
    lastCalc && now.getTime() - new Date(lastCalc).getTime() < 7 * 86400_000
      ? Math.round(row.user_scores?.week_score || 0)
      : 0

  const username = row.twitter_username || `User${row.id}`
  const avatarUrl = String(row.twitter_profile_image || '')
  const provider: 'x' | 'github' | 'other' = avatarUrl.includes('pbs.twimg.com')
    ? 'x'
    : avatarUrl.includes('githubusercontent.com')
      ? 'github'
      : 'other'

  const meta = row.metadata || {}
  const metaSocials = (meta.socials || {}) as Record<string, unknown>
  const socialOr = (key: string, fallback: string | null = null) => {
    const v = metaSocials[key]
    return typeof v === 'string' && v.trim() ? v.trim() : fallback
  }

  const lastSync = row.last_extension_sync
  const isActive = lastSync
    ? Date.now() - new Date(lastSync).getTime() < 24 * 3_600_000
    : false

  return {
    ok: true,
    profile: {
      userId: row.id,
      username,
      display_name: row.twitter_name || username,
      profile_image: row.twitter_profile_image || null,
      banner_image: metaString(meta, 'banner_image'),
      bio: metaString(meta, 'bio'),
      location: metaString(meta, 'location'),
      website: metaString(meta, 'website'),
      socials: {
        x: socialOr('x', provider === 'x' ? username : null),
        github: socialOr('github', provider === 'github' ? username : null),
        youtube: socialOr('youtube'),
        linkedin: socialOr('linkedin')
      },
      role: row.user_type || null,
      tier: normalizeTier(row.subscription_tier),
      memberSince: row.created_at,
      lastSeen: lastSync || row.created_at,
      isActive,
      rank,
      rankDelta,
      score: totalScore,
      todayScore,
      weekScore,
      activeDays: dayKeys.size,
      longestStreak: longestStreakFromDayKeys(dayKeys),
      totalActiveMs,
      topTools,
      badges
    }
  }
}

/* ------------------------------------------------------------------ */
/* Follow graph                                                        */
/* ------------------------------------------------------------------ */

/** True when the follows table hasn't been created yet (migration 013
 *  not applied). PGRST205 = PostgREST schema-cache miss; 42P01 =
 *  undefined_table from Postgres itself. Callers degrade to an empty
 *  graph so profiles keep working before the migration lands. */
export const isMissingFollowsTable = (
  error: { code?: string; message?: string } | null | undefined
): boolean => {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  return /follows.*(schema cache|does not exist)/i.test(error.message || '')
}

export interface FollowCounts {
  followers: number
  following: number
}

export async function getFollowCounts(
  supabase: SupabaseClient,
  userId: number
): Promise<FollowCounts> {
  const [followersRes, followingRes] = await Promise.all([
    supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('followee_id', userId),
    supabase
      .from('follows')
      .select('followee_id', { count: 'exact', head: true })
      .eq('follower_id', userId)
  ])

  for (const res of [followersRes, followingRes]) {
    if (res.error && !isMissingFollowsTable(res.error)) {
      console.error('[PublicProfile] Follow count query error:', res.error)
    }
  }

  return {
    followers: followersRes.error ? 0 : followersRes.count ?? 0,
    following: followingRes.error ? 0 : followingRes.count ?? 0
  }
}

export interface ViewerFollowContext {
  isYou: boolean
  isFollowing: boolean
  followsYou: boolean
}

/** Both directions of the viewer↔target relationship in one round trip. */
export async function getViewerFollowContext(
  supabase: SupabaseClient,
  viewerId: number,
  targetId: number
): Promise<ViewerFollowContext> {
  if (viewerId === targetId) {
    return { isYou: true, isFollowing: false, followsYou: false }
  }

  const { data, error } = await supabase
    .from('follows')
    .select('follower_id, followee_id')
    .or(
      `and(follower_id.eq.${viewerId},followee_id.eq.${targetId}),and(follower_id.eq.${targetId},followee_id.eq.${viewerId})`
    )

  if (error) {
    if (!isMissingFollowsTable(error)) {
      console.error('[PublicProfile] Viewer context query error:', error)
    }
    return { isYou: false, isFollowing: false, followsYou: false }
  }

  const edges = data || []
  return {
    isYou: false,
    isFollowing: edges.some(
      (e) => Number(e.follower_id) === viewerId && Number(e.followee_id) === targetId
    ),
    followsYou: edges.some(
      (e) => Number(e.follower_id) === targetId && Number(e.followee_id) === viewerId
    )
  }
}

export interface MutualFollowProof {
  usernames: string[]
  total: number
}

/**
 * Social proof: which of the accounts the viewer follows also follow the
 * target ("Followed by @a and @b"). Capped lookups keep this cheap; at
 * beta scale the viewer's following set fits in one page.
 */
export async function getMutualFollowerProof(
  supabase: SupabaseClient,
  viewerId: number,
  targetId: number
): Promise<MutualFollowProof | null> {
  const { data: viewerFollowing, error: followingError } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', viewerId)
    .neq('followee_id', targetId)
    .limit(1000)

  if (followingError || !viewerFollowing?.length) return null

  const candidateIds = viewerFollowing.map((r) => Number(r.followee_id))

  const { data: mutuals, error: mutualsError, count } = await supabase
    .from('follows')
    .select('follower_id', { count: 'exact' })
    .eq('followee_id', targetId)
    .in('follower_id', candidateIds)
    .order('created_at', { ascending: false })
    .limit(2)

  if (mutualsError || !mutuals?.length) return null

  const sampleIds = mutuals.map((r) => Number(r.follower_id))
  const { data: names } = await supabase
    .from('users')
    .select('id, twitter_username')
    .in('id', sampleIds)

  const byId = new Map((names || []).map((u) => [Number(u.id), u.twitter_username]))
  const usernames = sampleIds
    .map((id) => byId.get(id))
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

  if (usernames.length === 0) return null
  return { usernames, total: count ?? usernames.length }
}
