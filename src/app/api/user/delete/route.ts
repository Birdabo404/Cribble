import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'
import { validateEmail } from '@/lib/validation'
import { applyEventsUserEq, toCompatUserUuid } from '@/lib/eventsIdentity'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'

// GDPR Art. 17 (right to erasure) endpoint. Deletes the account and every
// row of personal data tied to it, immediately and irreversibly. Optionally
// also erases a waitlist signup: accounts are OAuth-only and never store an
// email, so the waitlist entry can only be matched by the address the user
// provides in the confirmation dialog.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

// Newer tables (follows, notifications, …) and legacy columns don't exist in
// every environment; erasure of the rest must not fail on those.
const isMissingTableOrColumn = (
  error: { code?: string; message?: string } | null | undefined
): boolean => {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703') return true
  return /schema cache|does not exist/i.test(error.message || '')
}

export async function DELETE(request: NextRequest) {
  try {
    // Strict budget: a destructive endpoint has no legitimate high-rate use.
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.auth)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }
    const userId = session.userId

    // Explicit confirmation in the body keeps a stray DELETE request (or a
    // replayed/forged one) from erasing an account.
    let body: { confirm?: unknown; email?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (body.confirm !== 'DELETE') {
      return NextResponse.json(
        { error: 'Confirmation required. Send { "confirm": "DELETE" }.' },
        { status: 400 }
      )
    }

    let waitlistEmail: string | null = null
    if (typeof body.email === 'string' && body.email.trim() !== '') {
      const check = validateEmail(body.email.trim())
      if (!check.isValid || !check.sanitized) {
        return NextResponse.json(
          { error: check.error || 'Invalid email address' },
          { status: 400 }
        )
      }
      waitlistEmail = check.sanitized
    }

    console.log(`[DeleteAccount] Erasing all data for user ${userId}`)

    // -- Raw telemetry -----------------------------------------------------
    // events_raw is schema-drifty: current deployments key rows on the
    // legacy twitter_user_id integer (FK to users, NO ACTION — surviving
    // rows would block the users delete) plus a deterministic compat UUID
    // in user_id; repo-migration databases key on an integer user_id.
    // The compat layer picks the right column for this deployment.
    const eventsBase = supabase.from('events_raw').delete()
    const { query: eventsQuery, column: eventsColumn } = await applyEventsUserEq(
      supabase,
      eventsBase,
      userId
    )
    const { error: eventsError } = await (eventsColumn
      ? eventsQuery
      : eventsBase.eq('user_id', userId))
    if (eventsError && !isMissingTableOrColumn(eventsError)) {
      console.error('[DeleteAccount] Failed to delete events:', eventsError)
      return NextResponse.json({ error: 'Failed to erase activity data' }, { status: 500 })
    }
    if (eventsColumn === 'twitter_user_id') {
      const { error: compatError } = await supabase
        .from('events_raw')
        .delete()
        .eq('user_id', toCompatUserUuid(userId))
      if (compatError && !isMissingTableOrColumn(compatError)) {
        console.error('[DeleteAccount] Failed to delete compat-keyed events:', compatError)
        return NextResponse.json({ error: 'Failed to erase activity data' }, { status: 500 })
      }
    }

    // daily_metrics: legacy aggregate table (no app code writes it anymore)
    // with the same twitter_user_id FK (NO ACTION) in live databases.
    const { error: metricsError } = await supabase
      .from('daily_metrics')
      .delete()
      .eq('twitter_user_id', userId)
    if (metricsError && !isMissingTableOrColumn(metricsError)) {
      console.error('[DeleteAccount] Failed to delete daily metrics:', metricsError)
      return NextResponse.json({ error: 'Failed to erase activity data' }, { status: 500 })
    }

    // -- Admin audit log ---------------------------------------------------
    // References users(id) with NO ACTION, so any surviving reference blocks
    // the users delete. Rows ABOUT this user contain their data (old/new
    // values) — erase them. Rows of actions this user performed as an admin
    // stay, but anonymized.
    const { error: adminTargetError } = await supabase
      .from('admin_activity_log')
      .delete()
      .eq('target_user_id', userId)
    if (adminTargetError && !isMissingTableOrColumn(adminTargetError)) {
      console.error('[DeleteAccount] Failed to delete admin log entries:', adminTargetError)
      return NextResponse.json({ error: 'Failed to erase account records' }, { status: 500 })
    }
    const { error: adminActorError } = await supabase
      .from('admin_activity_log')
      .update({ admin_user_id: null })
      .eq('admin_user_id', userId)
    if (adminActorError && !isMissingTableOrColumn(adminActorError)) {
      console.error('[DeleteAccount] Failed to anonymize admin log entries:', adminActorError)
      return NextResponse.json({ error: 'Failed to erase account records' }, { status: 500 })
    }

    // -- Cascade-covered tables ---------------------------------------------
    // All of these cascade from the users delete in the live schema, but
    // explicit deletes make failures visible now (and cover databases built
    // from the repo migrations, where user_devices has no FK at all).
    // daily_tool_aggregates is intentionally absent: true anonymized
    // aggregates persist after deletion, per the privacy policy.
    const cascadeTargets: {
      table: string
      run: () => PromiseLike<{ error: { code?: string; message?: string } | null }>
    }[] = [
      { table: 'user_devices', run: () => supabase.from('user_devices').delete().eq('user_id', userId) },
      { table: 'extension_user_mappings', run: () => supabase.from('extension_user_mappings').delete().eq('twitter_user_id', userId) },
      { table: 'notifications', run: () => supabase.from('notifications').delete().eq('user_id', userId) },
      { table: 'user_achievements', run: () => supabase.from('user_achievements').delete().eq('user_id', userId) },
      { table: 'leaderboard_ranks', run: () => supabase.from('leaderboard_ranks').delete().eq('user_id', userId) },
      { table: 'follows', run: () => supabase.from('follows').delete().or(`follower_id.eq.${userId},followee_id.eq.${userId}`) },
      { table: 'user_scores', run: () => supabase.from('user_scores').delete().eq('user_id', userId) },
      { table: 'usage_sessions', run: () => supabase.from('usage_sessions').delete().eq('user_id', userId) },
      { table: 'user_sessions', run: () => supabase.from('user_sessions').delete().eq('user_id', userId) }
    ]
    for (const target of cascadeTargets) {
      const { error } = await target.run()
      if (error && !isMissingTableOrColumn(error)) {
        console.error(`[DeleteAccount] Failed to delete from ${target.table}:`, error)
      }
    }

    // -- Waitlist ------------------------------------------------------------
    // Signups are keyed by email only; no user link exists.
    let waitlistRemoved = false
    if (waitlistEmail) {
      const { error: waitlistError, count } = await supabase
        .from('waitlist')
        .delete({ count: 'exact' })
        .ilike('email', waitlistEmail)
      if (waitlistError && !isMissingTableOrColumn(waitlistError)) {
        console.error('[DeleteAccount] Failed to delete waitlist entry:', waitlistError)
      } else {
        waitlistRemoved = (count ?? 0) > 0
      }
    }

    // -- The account itself ---------------------------------------------------
    // invite_codes.created_by and invite_redemptions.user_id are
    // ON DELETE SET NULL — unlinked automatically by this delete.
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId)
    if (deleteError) {
      console.error('[DeleteAccount] Failed to delete user:', deleteError)
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    console.log(`[DeleteAccount] User ${userId} erased`)

    const response = NextResponse.json({
      success: true,
      message: 'Account and all associated data deleted',
      waitlistRemoved
    })
    response.cookies.delete('cribble_session')
    return response
  } catch (error) {
    console.error('[DeleteAccount] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
