import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  mergeNotificationPrefs,
  resolveNotificationPrefs,
  type NotificationPrefs
} from '@/lib/notificationPrefs'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// User preferences backing the /settings hub. Everything lives in the
// users.metadata JSONB (no migration): notification category toggles
// under metadata.preferences.notifications and the newsletter opt-in
// under metadata.newsletter — the same key onboarding already writes.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

interface SettingsPreferences {
  notifications: NotificationPrefs
  newsletter: boolean
}

function preferencesFromMetadata(metadata: unknown): SettingsPreferences {
  const meta =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)
      : {}
  return {
    notifications: resolveNotificationPrefs(metadata),
    newsletter: meta.newsletter === true
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', session.userId)
      .single()

    if (error || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      preferences: preferencesFromMetadata(user.metadata)
    })
  } catch (error) {
    console.error('[Settings] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// .strict() everywhere: unknown keys are rejected rather than silently
// dropped, so a misspelled toggle never looks like a successful save.
const settingsPatchSchema = z
  .object({
    notifications: z
      .object({
        rank: z.boolean().optional(),
        achievements: z.boolean().optional(),
        social: z.boolean().optional(),
        team: z.boolean().optional(),
        season: z.boolean().optional(),
        shop: z.boolean().optional()
      })
      .strict()
      .optional(),
    newsletter: z.boolean().optional()
  })
  .strict()

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = settingsPatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    // Read-modify-write so unrelated metadata keys (profile fields,
    // onboarding answers, ...) survive the merge — same pattern as the
    // profile route.
    const { data: existing, error: fetchError } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', session.userId)
      .single()

    if (fetchError) {
      console.error('[Settings] Metadata fetch failed:', fetchError)
      return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
    }

    const currentMeta =
      existing?.metadata && typeof existing.metadata === 'object'
        ? (existing.metadata as Record<string, unknown>)
        : {}
    const currentPreferences =
      currentMeta.preferences && typeof currentMeta.preferences === 'object'
        ? (currentMeta.preferences as Record<string, unknown>)
        : {}

    const merged: Record<string, unknown> = { ...currentMeta }

    if (parsed.data.notifications) {
      merged.preferences = {
        ...currentPreferences,
        notifications: mergeNotificationPrefs(
          resolveNotificationPrefs(currentMeta),
          parsed.data.notifications
        )
      }
    }

    if (typeof parsed.data.newsletter === 'boolean') {
      merged.newsletter = parsed.data.newsletter
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ metadata: merged })
      .eq('id', session.userId)

    if (updateError) {
      console.error('[Settings] Update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      preferences: preferencesFromMetadata(merged)
    })
  } catch (error) {
    console.error('[Settings] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
