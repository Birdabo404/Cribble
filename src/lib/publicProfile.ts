// Shared public-profile assembly. One builder feeds both profile
// endpoints (/api/leaderboard/profile by id, /api/profile/[username]
// by handle) so the leaderboard card and the full profile page can
// never drift apart. Exposes only data already visible on the
// leaderboard plus persisted achievement unlocks, the user's own
// published profile fields (bio, location, website, socials), and —
// strictly opt-in via the token-sharing consent — their agent CLI mix.
// Never emails, devices or admin fields.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACHIEVEMENTS_BY_ID,
  type AchievementIcon,
  type AchievementRarity
} from '@/lib/achievements'
import { parseBannerFrame, type BannerFrame } from '@/lib/bannerFrame'
import {
  getOwnedPlateIds,
  isApprovedTeam,
  isProTier,
  resolveEquippedPlate
} from '@/lib/entitlements'
import {
  buildProfileAgents,
  type AgentProfileRow,
  type PublicProfileAgent
} from '@/lib/profileAgents'
import { getAffiliatedTeamsBatch } from '@/lib/teams'
import {
  ensureUserStatsRollup,
  USER_STATS_ROLLUP_SELECT,
  type UserStatsRollupColumns
} from '@/lib/userStats'

/**
 * Data Cache tag for one handle's cached /api/profile/[username] payload.
 * Writers that change what that endpoint serves (profile PATCH, OAuth
 * identity refresh) revalidate this tag so a just-saved profile shows up
 * immediately instead of waiting out the cache TTL.
 */
export function publicProfileCacheTag(username: string): string {
  return `public-profile:${username.trim().toLowerCase()}`
}

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
  /** Stored reposition/zoom for banner_image — null when the crop is
   *  default or the banner itself is gated/absent. */
  banner_frame: BannerFrame | null
  /** Equipped leaderboard plate, already ownership/tier-validated server-side. */
  plate: string | null
  bio: string | null
  location: string | null
  website: string | null
  /** "Now Building" pinned project — non-null only when a valid
   *  project_url is saved. name is the owner's label, or derived
   *  server-side (owner/repo for GitHub URLs, else the hostname). */
  project: { url: string; name: string } | null
  socials: {
    x: string | null
    github: string | null
    youtube: string | null
    linkedin: string | null
  }
  role: string | null
  tier: 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'AFFILIATE' | 'TEAM'
  /** Approved Team account (tier TEAM + review passed + not suspended):
   *  gold TeamBadge, square avatar, Affiliates section. Tier TEAM alone
   *  stays false. */
  isTeam: boolean
  /** This user's one ACTIVE affiliation to an approved team, or null —
   *  drives the mini team logo next to their name. */
  team: { username: string; name: string; logo: string | null } | null
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
  /** Opt-in agent CLI mix by share of lifetime tokens — empty unless the
   *  owner enabled token sharing (consent v2). Never a ranking input. */
  topAgents: PublicProfileAgent[]
  badges: PublicProfileBadge[]
  /** Account is in private mode (owner opted in via profile settings). */
  isPrivate: boolean
  /** True when the current viewer cannot see the gated sections
   *  (topTools/badges are emptied server-side in that case). */
  restricted: boolean
}

interface ProfileUserRow {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
  created_at: string
  last_extension_sync: string | null
  subscription_tier: string | null
  team_review_status: string | null
  user_type: string | null
  status: string | null
  metadata: Record<string, unknown> | null
  user_scores:
    | ({
        total_score: number | null
        today_score: number | null
        week_score: number | null
        last_calculated_at: string | null
      } & UserStatsRollupColumns)
    | null
}

