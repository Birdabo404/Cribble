import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventsIdentityColumn } from '@/lib/eventsIdentity'
import { fetchAllEventPages } from '@/lib/eventsFetch'
import {
  diffStandings,
  type RankMovement,
  type RankSnapshotRow
} from '@/lib/leaderboardEngine'
import { normalizeLegacyEventValues } from '@/lib/scoring'
import { createServiceClient } from '@/lib/supabaseServer'
import { resolveToolName } from '@/lib/toolNames'

export const dynamic = 'force-dynamic'

const normalizeTier = (
  t: string | null
): 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'AFFILIATE' => {
  const v = (t || 'FREE').toUpperCase()
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
    last_calculated_at: string | null
  } | null
  user_devices: { is_active: boolean; last_sync_at: string | null }[] | null
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

    const { movements, inserts, updates } = diffStandings(previous, standings)

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

    return movements
  } catch (err) {
    console.warn('[Leaderboard] Movement tracking unavailable:', err)
    return new Map()
  }
}

export async function GET() {
  const supabase = createServiceClient()

  try {
    // Batch query 1: all users with scores and devices in one query
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(`
        id,
        twitter_username,
        twitter_name,
        twitter_profile_image,
        created_at,
        last_extension_sync,
        subscription_tier,
        user_type,
        metadata,
        user_scores(total_score, today_score, week_score, last_calculated_at),
        user_devices(is_active, last_sync_at)
      `)
      .order('total_score', { ascending: false, referencedTable: 'user_scores', nullsFirst: false })
      .limit(100)

    if (usersError) {
      console.error('[Leaderboard] Users query error:', usersError)
      return NextResponse.json({ success: false, error: 'Failed to load leaderboard' }, { status: 500 })
    }

    if (!users || users.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    // Batch query 2: ALL events for all users at once (instead of 1 query per
    // user), paged past the PostgREST max-rows cap so heavy users' tool
    // stats aren't computed from an arbitrary 1000-row subset.
    const userIds = users.map((u) => u.id)
    const eventsUserColumn = await getEventsIdentityColumn(supabase)

    type LeaderboardEventRow = {
      user_id: number | string | null
      twitter_user_id: number | null
      domain: string | null
      visits: number | null
      active_ms: number | null
    }

    const { rows: allEvents, error: eventsError } = eventsUserColumn
      ? await fetchAllEventPages<LeaderboardEventRow>(
          (from, to) =>
            supabase
              .from('events_raw')
              .select('user_id, twitter_user_id, domain, visits, active_ms')
              .in(eventsUserColumn, userIds)
              .order('timestamp', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to) as PromiseLike<{
                data: LeaderboardEventRow[] | null
                error: { message: string } | null
              }>
        )
      : { rows: [] as LeaderboardEventRow[], error: null }

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

    // Build leaderboard data — no per-user DB calls
    const leaderboardData = (users as unknown as UserRow[]).map((user) => {
      const score = Math.round(user.user_scores?.total_score || 0)

      // today/week scores are only trustworthy if the score row was
      // recalculated inside the window it claims to describe.
      const lastCalc = user.user_scores?.last_calculated_at || null
      const todayScore = sameUtcDay(lastCalc, now)
        ? Math.round(user.user_scores?.today_score || 0)
        : 0
      const weekScore =
        lastCalc && now.getTime() - new Date(lastCalc).getTime() < 7 * 86400_000
          ? Math.round(user.user_scores?.week_score || 0)
          : 0

      // Top tools from pre-fetched events, named via the shared resolver so
      // the leaderboard, tools API and achievements all agree. Counting goes
      // through the scoring normalizer: heartbeat rows are NOT visits (the
      // old `visits || active_ms ? 1 : 0` fallback counted every 5s tick as
      // a visit, inflating counts ~8x) and visit rows carry no active time.
      const userEvents = eventsByUser[user.id] || []
      const counts: Record<string, { v: number; a: number }> = {}
      for (const ev of userEvents) {
        const d = String(ev.domain || '').toLowerCase()
        if (!d) continue
        const name = resolveToolName(d)
        if (!counts[name]) counts[name] = { v: 0, a: 0 }
        const normalized = normalizeLegacyEventValues(ev)
        counts[name].v += normalized.visits
        counts[name].a += normalized.activeMs
      }
      const visitTotal = Object.values(counts).reduce((s, v) => s + v.v, 0)
      const topTools = Object.entries(counts)
        .sort((a, b) => (b[1].v - a[1].v) || (b[1].a - a[1].a))
        .slice(0, 3)
        .map(([name, val]) => ({
          name,
          visits: val.v,
          active_ms: val.a,
          percent: visitTotal > 0 ? Math.round((val.v / visitTotal) * 100) : 0
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
      const bannerImage =
        typeof meta.banner_image === 'string' && meta.banner_image.trim()
          ? meta.banner_image.trim()
          : null

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
        userId: user.id,
        topTools,
        provider,
        banner_image: bannerImage,
        socials,
        role: user.user_type || null
      }
    })
      // userId tiebreak keeps equal scores in a stable order — otherwise tied
      // players flip-flop ranks between reads and spray bogus movement arrows.
      .sort((a, b) => b.score - a.score || a.userId - b.userId)
      .map((user, idx) => ({ ...user, rank: idx + 1 }))

    // Rank-movement pass: diff against the persisted snapshots and annotate
    // every row with its climb/drop delta and NEW status.
    const movements = await resolveMovements(
      supabase,
      leaderboardData.map((u) => ({ userId: u.userId, rank: u.rank, score: u.score }))
    )

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
      JSON.stringify({ success: true, data: annotated, serverTime: now.toISOString() }),
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
