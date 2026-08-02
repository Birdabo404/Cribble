import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getOwnedPlateIdsBatch, isProTier, resolveEquippedPlate } from '@/lib/entitlements'
import { getEventsIdentityColumn } from '@/lib/eventsIdentity'
import { fetchAllEventPages } from '@/lib/eventsFetch'
import {
  diffStandings,
  type RankMovement,
  type RankSnapshotRow
} from '@/lib/leaderboardEngine'
import {
  evaluateDemotionNotifications,
  type DemotionEvent
} from '@/lib/notifications'
import { isMissingFollowsTable, readAccountIsPrivate } from '@/lib/publicProfile'
import { fetchSeasonState } from '@/lib/seasonServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { getAffiliatedTeamsBatch } from '@/lib/teams'
import { rankToolsFromEvents } from '@/lib/topTools'

export const dynamic = 'force-dynamic'

/** Which standings the caller wants: the season board (default, resets
 *  each season) or the lifetime board. */
type BoardKind = 'season' | 'alltime'

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
  } | null
  user_devices: { is_active: boolean; last_sync_at: string | null }[] | null
}

/** Final standing archived by season_tick() at close. */
interface FrozenStanding {
  rank: number
  score: number
}

/**
 * Diff the fresh standing against the persisted snapshots and record any
 * movements. Tolerates a missing leaderboard_ranks table (migration 012 not
 * applied yet) by reporting zero movement for everyone. Never throws.
 */
async function resolveMovements(
  supabase: SupabaseClient,
  standings: { userId: number; rank: number; score: number }[]
): Promise<Map<number, RankMovement>> {
  try {
    const { data: snapshotRows, error } = await supabase
      .from('leaderboard_ranks')
      .select('user_id, rank, score, prev_rank, rank_moved_at, first_seen_at')

    if (error) {
      console.warn('[Leaderboard] Snapshot read failed:', error.message)
      return new Map()
    }

    const previous = new Map<number, RankSnapshotRow>(
      ((snapshotRows || []) as unknown as RankSnapshotRow[]).map((row) => [
        Number(row.user_id),
        { ...row, score: Number(row.score) }
      ])
    )

    const now = new Date()
    const { movements, inserts, updates } = diffStandings(previous, standings, now)

    // Inserts must not clobber a concurrent read's write; updates are
    // idempotent (same diff produces the same row values).
    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from('leaderboard_ranks')
        .upsert(inserts, { onConflict: 'user_id', ignoreDuplicates: true })
      if (insertError) {
        console.warn('[Leaderboard] Snapshot insert failed:', insertError.message)
      }
    }
    if (updates.length > 0) {
      const { error: updateError } = await supabase
        .from('leaderboard_ranks')
        .upsert(updates, { onConflict: 'user_id' })
      if (updateError) {
        console.warn('[Leaderboard] Snapshot update failed:', updateError.message)
      }
    }

    // Demotion pass: rank_moved_at === now means the drop happened on this
    // diff (score-only updates keep their old timestamp). Awaited because
    // serverless; it never throws, so it cannot break the response.
    const nowIso = now.toISOString()
    const demotions: DemotionEvent[] = []
    for (const update of updates) {
      if (
        update.rank_moved_at === nowIso &&
        update.prev_rank !== null &&
        update.rank > update.prev_rank
      ) {
        demotions.push({
          userId: update.user_id,
          fromRank: update.prev_rank,
          toRank: update.rank
        })
      }
    }
    if (demotions.length > 0) {
      await evaluateDemotionNotifications(supabase, demotions, now)
    }

    return movements
  } catch (err) {
    console.warn('[Leaderboard] Movement tracking unavailable:', err)
    return new Map()
  }
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

