import { NextRequest, NextResponse } from 'next/server'
import {
  BILLBOARD_COMPANY_MAX,
  BILLBOARD_TEXT_MAX,
  type BillboardPlacement
} from '@/lib/billboard'
import { cleanBillboardUrl, extractAccentColor } from '@/lib/billboardServer'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Owner-side edit of a Billboard submission (migration 030). Two legal
// moments, per the lifecycle:
//   PENDING            — edit in place while the ad waits for review.
//   CHANGES_REQUESTED  — the admin asked for a redo; saving re-submits,
//                        moving the ad back to PENDING and clearing the
//                        review_note it answered.
// Anything past review (APPROVED / REJECTED / ARCHIVED) is immutable
// from this side. The update is guarded on the status we read — same
// pattern as the admin team-review route — so an admin decision landing
// mid-edit fails this request instead of being silently stomped.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

type AdFields = {
  text: string
  companyName: string
  linkUrl: string
  logoUrl: string | null
  placement: BillboardPlacement
}

/**
 * Shared field contract with POST /api/billboard/submit (kept in
 * copy-sync because the buyer routes have no shared module of their own):
 *   text         — required after control-strip + whitespace collapse;
 *                  length measured in code points to match the table's
 *                  char_length CHECK (.length would over-count astral
 *                  characters).
 *   company_name — required since migration 034 (the banner's title
 *                  line), same sanitize pipeline as text, capped at
 *                  BILLBOARD_COMPANY_MAX code points. Pre-034 rows hold
 *                  NULL until their next edit, which must supply one.
 *   link_url     — required, must survive cleanBillboardUrl (https
 *                  coercion, credential and non-public-host rejection).
 *   logo_url     — optional; when present it faces the same URL bar.
 *                  Absent or blank stores NULL and the ticker falls back
 *                  to the owner's avatar.
 *   placement    — optional 'flipper' | 'rail' (migration 035); absent
 *                  defaults to 'flipper'. Editable only while the ad is
 *                  (PENDING / CHANGES_REQUESTED, which is all this route
 *                  ever touches). rail_slot is never accepted from
 *                  buyers — the admin assigns it at activation.
 */
function parseAdFields(body: Record<string, unknown>): AdFields | { error: string } {
  const rawText = typeof body.text === 'string' ? body.text : ''
  const text = rawText
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return { error: 'Ad text is required' }
  if ([...text].length > BILLBOARD_TEXT_MAX) {
    return { error: `Ad text must be at most ${BILLBOARD_TEXT_MAX} characters` }
  }

  const rawCompany = typeof body.company_name === 'string' ? body.company_name : ''
  const companyName = rawCompany
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!companyName) return { error: 'Company name is required' }
  if ([...companyName].length > BILLBOARD_COMPANY_MAX) {
    return { error: `Company name must be at most ${BILLBOARD_COMPANY_MAX} characters` }
  }

  const linkUrl = cleanBillboardUrl(body.link_url)
  if (!linkUrl) return { error: 'A valid, publicly reachable link URL is required' }

  const rawLogo = typeof body.logo_url === 'string' ? body.logo_url.trim() : ''
  let logoUrl: string | null = null
  if (rawLogo) {
    logoUrl = cleanBillboardUrl(rawLogo)
    if (!logoUrl) return { error: 'Logo URL is not a valid, publicly reachable URL' }
  }

  // Which product the buyer is pitching (migration 035). Optional so
  // pre-rails clients keep working: absent means the flipper.
  const rawPlacement = body.placement
  let placement: BillboardPlacement = 'flipper'
  if (rawPlacement !== undefined) {
    if (rawPlacement !== 'flipper' && rawPlacement !== 'rail') {
      return { error: "placement must be 'flipper' or 'rail'" }
    }
    placement = rawPlacement
  }

  return { text, companyName, linkUrl, logoUrl, placement }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Same budget as the other user-facing write routes (follow, team
    // invites) — button-driven actions on the general API allowance.
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const { id } = await params
    const adId = Number(id)
    if (!Number.isInteger(adId) || adId <= 0) {
      return NextResponse.json({ error: 'Invalid ad id' }, { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const fields = parseAdFields(body)
    if ('error' in fields) {
      return NextResponse.json({ error: fields.error }, { status: 400 })
    }

    const { data: ad, error: fetchError } = await supabase
      .from('billboard_ads')
      .select('id, owner_user_id, status, logo_url, accent_color')
      .eq('id', adId)
      .maybeSingle()

    if (fetchError) {
      console.error('[BillboardEdit] Ad lookup failed:', fetchError)
      return NextResponse.json({ error: 'Failed to load ad' }, { status: 500 })
    }
    // Missing and not-owned collapse into the same 404 — an ad id someone
    // else owns should be indistinguishable from one that doesn't exist.
    if (!ad || Number(ad.owner_user_id) !== session.userId) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }

    const currentStatus = ad.status as string
    if (currentStatus !== 'PENDING' && currentStatus !== 'CHANGES_REQUESTED') {
      return NextResponse.json(
        { error: 'This ad has already been reviewed and can no longer be edited' },
        { status: 409 }
      )
    }

    const update: Record<string, unknown> = {
      text: fields.text,
      company_name: fields.companyName,
      link_url: fields.linkUrl,
      logo_url: fields.logoUrl,
      placement: fields.placement,
      updated_at: new Date().toISOString()
    }
    // A redo answer goes back into the review queue; the note it
    // addressed is spent.
    if (currentStatus === 'CHANGES_REQUESTED') {
      update.status = 'PENDING'
      update.review_note = null
    }

    // Re-derive the accent when the image the ticker shows changes.
    // The effective source is the submitted logo, falling back to the
    // owner's avatar when logo_url is NULL — the same source
    // (users.twitter_profile_image) the public GET resolves logoUrl
    // from, so the avatar only needs fetching when a NULL is in play.
    // A NULL stored accent also retries, picking up ads whose earlier
    // extraction failed. Best-effort: failure stores NULL, the edit
    // itself never blocks on it.
    let ownerAvatar: string | null = null
    if (!fields.logoUrl || !ad.logo_url) {
      const { data: owner } = await supabase
        .from('users')
        .select('twitter_profile_image')
        .eq('id', session.userId)
        .maybeSingle()
      ownerAvatar = owner?.twitter_profile_image || null
    }
    const previousSource = ad.logo_url || ownerAvatar
    const nextSource = fields.logoUrl || ownerAvatar
    if (nextSource !== previousSource || ad.accent_color === null) {
      update.accent_color = nextSource ? await extractAccentColor(nextSource) : null
    }

    // Guarded on the status we based the edit on: if an admin decision
    // (approve/reject) landed meanwhile, zero rows update and the edit
    // fails instead of stomping the decision.
    const { data: updated, error: updateError } = await supabase
      .from('billboard_ads')
      .update(update)
      .eq('id', adId)
      .eq('owner_user_id', session.userId)
      .eq('status', currentStatus)
      .select('id, status, text, company_name, link_url, logo_url, placement, review_note, updated_at')

    if (updateError) {
      console.error('[BillboardEdit] Update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save changes' }, { status: 500 })
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: 'This ad was just reviewed — reload to see its new status' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true, ad: updated[0] })
  } catch (error) {
    console.error('[BillboardEdit] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
