import { timingSafeEqual } from 'node:crypto'
import { unstable_cache } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseBannerFrame, type BannerFrame } from '@/lib/bannerFrame'
import { getOwnedPlateIdsBatch, isProTier, resolveEquippedPlate } from '@/lib/entitlements'
import { readRankMovements } from '@/lib/leaderboardSnapshot'
import { isMissingFollowsTable, readAccountIsPrivate } from '@/lib/publicProfile'
import { fetchSeasonState } from '@/lib/seasonServer'
import type { SeasonState } from '@/lib/season'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { getAffiliatedTeamsBatch } from '@/lib/teams'
import { parseStoredTopTools } from '@/lib/userStats'

// The handler stays force-dynamic (per-viewer privacy gating + fresh
// serverTime), but the expensive board assembly is shared: it lives in
// the Data Cache via unstable_cache for 15 seconds, keyed by board kind
// and season state, so every poller in the window rides one set of
// queries. All writes (rank snapshots, demotion notifications) moved to
// the score-write path — see src/lib/leaderboardSnapshot.ts — making this
// GET read-only.
export const dynamic = 'force-dynamic'

const BOARD_REVALIDATE_SECONDS = 15

/** Which standings the caller wants: the season board (default, resets
 *  each season) or the lifetime board. */
type BoardKind = 'season' | 'alltime'

/** Thrown (never returned) by the cached assembly so failures are not
 *  cached and the route can keep its original 500 message. */
const BOARD_LOAD_FAILED = 'LEADERBOARD_LOAD_FAILED'

/** The integrity cron asks for one uncached read so a healthy 15-second
 *  cache window cannot look like rank drift. Invalid probes simply receive
 *  the normal cached public response. */
function isAuthorizedIntegrityProbe(request: NextRequest): boolean {
  if (request.nextUrl.searchParams.get('integrity') !== '1') return false

  const expected =
    process.env.CRON_SECRET ??
    (process.env.NODE_ENV !== 'production' ? 'dev-cron-secret' : null)
  const supplied =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null
  if (!expected || !supplied) return false

  const expectedBytes = Buffer.from(expected)
  const suppliedBytes = Buffer.from(supplied)
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  )
}

const normalizeTier = (
  t: string | null
): 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'AFFILIATE' | 'TEAM' => {
  const v = (t || 'FREE').toUpperCase()
  if (v.includes('TEAM')) return 'TEAM'
  if (v.includes('AFFILIATE')) return 'AFFILIATE'
  if (v.includes('PREMIUM')) return 'PREMIUM'
  if (v.includes('PRO')) return 'PRO'
  if (v.includes('BASIC')) return 'BASIC'
  return 'FREE'
}

const sameUtcDay = (iso: string | null | undefined, now: Date) => {
  if (!iso) return false
  const t = new Date(iso)
  return (
    t.getUTCFullYear() === now.getUTCFullYear() &&
    t.getUTCMonth() === now.getUTCMonth() &&
    t.getUTCDate() === now.getUTCDate()
  )
}

// Row shape for the joined select below (client has no generated DB types)
interface UserRow {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
  created_at: string
  last_extension_sync: string | null
  subscription_tier: string | null
  user_type: string | null
  metadata: Record<string, unknown> | null
  user_scores: {
    total_score: number | null
    today_score: number | null
    week_score: number | null
    season_score?: number | null
    last_calculated_at: string | null
    top_tools?: unknown
  } | null
  user_devices: { is_active: boolean; last_sync_at: string | null }[] | null
}

/** Row returned by migration 059's canonical database ranker. It includes
 *  the profile fields needed to render the board so ranking and hydration
 *  are read from one PostgreSQL statement/snapshot. */
interface CanonicalStandingRow {
  user_id: number | string
  rank: number | string
  score: number | string | null
  total_score: number | string | null
  today_score: number | string | null
  week_score: number | string | null
  season_score: number | string | null
  last_calculated_at: string | null
  top_tools?: unknown
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
  created_at: string
  last_extension_sync: string | null
  subscription_tier: string | null
  user_type: string | null
  metadata: Record<string, unknown> | null
  device_last_sync_at: string | null
}

interface RankedUserRow extends UserRow {
  canonicalRank: number
  canonicalScore: number
}

/** Final standing archived by season_tick() at close. */
interface FrozenStanding {
  rank: number
  score: number
}

/** One assembled board row — plain JSON so the whole payload can live in
 *  the Data Cache. topTools is UNGATED here; privacy gating is applied
 *  per viewer after the cached read. */