export async function GET(request: NextRequest) {
  const supabase = createServiceClient()

  try {
    const board: BoardKind =
      request.nextUrl.searchParams.get('board') === 'alltime' ? 'alltime' : 'season'

    // Season calendar first: it decides the ranking column and whether the
    // season board is live or frozen. A missing/empty calendar (migration
    // 025 not applied yet) degrades every board to lifetime ordering.
    const seasonState = await fetchSeasonState(supabase)
    const seasonReady = seasonState.current !== null
    const liveSeasonBoard =
      board === 'season' && seasonReady && seasonState.phase === 'active'
    const frozenBoard =
      board === 'season' && seasonReady && seasonState.phase === 'intermission'

    const scoresSelect = seasonReady
      ? 'total_score, today_score, week_score, season_score, last_calculated_at'
      : 'total_score, today_score, week_score, last_calculated_at'
    const usersSelect = `
        id,
        twitter_username,
        twitter_name,
        twitter_profile_image,
        created_at,
        last_extension_sync,
        subscription_tier,
        user_type,
        metadata,
        user_scores(${scoresSelect}),
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
        return NextResponse.json(
          { success: false, error: 'Failed to load leaderboard' },
          { status: 500 }
        )
      }

      frozenByUser = new Map(
        (resultRows || []).map((row) => [
          Number(row.user_id),
          { rank: Number(row.final_rank), score: Math.round(Number(row.final_score)) }
        ])
      )

      if (frozenByUser.size === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          serverTime: new Date().toISOString(),
          board,
          season: seasonState
        })
      }
    }

    // Batch query 1: all users with scores and devices in one query.
    // Banned and suspended accounts are filtered in the query itself so
    // they never occupy one of the 100 board slots (status is NULL on
    // rows that predate migration 003 — treated as active), and so are
    // TEAM-tier company accounts — they buy badges and affiliate seats,
    // they don't compete personally. Both exclusions happen before the
    // sort/limit, so ranks are assigned over eligible players only. The
    // frozen board instead loads exactly the archived users — the
    // archive is history and keeps rendering whoever earned a place on
    // it.
    let usersQuery = supabase.from('users').select(usersSelect)
    if (frozenByUser) {
      usersQuery = usersQuery.in('id', [...frozenByUser.keys()])
    } else {
      usersQuery = usersQuery
        .or('status.is.null,status.eq.active')
        .or('subscription_tier.is.null,subscription_tier.neq.TEAM')
        .order(liveSeasonBoard ? 'season_score' : 'total_score', {
          ascending: false,
          referencedTable: 'user_scores',
          nullsFirst: false
        })
        .limit(100)
    }
    const { data: users, error: usersError } = await usersQuery

    if (usersError) {
      console.error('[Leaderboard] Users query error:', usersError)
      return NextResponse.json({ success: false, error: 'Failed to load leaderboard' }, { status: 500 })
    }

    if (!users || users.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        serverTime: new Date().toISOString(),
        board,
        season: seasonState
      })
    }

    // The select string is composed at runtime, so the client can't infer
    // a row type — same unknown hop the rest of the codebase uses.
    const userRows = users as unknown as UserRow[]

    // Batch query 2: ALL events for all users at once (instead of 1 query per
    // user), paged past the PostgREST max-rows cap so heavy users' tool
    // stats aren't computed from an arbitrary 1000-row subset.
    const userIds = userRows.map((u) => u.id)
    const eventsUserColumn = await getEventsIdentityColumn(supabase)

    // timestamp/total_ms ride along because tool ranking scores each tool's
    // events as sessions — the same math as the dashboard tools API.
    type LeaderboardEventRow = {
      user_id: number | string | null
      twitter_user_id: number | null
      domain: string | null
      visits: number | null
      active_ms: number | null
      total_ms: number | null
      timestamp: string | null
    }

    // Owned plates and team affiliations for the whole board ride
    // alongside the events fetch — one user_cosmetics query and one
    // team_affiliations join for all 100 ranked users.
    const [eventsResult, ownedPlatesByUser, teamsByUser] = await Promise.all([
      eventsUserColumn
        ? fetchAllEventPages<LeaderboardEventRow>(
            (from, to) =>
              supabase
                .from('events_raw')
                .select('user_id, twitter_user_id, domain, visits, active_ms, total_ms, timestamp')
                .in(eventsUserColumn, userIds)
                .order('timestamp', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to) as PromiseLike<{
                  data: LeaderboardEventRow[] | null
                  error: { message: string } | null
                }>
          )
        : Promise.resolve({ rows: [] as LeaderboardEventRow[], error: null }),
      getOwnedPlateIdsBatch(supabase, userIds),
      getAffiliatedTeamsBatch(supabase, userIds)
    ])
    const { rows: allEvents, error: eventsError } = eventsResult

    if (eventsError) {
      console.error('[Leaderboard] Events query error:', eventsError)
    }

    // Group events by user id in memory (respect legacy twitter_user_id column)
    const eventsByUser: Record<number, LeaderboardEventRow[]> = {}
    for (const event of allEvents) {
      const ownerRaw =
        eventsUserColumn === 'twitter_user_id'
          ? event.twitter_user_id
          : event.user_id
      if (ownerRaw == null) continue
      const ownerId = Number(ownerRaw)
      if (!eventsByUser[ownerId]) eventsByUser[ownerId] = []
      eventsByUser[ownerId]!.push(event)
    }

    const now = new Date()

    // Private-mode pass: tools are follower-only for private accounts, so
    // resolve who the viewer is and which private pilots they follow —
    // one session read plus at most one follows query for the whole board.
    const privateIds = userRows
      .filter((u) => readAccountIsPrivate(u.metadata))
      .map((u) => u.id)
    const session = privateIds.length > 0 ? await getSessionUserId(request) : null
    const viewerId = session?.ok ? session.userId : null
    const visiblePrivateIds = await resolveVisiblePrivateIds(
      supabase,
      viewerId,
      privateIds
    )

    // Live season ranks by season_score with a staleness guard: a score
    // row last recalculated before the season started can only be carrying
    // a previous season's value (the start-of-season zeroing makes this a
    // no-op in practice, but it keeps the board honest if a tick was
    // missed across the rollover).
    const seasonStartMs = liveSeasonBoard
      ? Date.parse(seasonState.current!.startsAt)
      : 0

    // Build leaderboard data — no per-user DB calls
    const leaderboardData = userRows.map((user) => {
      // today/week scores are only trustworthy if the score row was
      // recalculated inside the window it claims to describe.
      const lastCalc = user.user_scores?.last_calculated_at || null

      let score: number
      if (frozenByUser) {
        score = frozenByUser.get(user.id)?.score ?? 0
      } else if (liveSeasonBoard) {
        const lastCalcMs = lastCalc ? new Date(lastCalc).getTime() : 0
        score =
          lastCalcMs >= seasonStartMs
            ? Math.round(user.user_scores?.season_score || 0)
            : 0
      } else {
        score = Math.round(user.user_scores?.total_score || 0)
      }
      const todayScore = sameUtcDay(lastCalc, now)
        ? Math.round(user.user_scores?.today_score || 0)
        : 0
      const weekScore =
        lastCalc && now.getTime() - new Date(lastCalc).getTime() < 7 * 86400_000
          ? Math.round(user.user_scores?.week_score || 0)
          : 0

      // Top tools from pre-fetched events via the shared score-first ranker,
      // so the podium's "top weapon" always matches the player's dashboard.
      const userEvents = eventsByUser[user.id] || []
      const topTools = rankToolsFromEvents(userEvents)
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
      const toolsHidden = isPrivate && !visiblePrivateIds.has(user.id)

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
        topTools: toolsHidden ? [] : topTools,
        isPrivate,
        provider,
        banner_image: bannerImage,
        plate,
        socials,
        role: user.user_type || null
      }
    })
      // Frozen boards keep their archived ranks verbatim; live boards
      // re-rank on every read. The userId tiebreak keeps equal scores in a
      // stable order — otherwise tied players flip-flop ranks between
      // reads and spray bogus movement arrows.
      .sort((a, b) => {
        if (frozenByUser) {
          return (
            (frozenByUser.get(a.userId)?.rank ?? Infinity) -
            (frozenByUser.get(b.userId)?.rank ?? Infinity)
          )
        }
        return b.score - a.score || a.userId - b.userId
      })
      .map((user, idx) => ({
        ...user,
        rank: frozenByUser ? frozenByUser.get(user.userId)?.rank ?? idx + 1 : idx + 1
      }))

    // Rank-movement pass: diff against the persisted snapshots and annotate
    // every row with its climb/drop delta and NEW status. Only the season
    // board (the primary) diffs — the all-time board ranks by a different
    // column and would fight over the single snapshot baseline, and a
    // frozen board by definition doesn't move.
    const movements =
      board === 'season' && !frozenBoard
        ? await resolveMovements(
            supabase,
            leaderboardData.map((u) => ({ userId: u.userId, rank: u.rank, score: u.score }))
          )
        : new Map<number, RankMovement>()

    const annotated = leaderboardData.map((user) => {
      const movement = movements.get(user.userId)
      return {
        ...user,
        rankDelta: movement?.rankDelta ?? 0,
        movedAt: movement?.movedAt ?? null,
        isNew: movement?.isNew ?? false
      }
    })

    return new NextResponse(
      JSON.stringify({
        success: true,
        data: annotated,
        serverTime: now.toISOString(),
        board,
        season: seasonState
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    )
  } catch (err) {
    console.error('[Leaderboard] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}
