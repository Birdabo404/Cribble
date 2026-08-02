import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser, resolveStaffRole } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Full moderation dossier for one user: identity, account state, the
// profile content staff can act on, owned cosmetics, live session count
// and the audit history targeting them. Read-only — every action lives
// in its own sibling route.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'user.view')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const { id } = await params
  const userId = Number(id)
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select(
        `id, twitter_username, twitter_name, twitter_profile_image, status,
         subscription_tier, user_type, staff_role, is_admin, admin_notes,
         team_review_status, team_approved_at,
         metadata, created_at, last_login, last_extension_sync, onboarded_at,
         user_scores(total_score, today_score, week_score)`
      )
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('[AdminUserDetail] User query failed:', error)
      return NextResponse.json({ error: 'Failed to load user' }, { status: 500 })
    }
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const [cosmeticsRes, sessionsRes, auditRes] = await Promise.all([
      supabase
        .from('user_cosmetics')
        .select('item_type, item_id, acquired_via, source_order_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('user_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString()),
      supabase
        .from('admin_activity_log')
        .select(
          `id, admin_user_id, action, old_values, new_values, reason, created_at,
           admin:users!admin_activity_log_admin_user_id_fkey(twitter_username)`
        )
        .eq('target_user_id', userId)
        .order('id', { ascending: false })
        .limit(20)
    ])

    const meta = (user.metadata || {}) as Record<string, unknown>
    const socials = (meta.socials || {}) as Record<string, unknown>
    // One row per user at runtime; the client infers an array without
    // generated DB types (same unknown hop the leaderboard route uses).
    const scores = (user.user_scores || null) as unknown as {
      total_score: number | null
      today_score: number | null
      week_score: number | null
    } | null

    return NextResponse.json({
      success: true,
      user: {
        userId: Number(user.id),
        username: user.twitter_username || null,
        display_name: user.twitter_name || user.twitter_username || `User${user.id}`,
        profile_image: user.twitter_profile_image || null,
        status: user.status || 'active',
        tier: (user.subscription_tier || 'FREE').toUpperCase(),
        team_review_status: user.team_review_status ?? null,
        team_approved_at: user.team_approved_at ?? null,
        role: user.user_type || null,
        staff_role: resolveStaffRole(user),
        admin_notes: str(user.admin_notes),
        created_at: user.created_at,
        last_login: user.last_login,
        last_extension_sync: user.last_extension_sync,
        onboarded_at: user.onboarded_at,
        total_score: Math.round(Number(scores?.total_score || 0)),
        active_sessions: sessionsRes.count ?? 0,
        profile: {
          bio: str(meta.bio),
          location: str(meta.location),
          website: str(meta.website),
          banner_image: str(meta.banner_image),
          banner_animated: meta.banner_animated === true,
          equipped_plate: str(meta.equipped_plate),
          is_private: meta.is_private === true,
          socials: {
            x: str(socials.x),
            github: str(socials.github),
            youtube: str(socials.youtube),
            linkedin: str(socials.linkedin)
          }
        },
        cosmetics: (cosmeticsRes.error ? [] : cosmeticsRes.data || []).map((row) => ({
          item_type: row.item_type,
          item_id: row.item_id,
          acquired_via: row.acquired_via,
          source_order_id: row.source_order_id,
          created_at: row.created_at
        })),
        audit: (auditRes.error ? [] : auditRes.data || []).map((row) => ({
          id: Number(row.id),
          admin_user_id: row.admin_user_id === null ? null : Number(row.admin_user_id),
          admin_username:
            (row.admin as unknown as { twitter_username: string | null } | null)
              ?.twitter_username ?? null,
          action: row.action,
          old_values: row.old_values ?? null,
          new_values: row.new_values ?? null,
          reason: row.reason ?? null,
          created_at: row.created_at
        }))
      }
    })
  } catch (err) {
    console.error('[AdminUserDetail] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