const PROFILE_USER_SELECT = `
  id,
  twitter_username,
  twitter_name,
  twitter_profile_image,
  created_at,
  last_extension_sync,
  subscription_tier,
  team_review_status,
  user_type,
  status,
  metadata,
  user_scores(total_score, today_score, week_score, last_calculated_at, ${USER_STATS_ROLLUP_SELECT})
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
  if (v.includes('TEAM')) return 'TEAM'
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

/** "Now Building" pinned project. The URL was validated by cleanHttpUrl
 *  on write; a name the owner typed wins, otherwise derive owner/repo
 *  for GitHub URLs and fall back to the hostname. A URL that no longer
 *  parses (hand-edited metadata) yields null — no link, no chip. */
const readProject = (
  meta: Record<string, unknown>
): PublicProfile['project'] => {
  const url = metaString(meta, 'project_url')
  if (!url) return null
  const explicit = metaString(meta, 'project_name')
  if (explicit) return { url, name: explicit }
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'github.com') {
      const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
      if (owner && repo) return { url, name: `${owner}/${repo.replace(/\.git$/, '')}` }
    }
    return { url, name: host }
  } catch {
    return null
  }
}

/** Account privacy flag lives in users.metadata alongside the other
 *  self-service profile fields. Anything other than literal true reads
 *  as public, so legacy rows need no backfill. */
export const readAccountIsPrivate = (
  meta: Record<string, unknown> | null | undefined
): boolean => Boolean(meta) && (meta as Record<string, unknown>).is_private === true

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
  const tier = normalizeTier(row.subscription_tier)

  // Rank + movement, unlocked badges, this player's stats rollup, their
  // owned plates, and their team affiliation — all in parallel. The
  // rollup reads straight off the already-fetched user_scores columns;
  // only a row that predates migration 036 (stats_updated_at NULL) pays
  // a one-time events backfill here.
  const [rankRes, snapshotRes, badgesRes, rollup, ownedPlateIds, affiliatedTeams, agentsRes] =
    await Promise.all([
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
      ensureUserStatsRollup(supabase, row.id, row.user_scores ?? null),
      getOwnedPlateIds(supabase, row.id),
      getAffiliatedTeamsBatch(supabase, [row.id]),
      supabase.rpc('agent_profile_agents', { p_user_id: row.id })
    ])

  const rank =
    totalScore > 0 && rankRes.count !== null && !rankRes.error
      ? rankRes.count + 1
      : null

  // The one ACTIVE affiliation, already gated on the team side
  // (tier TEAM + approved + not banned) by getAffiliatedTeamsBatch.
  const affiliatedTeam = affiliatedTeams.get(row.id) ?? null

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

  // Consistency stats and top tools from the user_scores rollup — the
  // same aggregation this builder used to run over raw events per view
  // (and the same score-first tool ranker as the dashboard tools API and
  // the leaderboard), so surfaces never disagree about a player's #1
  // tool. A null rollup (backfill needed but events unreadable) degrades
  // to zeros/empty, exactly like a failed events fetch did before.
  const topTools: PublicProfileTool[] = (rollup?.topTools ?? [])
    .slice(0, 3)
    .map(({ name, visits, active_ms, percent }) => ({
      name,
      visits,
      active_ms,
      percent
    }))

  // Agent CLI mix — at most one consent-gated aggregate row; zero rows
  // means not opted in, no usage, or not active. PGRST202/42883 mean
  // migration 058 hasn't deployed yet (same tolerance as the tokens
  // route); any error degrades to an empty block without failing the
  // profile, since this is display-only decoration.
  if (
    agentsRes.error &&
    agentsRes.error.code !== 'PGRST202' &&
    agentsRes.error.code !== '42883'
  ) {
    console.error('[PublicProfile] Agent breakdown query error:', agentsRes.error)
  }
  const agentRows = (agentsRes.error ? [] : agentsRes.data ?? []) as AgentProfileRow[]
  const topAgents = buildProfileAgents(agentRows[0] ?? null)

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

  // Read-time Pro gates: an animated banner goes dark the moment the
  // subscription lapses, and the equipped plate must still be usable.
  const bannerImage =
    meta.banner_animated === true && !isProTier(row.subscription_tier)
      ? null
      : metaString(meta, 'banner_image')
  const plate = resolveEquippedPlate({
    equippedPlateId: meta.equipped_plate,
    tier: row.subscription_tier,
    ownedPlateIds
  })

  return {
    ok: true,
    profile: {
      userId: row.id,
      username,
      display_name: row.twitter_name || username,
      profile_image: row.twitter_profile_image || null,
      banner_image: bannerImage,
      banner_frame: bannerImage ? parseBannerFrame(meta.banner_frame) : null,
      plate,
      bio: metaString(meta, 'bio'),
      location: metaString(meta, 'location'),
      website: metaString(meta, 'website'),
      project: readProject(meta),
      socials: {
        x: socialOr('x', provider === 'x' ? username : null),
        github: socialOr('github', provider === 'github' ? username : null),
        youtube: socialOr('youtube'),
        linkedin: socialOr('linkedin')
      },
      role: row.user_type || null,
      tier,
      // Suspended accounts must not light team surfaces (banned rows
      // 404 above) — same status convention as getAffiliatedTeamsBatch:
      // NULL predates migration 003 and reads as active.
      isTeam:
        isApprovedTeam(row) && (row.status === null || row.status === 'active'),
      team: affiliatedTeam
        ? {
            username: affiliatedTeam.username,
            name: affiliatedTeam.name,
            logo: affiliatedTeam.avatar
          }
        : null,
      memberSince: row.created_at,
      lastSeen: lastSync || row.created_at,
      isActive,
      rank,
      rankDelta,
      score: totalScore,
      todayScore,
      weekScore,
      activeDays: rollup?.activeDays ?? 0,
      longestStreak: rollup?.longestStreak ?? 0,
      totalActiveMs: rollup?.totalActiveMs ?? 0,
      topTools,
      topAgents,
      badges,
      isPrivate: readAccountIsPrivate(meta),
      restricted: false
    }
  }
}

/* ------------------------------------------------------------------ */
/* Account privacy                                                     */
/* ------------------------------------------------------------------ */

/**
 * Enforce private-mode gating for a viewer. Private accounts keep their
 * identity, bio and score public (they are on the leaderboard anyway),
 * but top tools and the service record are follower-only: anyone who
 * isn't the owner or a follower gets them emptied plus restricted=true
 * so clients can render a locked state instead of "no data".
 */
export function gateProfileForViewer(
  profile: PublicProfile,
  viewer: ViewerFollowContext | null
): PublicProfile {
  const canSee =
    !profile.isPrivate || viewer?.isYou === true || viewer?.isFollowing === true
  if (canSee) return profile
  return { ...profile, topTools: [], topAgents: [], badges: [], restricted: true }
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
