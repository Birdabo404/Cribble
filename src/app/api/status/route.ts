import { NextResponse } from 'next/server'
import { unknownStatusPayload } from '@/lib/status/aggregate'
import { loadStatusWithNotices, STATUS_REVALIDATE_SECONDS } from '@/lib/status/load'

// THE STATUS OBSERVATORY is the same payload for every viewer (no
// session, no cookies), so it caches like /api/billboard: the handler
// stays force-dynamic (never prerendered at build, where no vendor feed
// should be hit) while the assembled payload comes from the shared
// loader in lib/status/load.ts (Data Cache for a minute + the live
// operator log), with an s-maxage CDN layer on top for the same
// lifetime. Served verbatim as a StatusPayload, no envelope.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const payload = await loadStatusWithNotices()
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': `public, s-maxage=${STATUS_REVALIDATE_SECONDS}, stale-while-revalidate=${STATUS_REVALIDATE_SECONDS * 2}`
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
