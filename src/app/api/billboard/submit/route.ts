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

// Buyer-side Billboard submission (migration 030). A signed-in user
// pitches one ad — company name + text + link + optional logo URL —
// which lands as a PENDING row for the admin review queue. One in-flight submission per
// account: while the user has a PENDING or CHANGES_REQUESTED ad this
// route refuses with 409 and the buyer edits that ad instead (PATCH
// /api/billboard/[id]). Payment never happens here — approval and the
// manual paid-activation flow are admin routes.

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
 * Shared field contract with PATCH /api/billboard/[id] (kept in copy-sync
 * because the buyer routes have no shared module of their own):
 *   text         — required after control-strip + whitespace collapse;
 *                  length measured in code points to match the table's
 *                  char_length CHECK (.length would over-count astral
 *                  characters).
 *   company_name — required since migration 034 (the banner's title
 *                  line), same sanitize pipeline as text, capped at
 *                  BILLBOARD_COMPANY_MAX code points.
 *   link_url     — required, must survive cleanBillboardUrl (https
 *                  coercion, credential and non-public-host rejection).
 *   logo_url     — optional; when present it faces the same URL bar.
 *                  Absent or blank stores NULL and the ticker falls back
 *                  to the owner's avatar.
 *   placement    — optional 'flipper' | 'rail' (migration 035); absent
 *                  defaults to 'flipper'. rail_slot is never accepted
 *                  from buyers — the admin assigns it at activation.
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

export async function POST(request: NextRequest) {
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

    // One submission in flight per account. Decided rows (APPROVED /
    // REJECTED / ARCHIVED) don't block a fresh pitch.
    const { data: inFlight, error: inFlightError } = await supabase
      .from('billboard_ads')
      .select('id, status')
      .eq('owner_user_id', session.userId)
      .in('status', ['PENDING', 'CHANGES_REQUESTED'])
      .limit(1)

    if (inFlightError) {
      console.error('[BillboardSubmit] In-flight lookup failed:', inFlightError)
      return NextResponse.json({ error: 'Failed to check existing submissions' }, { status: 500 })
    }
    if (inFlight && inFlight.length > 0) {
      return NextResponse.json(
        {
          error: 'You already have a submission in review — edit that one instead.',
          pendingAdId: inFlight[0].id
        },
        { status: 409 }
      )
    }

    // The accent is derived from the image the ticker will actually
    // show: the submitted logo, or — when logo_url is NULL — the
    // owner's avatar, the same fallback source (users.twitter_profile_
    // image) the public GET resolves logoUrl from. Best-effort: any
    // extraction failure stores NULL and the ad still submits.
    let logoSource = fields.logoUrl
    if (!logoSource) {
      const { data: owner } = await supabase
        .from('users')
        .select('twitter_profile_image')
        .eq('id', session.userId)
        .maybeSingle()
      logoSource = owner?.twitter_profile_image || null
    }
    const accentColor = logoSource ? await extractAccentColor(logoSource) : null

    const { data: ad, error: insertError } = await supabase
      .from('billboard_ads')
      .insert({
        owner_user_id: session.userId,
        text: fields.text,
        company_name: fields.companyName,
        link_url: fields.linkUrl,
        logo_url: fields.logoUrl,
        accent_color: accentColor,
        placement: fields.placement,
        status: 'PENDING'
      })
      .select('id, status, text, company_name, link_url, logo_url, placement, created_at')
      .single()

    if (insertError || !ad) {
      console.error('[BillboardSubmit] Insert failed:', insertError)
      return NextResponse.json({ error: 'Failed to submit ad' }, { status: 500 })
    }

    return NextResponse.json({ success: true, ad }, { status: 201 })
  } catch (error) {
    console.error('[BillboardSubmit] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
