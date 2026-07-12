import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'

// Self-service dossier fields. Everything here is public-by-design
// (it renders on /u/[username]), stored in users.metadata JSONB —
// the same keys the profile/leaderboard readers already consume.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const BIO_MAX = 160
const LOCATION_MAX = 30
const WEBSITE_MAX = 100
const BANNER_MAX = 300
const SOCIAL_MAX = 60

const SOCIAL_KEYS = ['x', 'github', 'youtube', 'linkedin'] as const
type SocialKey = (typeof SOCIAL_KEYS)[number]

/** Hosts a full-URL social value is allowed to point at. */
const SOCIAL_HOSTS: Record<SocialKey, string[]> = {
  x: ['x.com', 'twitter.com'],
  github: ['github.com'],
  youtube: ['youtube.com', 'youtu.be'],
  linkedin: ['linkedin.com']
}

const stripControl = (v: string) =>
  // eslint-disable-next-line no-control-regex
  v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')

const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const trimmed = stripControl(v).replace(/\n{3,}/g, '\n\n').trim().slice(0, max).trim()
  return trimmed.length > 0 ? trimmed : null
}

const cleanHttpUrl = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  let raw = stripControl(v).trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`
  if (raw.length > max) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Accepts a bare handle (stored as-is, sans @) or a full URL on the
 *  platform's own domain — anything else is dropped rather than saved. */
const cleanSocial = (key: SocialKey, v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const raw = stripControl(v).trim().slice(0, SOCIAL_MAX * 3)
  if (!raw) return null

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      const host = url.hostname.toLowerCase().replace(/^www\./, '')
      const allowed = SOCIAL_HOSTS[key].some(
        (h) => host === h || host.endsWith(`.${h}`)
      )
      if (!allowed) return null
      return url.toString().slice(0, SOCIAL_MAX * 3)
    } catch {
      return null
    }
  }

  const handle = raw.replace(/^@/, '').slice(0, SOCIAL_MAX)
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(handle) ? handle : null
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, twitter_username, metadata')
      .eq('id', session.userId)
      .single()

    if (error || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const meta = (user.metadata || {}) as Record<string, unknown>
    const socials = (meta.socials || {}) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    return NextResponse.json({
      success: true,
      profile: {
        username: user.twitter_username || null,
        bio: str(meta.bio),
        location: str(meta.location),
        website: str(meta.website),
        banner_image: str(meta.banner_image),
        socials: {
          x: str(socials.x),
          github: str(socials.github),
          youtube: str(socials.youtube),
          linkedin: str(socials.linkedin)
        }
      }
    })
  } catch (error) {
    console.error('[ProfileEdit] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

interface ProfilePatchPayload {
  bio?: unknown
  location?: unknown
  website?: unknown
  banner_image?: unknown
  socials?: Record<string, unknown>
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    let body: ProfilePatchPayload
    try {
      body = (await request.json()) as ProfilePatchPayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // Fetch current metadata so unrelated keys (onboarding answers etc.)
    // survive the merge.
    const { data: existing, error: fetchError } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', session.userId)
      .single()

    if (fetchError) {
      console.error('[ProfileEdit] Metadata fetch failed:', fetchError)
      return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
    }

    const currentMeta =
      existing?.metadata && typeof existing.metadata === 'object'
        ? (existing.metadata as Record<string, unknown>)
        : {}
    const currentSocials =
      currentMeta.socials && typeof currentMeta.socials === 'object'
        ? (currentMeta.socials as Record<string, unknown>)
        : {}

    const merged: Record<string, unknown> = { ...currentMeta }

    if ('bio' in body) merged.bio = cleanText(body.bio, BIO_MAX)
    if ('location' in body) merged.location = cleanText(body.location, LOCATION_MAX)
    if ('website' in body) merged.website = cleanHttpUrl(body.website, WEBSITE_MAX)
    if ('banner_image' in body) merged.banner_image = cleanHttpUrl(body.banner_image, BANNER_MAX)

    if (body.socials && typeof body.socials === 'object') {
      const nextSocials: Record<string, unknown> = { ...currentSocials }
      for (const key of SOCIAL_KEYS) {
        if (key in body.socials) nextSocials[key] = cleanSocial(key, body.socials[key])
      }
      merged.socials = nextSocials
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ metadata: merged })
      .eq('id', session.userId)

    if (updateError) {
      console.error('[ProfileEdit] Update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[ProfileEdit] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
