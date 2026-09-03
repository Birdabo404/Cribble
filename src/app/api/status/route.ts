import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { fetchStatusPayload, unknownStatusPayload } from '@/lib/status/aggregate'
import { applyNotices, deriveNotices } from '@/lib/status/notices'
import { readNoticeEntries } from '@/lib/status/noticesStore'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { StatusPayload } from '@/lib/status/types'

// THE STATUS OBSERVATORY is the same payload for every viewer (no
// session, no cookies), so it caches like /api/billboard: the handler
// stays force-dynamic (never prerendered at build, where no vendor feed
// should be hit) while the assembled vendor payload lives in the Data
// Cache for a minute, with an s-maxage CDN layer on top for the same
// lifetime. The inner feed fetches opt out of caching themselves — this
// is the only cache layer. Served verbatim as a StatusPayload, no
// envelope.
//
// The operator's status log (migration 070) is read OUTSIDE that cache
// on every origin hit — one indexed select — and merged in, so a post
// from /admin/status is public as soon as the CDN's minute turns over,
// never a minute later than that because of data-cache drift.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

const loadStatusPayload = unstable_cache(
  async () => fetchStatusPayload(),
  // v2: Origin joined the watchlist — new key so a fresh deploy never
  // serves the six-service payload out of the old data-cache entry.
  ['status-payload-v2'],
  { revalidate: REVALIDATE_SECONDS }
)

/** Vendor payload + operator log. A log read failure (or no service
 *  role in this environment) leaves `notices` off the payload rather
 *  than failing the whole watch — the page treats absent as "nothing
 *  to say". */
async function loadWithNotices(): Promise<StatusPayload> {
  const [payload, entries] = await Promise.all([
    loadStatusPayload(),
    supabaseAdmin === null
      ? Promise.resolve(null)
      : readNoticeEntries(supabaseAdmin, new Date()).catch((err: unknown) => {
          console.error('[Status] Notice log unreadable this pass:', err)
          return null
        })
  ])
  if (entries === null) return payload
  return applyNotices(payload, deriveNotices(entries, new Date()))
}

export async function GET() {
  try {
    const payload = await loadWithNotices()
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`
      }
    })
  } catch (err) {
    // The aggregator allSettles every feed, so this only fires when the
    // cache layer itself breaks. Serve an honest all-unknown payload —
    // the page renders "the watch is incomplete", never a 500.
    console.error('[Status] Unexpected error:', err)
    return NextResponse.json(unknownStatusPayload(new Date()), {
      headers: { 'Cache-Control': 'no-store' }
    })
  }
}