interface BoardRow {
  username: string
  display_name: string
  profile_image: string | null
  score: number
  todayScore: number
  weekScore: number
  isActive: boolean
  lastSeen: string
  memberSince: string
  tier: ReturnType<typeof normalizeTier>
  team: { username: string; name: string; logo: string | null } | null
  userId: number
  topTools: { name: string; visits: number; active_ms: number; percent: number }[]
  isPrivate: boolean
  provider: 'x' | 'github' | 'other'
  banner_image: string | null
  banner_frame: BannerFrame | null
  plate: string | null
  socials: {
    x: string | null
    github: string | null
    youtube: string | null
    linkedin: string | null
  }
  role: string | null
  rank: number
  rankDelta: number
  movedAt: string | null
  isNew: boolean
}

/**
 * Which of the given private accounts is the viewer allowed to see
 * tools for? Owner always; otherwise only accounts they follow. A
 * missing follows table (migration 013 not applied) degrades to
 * "none", which fails private — never open.
 */
async function resolveVisiblePrivateIds(
  supabase: SupabaseClient,
  viewerId: number | null,
  privateIds: number[]
): Promise<Set<number>> {
  const visible = new Set<number>()
  if (viewerId === null || privateIds.length === 0) return visible
  if (privateIds.includes(viewerId)) visible.add(viewerId)

  const followCandidates = privateIds.filter((id) => id !== viewerId)
  if (followCandidates.length === 0) return visible

  const { data, error } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', viewerId)
    .in('followee_id', followCandidates)

  if (error) {
    if (!isMissingFollowsTable(error)) {
      console.warn('[Leaderboard] Privacy follow lookup failed:', error.message)
    }
    return visible
  }
  for (const row of data || []) visible.add(Number(row.followee_id))
  return visible
}

/**
 * Assemble the full board — identical for every viewer. Runs inside
 * unstable_cache; must not touch the request and must only READ.
 */
