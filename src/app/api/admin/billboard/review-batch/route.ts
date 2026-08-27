import { NextRequest, NextResponse } from 'next/server'
import {
  approveBillboardAd,
  type BillboardApproveEmailStatus
} from '@/lib/billboardReview'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Batch billboard approval — the same staff gate (billboard.review) and
// the same per-ad decision as the single review route, applied to up to
// 25 ads in one request so working a full queue costs one admin
// rate-limit hit instead of tripping the 10/min ceiling. Each ad runs
// the shared approveBillboardAd (lib/billboardReview): status-guarded
// PENDING/CHANGES_REQUESTED -> APPROVED under withAudit, best-effort
// payment email + buyer notification. Ads are processed sequentially
// and independently — one failure (concurrent change, wrong status,
// missing ad) records in that ad's result and the batch moves on, so a
// partially-changed queue degrades per ad instead of failing whole.
// Reject / request-changes stay per-ad on the single route: they need
// written reasons.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** Ceiling on one batch — matches the queue page's practical selection
 *  size and keeps the sequential audit+email work inside one request's
 *  time budget. */
const BATCH_MAX = 25

interface BatchApproveResultRow {
  adId: number
  ok: boolean
  error?: string
  emailStatus?: BillboardApproveEmailStatus
}

export async function POST(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const body = await request.json().catch(() => ({}))
  const rawIds: unknown = body.adIds
  if (
    !Array.isArray(rawIds) ||
    rawIds.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
  ) {
    return NextResponse.json(
      { error: 'adIds must be an array of positive integer ad ids' },
      { status: 400 }
    )
  }
  const adIds = [...new Set(rawIds as number[])]
  if (adIds.length === 0 || adIds.length > BATCH_MAX) {
    return NextResponse.json(
      { error: `adIds must contain between 1 and ${BATCH_MAX} distinct ids` },
      { status: 400 }
    )
  }

  const staff = await getStaffUser(request, 'billboard.review')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  // Sequential on purpose: each approve is an audit write + guarded
  // update + optional email, and a manually-worked queue never needs
  // parallelism badly enough to justify hammering those in a burst.
  const results: BatchApproveResultRow[] = []
  for (const adId of adIds) {
    const outcome = await approveBillboardAd(supabase, adId, staff.staff.userId, null)
    results.push(
      outcome.ok
        ? { adId, ok: true, emailStatus: outcome.emailStatus }
        : { adId, ok: false, error: outcome.error }
    )
  }

  return NextResponse.json({ success: true, results })
}
