import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { fetchStatusPayload, unknownStatusPayload } from '@/lib/status/aggregate'

// THE STATUS OBSERVATORY is the same payload for every viewer (no
// session, no cookies), so it caches like /api/billboard: the handler
// stays force-dynamic (never prerendered at build, where no vendor feed
// should be hit) while the assembled payload lives in the Data Cache for
// a minute, with an s-maxage CDN layer on top for the same lifetime. The
// inner feed fetches opt out of caching themselves — this is the only
// cache layer. Served verbatim as a StatusPayload, no envelope.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

const loadStatusPayload = unstable_cache(
  async () => fetchStatusPayload(),
  ['status-payload-v1'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  try {
    const payload = await loadStatusPayload()
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
