import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  BILLBOARD_MAX_LIVE,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_CENTS,
  RAIL_SLOTS,
  type SlotBoard
} from '@/lib/billboard'
import { createServiceClient } from '@/lib/supabaseServer'

// THE SLOT BOARD (migration 035): the public availability picture the
// /billboard pitch page renders — flipper occupancy (n of 8, plus when
// the next window opens once full) and each rail slot's taken-until /
// open state. Same payload for every viewer, so it caches exactly like
// /api/billboard: force-dynamic handler, 60s Data Cache, s-maxage CDN
// layer on top. A minute of staleness on a sales board is fine.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

interface FlipperWindowRow {
  ends_at: string | null
}

interface RailOccupantRow {
  rail_slot: string | null
  ends_at: string | null
  company_name: string | null
  link_url: string
}

// Same defensive hostname parse as the public feeds — the occupant
// label falls back to the link's bare host so a taken slot is never
// anonymous on the board.
function linkHostOf(linkUrl: string): string {
  try {
    return new URL(linkUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const loadSlotBoard = unstable_cache(
  async (): Promise<SlotBoard> => {
    const supabase = createServiceClient()
    const nowIso = new Date().toISOString()

    // Both reads use migration 030's LIVE definition (APPROVED + paid +
    // now inside the window), split by product. ends_at ascending gives
    // the flipper's next opening for free.
    const [flipperRes, railRes] = await Promise.all([
      supabase
        .from('billboard_ads')
        .select('ends_at')
        .eq('placement', 'flipper')
        .eq('status', 'APPROVED')
        .not('paid_at', 'is', null)
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso)
        .order('ends_at', { ascending: true }),
      supabase
        .from('billboard_ads')
        .select('rail_slot, ends_at, company_name, link_url')
        .eq('placement', 'rail')
        .eq('status', 'APPROVED')
        .not('paid_at', 'is', null)
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso)
        .order('ends_at', { ascending: true })
    ])

    if (flipperRes.error) {
      throw new Error(`billboard_ads flipper count failed: ${flipperRes.error.message}`)
    }
    if (railRes.error) {
      throw new Error(`billboard_ads rail occupancy failed: ${railRes.error.message}`)
    }

    const flipperWindows = (flipperRes.data || []) as unknown as FlipperWindowRow[]
    const taken = flipperWindows.length
    const nextOpensAt =
      taken >= BILLBOARD_MAX_LIVE ? flipperWindows[0]?.ends_at ?? null : null

    // slot -> live occupant. Activation enforces one live ad per slot;
    // ends_at-ascending iteration means a never-expected duplicate
    // leaves the latest-ending occupant on the board.
    const occupants = new Map<string, { takenUntil: string | null; companyName: string | null }>()
    for (const row of (railRes.data || []) as unknown as RailOccupantRow[]) {
      if (!row.rail_slot) continue
      occupants.set(row.rail_slot, {
        takenUntil: row.ends_at ?? null,
        companyName: row.company_name || linkHostOf(row.link_url) || null
      })
    }

    return {
      flipper: {
        taken,
        max: BILLBOARD_MAX_LIVE,
        priceCents: BILLBOARD_PRICE_CENTS,
        nextOpensAt
      },
      rails: RAIL_SLOTS.map((slot): SlotBoard['rails'][number] => {
        const occupant = occupants.get(slot)
        return {
          slot,
          side: slot.startsWith('L') ? 'left' : 'right',
          priceCents: BILLBOARD_RAIL_PRICE_CENTS,
          takenUntil: occupant?.takenUntil ?? null,
          companyName: occupant?.companyName ?? null
        }
      })
    }
  },
  ['billboard-slots-v1'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  try {
    const board = await loadSlotBoard()

    return NextResponse.json(board, {
      headers: {
        'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`
      }
    })
  } catch (err) {
    console.error('[BillboardSlots] Unexpected error:', err)
    return NextResponse.json({ error: 'Failed to load the slot board' }, { status: 500 })
  }
}
