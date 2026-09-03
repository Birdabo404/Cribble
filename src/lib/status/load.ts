// The one status reading everything server-side shares: GET /api/status
// serves it as JSON and status/opengraph-image.tsx paints it. The vendor
// payload lives in the Data Cache for a minute (the feeds opt out of
// caching themselves — this is the only cache layer); the operator's
// status log (migration 070) is read OUTSIDE that cache on every origin
// hit — one indexed select — and merged in, so a post from /admin/status
// is public as soon as the CDN's minute turns over, never a minute later
// than that because of data-cache drift.

import { unstable_cache } from 'next/cache'
import { fetchStatusPayload } from '@/lib/status/aggregate'
import { applyNotices, deriveNotices } from '@/lib/status/notices'
import { readNoticeEntries } from '@/lib/status/noticesStore'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { StatusPayload } from '@/lib/status/types'

export const STATUS_REVALIDATE_SECONDS = 60

const loadStatusPayload = unstable_cache(
  async () => fetchStatusPayload(),
  // v2: Origin joined the watchlist — new key so a fresh deploy never
  // serves the six-service payload out of the old data-cache entry.
  ['status-payload-v2'],
  { revalidate: STATUS_REVALIDATE_SECONDS }
)

/** Vendor payload + operator log. A log read failure (or no service
 *  role in this environment) leaves `notices` off the payload rather
 *  than failing the whole watch — consumers treat absent as "nothing
 *  to say". Throws only if the cache layer itself breaks. */
export async function loadStatusWithNotices(): Promise<StatusPayload> {
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