async function assembleBoard(
  board: BoardKind,
  seasonState: SeasonState
): Promise<BoardRow[]> {
  const supabase = createServiceClient()

  const seasonReady = seasonState.current !== null
  const frozenBoard =
    board === 'season' && seasonReady && seasonState.phase === 'intermission'

  // Frozen standings still need a profile lookup. Live standings receive
  // these fields from the canonical ranking RPC in the same SQL snapshot.
  const userProfileSelect = `
      id,
      twitter_username,
      twitter_name,
      twitter_profile_image,
      created_at,
      last_extension_sync,
      subscription_tier,
      user_type,
      metadata,
      user_devices(is_active, last_sync_at)
    `

  // Intermission: the season board serves the archived final standings,
  // exactly as season_tick() locked them — rank and score come from
  // season_results, not from the still-moving user_scores rows.
  let frozenByUser: Map<number, FrozenStanding> | null = null
  if (frozenBoard) {
    const { data: resultRows, error: resultsError } = await supabase
      .from('season_results')
      .select('user_id, final_rank, final_score')
      .eq('season_id', seasonState.current!.id)
      .order('final_rank', { ascending: true })
      .limit(100)

    if (resultsError) {
      console.error('[Leaderboard] Season results query error:', resultsError)
      throw new Error(BOARD_LOAD_FAILED)
    }

    frozenByUser = new Map(
      (resultRows || []).map((row) => [
        Number(row.user_id),
        { rank: Number(row.final_rank), score: Math.round(Number(row.final_score)) }
      ])
    )

    if (frozenByUser.size === 0) return []
  }

  // Migration 059's RPC ranks from user_scores before applying the top-100
  // limit. The API does not derive order or assign ranks itself; the snapshot
  // refresher calls this same function inside its transaction.
  let userRows: RankedUserRow[]
  if (frozenByUser) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(userProfileSelect)
      .in('id', [...frozenByUser.keys()])

    if (usersError) {
      console.error('[Leaderboard] Users query error:', usersError)
      throw new Error(BOARD_LOAD_FAILED)
    }
    userRows = (users || []).map((user) => ({
      ...(user as unknown as Omit<UserRow, 'user_scores'>),
      user_scores: null,
      canonicalRank: frozenByUser!.get(Number(user.id))!.rank,
      canonicalScore: frozenByUser!.get(Number(user.id))!.score
    }))
  } else {
    const { data: standingRows, error: standingsError } = await supabase.rpc(
      'leaderboard_standings',
      { p_board: board, p_limit: 100 }
    )
    if (standingsError) {
      console.error('[Leaderboard] Canonical standings query error:', standingsError)
      throw new Error(BOARD_LOAD_FAILED)
    }

    userRows = ((standingRows || []) as unknown as CanonicalStandingRow[]).map(
      (row) => ({
        id: Number(row.user_id),
        twitter_username: row.twitter_username,
        twitter_name: row.twitter_name,
        twitter_profile_image: row.twitter_profile_image,
        created_at: row.created_at,
        last_extension_sync: row.last_extension_sync,
        subscription_tier: row.subscription_tier,
        user_type: row.user_type,
        metadata: row.metadata,
        user_scores: {
          total_score: Number(row.total_score ?? 0),
          today_score: Number(row.today_score ?? 0),
          week_score: Number(row.week_score ?? 0),
          season_score: Number(row.season_score ?? 0),
          last_calculated_at: row.last_calculated_at,
          top_tools: row.top_tools
        },
        user_devices: row.device_last_sync_at
          ? [{ is_active: true, last_sync_at: row.device_last_sync_at }]
          : [],
        canonicalRank: Number(row.rank),
        canonicalScore: Math.round(Number(row.score ?? 0))
      })
    )
  }

  // Preserve the database-assigned rank order even if a transport or the
  // separate frozen-profile lookup returns rows out of order. This never
  // derives or changes a rank.
  userRows.sort((a, b) => a.canonicalRank - b.canonicalRank)

  if (userRows.length === 0) return []
  const userIds = userRows.map((u) => u.id)

  // Owned plates and team affiliations for the whole board — one
  // user_cosmetics query and one team_affiliations join for all 100
  // ranked users.
  const [ownedPlatesByUser, teamsByUser] = await Promise.all([
    getOwnedPlateIdsBatch(supabase, userIds),
    getAffiliatedTeamsBatch(supabase, userIds)
  ])

  const now = new Date()

  // Build leaderboard data — no per-user DB calls
  const leaderboardData = userRows.map((user) => {
    // today/week scores are only trustworthy if the score row was
    // recalculated inside the window it claims to describe.
    const lastCalc = user.user_scores?.last_calculated_at || null

    const score = user.canonicalScore
    const todayScore = sameUtcDay(lastCalc, now)
      ? Math.round(user.user_scores?.today_score || 0)
      : 0
    const weekScore =
      lastCalc && now.getTime() - new Date(lastCalc).getTime() < 7 * 86400_000
        ? Math.round(user.user_scores?.week_score || 0)
        : 0

    // Top tools from the user_scores rollup (same score-first ranker
    // output as the dashboard tools API), so the podium's "top weapon"
    // always matches the player's dashboard.
    const topTools = parseStoredTopTools(user.user_scores?.top_tools)
      .slice(0, 3)
      .map(({ name, visits, active_ms, percent }) => ({
        name,
        visits,
        active_ms,
        percent
      }))

    // Active status
    const lastSync = user.last_extension_sync || user.user_devices?.[0]?.last_sync_at
    const isActive = lastSync
      ? (Date.now() - new Date(lastSync).getTime()) < (24 * 60 * 60 * 1000)
      : false

    // Auth provider heuristic: X avatars are served from pbs.twimg.com,
    // GitHub avatars from *.githubusercontent.com. (No provider column —
    // GitHub sign-ins reuse the twitter_* columns.)
    const avatarUrl = String(user.twitter_profile_image || '')
    const provider: 'x' | 'github' | 'other' = avatarUrl.includes('pbs.twimg.com')
      ? 'x'
      : avatarUrl.includes('githubusercontent.com')
        ? 'github'
        : 'other'

    const username = user.twitter_username || `User${user.id}`

    // Profile extras live in the free-form metadata JSONB. Fall back to the
    // auth handle for the provider's own network.
    const meta = user.metadata || {}
    const metaSocials = (meta.socials || {}) as Record<string, unknown>
    const socialOr = (key: string, fallback: string | null = null) => {
      const v = metaSocials[key]
      return typeof v === 'string' && v.trim() ? v.trim() : fallback
    }
    const socials = {
      x: socialOr('x', provider === 'x' ? username : null),
      github: socialOr('github', provider === 'github' ? username : null),
      youtube: socialOr('youtube'),
      linkedin: socialOr('linkedin')
    }
    // Read-time Pro gates (same rules as publicProfile): animated
    // banners go dark when the subscription lapses, and the equipped
    // plate is re-validated against ownership/tier on every read.
    const bannerGated =
      meta.banner_animated === true && !isProTier(user.subscription_tier)
    const bannerImage =
      !bannerGated && typeof meta.banner_image === 'string' && meta.banner_image.trim()
        ? meta.banner_image.trim()
        : null
    const plate = resolveEquippedPlate({
      equippedPlateId: meta.equipped_plate,
      tier: user.subscription_tier,
      ownedPlateIds: ownedPlatesByUser.get(user.id) ?? new Set<string>()
    })

    const isPrivate = readAccountIsPrivate(meta)

    // Active affiliation to an approved team — the mini logo next to
    // the name. The batch join already gated the team side (tier TEAM
    // + review approved + not banned), so presence alone means render.
    const affiliatedTeam = teamsByUser.get(user.id) ?? null

    return {
      username,
      display_name: user.twitter_name || user.twitter_username || `User${user.id}`,
      profile_image: user.twitter_profile_image || null,
      score,
      todayScore,
      weekScore,
      isActive,
      lastSeen: lastSync || user.created_at,
      memberSince: user.created_at,
      tier: normalizeTier(user.subscription_tier),
      team: affiliatedTeam
        ? {
            username: affiliatedTeam.username,
            name: affiliatedTeam.name,
            logo: affiliatedTeam.avatar
          }
        : null,
      userId: user.id,
      topTools,
      isPrivate,
      provider,
      banner_image: bannerImage,
      banner_frame: bannerImage ? parseBannerFrame(meta.banner_frame) : null,
      plate,
      socials,
      role: user.user_type || null,
      rank: user.canonicalRank
    }
  })

  // Rank-movement pass — READ-ONLY: decorate every row with its
  // climb/drop delta and NEW status from the snapshots the score-write
  // path maintains. Only the season board (the primary) is decorated —
  // the all-time board ranks by a different column than the snapshot
  // baseline, and a frozen board by definition doesn't move.
  const movements =
    board === 'season' && !frozenBoard
      ? await readRankMovements(
          supabase,
          leaderboardData.map((u) => ({ userId: u.userId, rank: u.rank }))
        )
      : new Map()

  return leaderboardData.map((user) => {
    const movement = movements.get(user.userId)
    return {
      ...user,
      rankDelta: movement?.rankDelta ?? 0,
      movedAt: movement?.movedAt ?? null,
      isNew: movement?.isNew ?? false
    }
  })
}

