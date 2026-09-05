import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { isRailSlot, RAIL_SLOTS, type RailItem } from '@/lib/billboard'
import { createServiceClient } from '@/lib/supabaseServer'

// THE PROFILE RAILS feed (migration 035): the live rail ads the profile
// page's TRANSMISSIONS panel lists (eight fixed cells in its left
// column, 1024px and up — TransmissionsPanel via useRailFeed), one per
// slot, served in RAIL_SLOTS order. Same payload for every viewer (no
// session, no cookies), so it caches exactly like /api/billboard (the
// flipper feed): a force-dynamic handler with the assembled list in
// the Data Cache for a minute and an s-maxage CDN layer on top for the
// same lifetime.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

interface LiveRailRow {
  id: number
  rail_slot: string | null
  text: string
  company_name: string | null
  link_url: string
  logo_url: string | null
  accent_color: string | null
  owner_user_id: number | null
}

interface RailOwnerRow {
  id: number
  twitter_profile_image: string | null
}

// Title-line fallback, same as the flipper feed: the link's bare
// hostname, lowercased, leading 'www.' stripped. link_url was validated
// at submission, but parse defensively — a bad stored URL degrades that
// ad's host to '' instead of killing the rails.
function linkHostOf(linkUrl: string): string {
  try {
    return new URL(linkUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const loadRailItems = unstable_cache(
  async (): Promise<RailItem[]> => {
    const supabase = createServiceClient()
    const nowIso = new Date().toISOString()

    // LIVE per migration 030 (APPROVED + paid + now inside the window),
    // scoped to the rail product. Slot exclusivity is enforced at
    // activation, so at most one live ad exists per RAIL_SLOTS entry.
    const { data, error } = await supabase
      .from('billboard_ads')
      .select('id, rail_slot, text, company_name, link_url, logo_url, accent_color, owner_user_id')
      .eq('placement', 'rail')
      .eq('status', 'APPROVED')
      .not('paid_at', 'is', null)
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)
      .limit(RAIL_SLOTS.length)

    if (error) {
      throw new Error(`billboard_ads rails read failed: ${error.message}`)
    }
    const rows = (data || []) as unknown as LiveRailRow[]

    // An ad without a logo falls back to its owner's avatar, same as the
    // flipper feed (migration 030). The active-status filter keeps a
    // banned or suspended owner's avatar off the rails.
    const fallbackOwnerIds = [
      ...new Set(
        rows
          .filter((row) => !row.logo_url && row.owner_user_id !== null)
          .map((row) => Number(row.owner_user_id))
      )
    ]
    const avatarByUserId = new Map<number, string | null>()
    if (fallbackOwnerIds.length > 0) {
      const usersRes = await supabase
        .from('users')
        .select('id, twitter_profile_image')
        .in('id', fallbackOwnerIds)
        .or('status.is.null,status.eq.active')
      if (usersRes.error) {
        console.warn('[billboard/rails] Users read failed:', usersRes.error.message)
      } else {
        for (const row of (usersRes.data || []) as unknown as RailOwnerRow[]) {
          avatarByUserId.set(Number(row.id), row.twitter_profile_image || null)
        }
      }
    }

    const items: RailItem[] = []
    for (const row of rows) {
      // Activation always assigns a slot; skip any row that somehow
      // lacks a valid one rather than serving a card nothing can mount.
      if (!isRailSlot(row.rail_slot)) continue
      const ownerAvatar =
        row.owner_user_id !== null
          ? avatarByUserId.get(Number(row.owner_user_id)) ?? null
          : null
      items.push({
        id: Number(row.id),
        slot: row.rail_slot,
        companyName: row.company_name || null,
        linkHost: linkHostOf(row.link_url),
        text: row.text,
        logoUrl: row.logo_url || ownerAvatar,
        accentColor: row.accent_color || null
      })
    }
    items.sort((a, b) => RAIL_SLOTS.indexOf(a.slot) - RAIL_SLOTS.indexOf(b.slot))
    return items
  },
  ['billboard-rails-v1'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  try {
    const items = await loadRailItems()

    return NextResponse.json(
      { items },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`
        }
      }
    )
  } catch (err) {
    console.error('[billboard/rails] Unexpected error:', err)
    return NextResponse.json({ error: 'Failed to load the rails' }, { status: 500 })
  }
}