// The cache key includes the serialized arguments, so each board kind and
// season state caches independently; a season rollover naturally starts a
// fresh entry.
const loadBoardCached = unstable_cache(
  async (board: BoardKind, seasonState: SeasonState) =>
    assembleBoard(board, seasonState),
  ['leaderboard-board'],
  { revalidate: BOARD_REVALIDATE_SECONDS }
)

export async function GET(request: NextRequest) {
  const supabase = createServiceClient()

  try {
    const board: BoardKind =
      request.nextUrl.searchParams.get('board') === 'alltime' ? 'alltime' : 'season'

    // Season calendar first: it decides the ranking column, whether the
    // season board is live or frozen, and the cache key. A missing/empty
    // calendar (migration 025 not applied yet) degrades every board to
    // lifetime ordering. Kept per-request so a rollover is picked up
    // immediately instead of after the cache window.
    const seasonState = await fetchSeasonState(supabase)

    const integrityProbe = isAuthorizedIntegrityProbe(request)
    const boardRows = integrityProbe
      ? await assembleBoard(board, seasonState)
      : await loadBoardCached(board, seasonState)

    // Private-mode pass — per viewer, AFTER the shared cached read: tools
    // are follower-only for private accounts, so resolve who the viewer
    // is and which private pilots they follow — one session read plus at
    // most one follows query, only when the board has private accounts.
    const privateIds = boardRows
      .filter((row) => row.isPrivate)
      .map((row) => row.userId)
    const viewerIndependent = privateIds.length === 0

    let data = boardRows
    if (!viewerIndependent) {
      const session = await getSessionUserId(request)
      const viewerId = session.ok ? session.userId : null
      const visiblePrivateIds = await resolveVisiblePrivateIds(
        supabase,
        viewerId,
        privateIds
      )
      data = boardRows.map((row) =>
        row.isPrivate && !visiblePrivateIds.has(row.userId)
          ? { ...row, topTools: [] }
          : row
      )
    }

    // The response only varies by viewer while private accounts hold
    // board slots; when it doesn't, let the CDN share it too. Otherwise
    // stay conservative — the unstable_cache layer is the real win.
    const cacheControl = integrityProbe
      ? 'private, no-store'
      : viewerIndependent
        ? `public, s-maxage=${BOARD_REVALIDATE_SECONDS}, stale-while-revalidate=60`
        : 'private, no-store'

    return new NextResponse(
      JSON.stringify({
        success: true,
        data,
        serverTime: new Date().toISOString(),
        board,
        season: seasonState
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': cacheControl
        }
      }
    )
  } catch (err) {
    if (err instanceof Error && err.message === BOARD_LOAD_FAILED) {
      return NextResponse.json(
        { success: false, error: 'Failed to load leaderboard' },
        { status: 500 }
      )
    }
    console.error('[Leaderboard] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}
