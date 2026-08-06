import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

// Lost-update-proof increment without a DB function: compare-and-swap
// on the clicks value, retried a few times under contention (PostgREST
// can't express `clicks = clicks + 1`, and adding an RPC would need a
// migration). When every attempt loses the race the click is dropped
// rather than miscounted — and never blocks the visitor's redirect.
const INCREMENT_ATTEMPTS = 3

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const adId = Number(id)
    if (!Number.isInteger(adId) || adId <= 0) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }

    const supabase = createServiceClient()
    const { data: ad, error } = await supabase
      .from('billboard_ads')
      .select('id, link_url, status, paid_at, clicks')
      .eq('id', adId)
      .maybeSingle()

    if (error) {
      console.error('[Billboard] Click lookup failed:', error)
      return NextResponse.json({ error: 'Failed to resolve ad' }, { status: 500 })
    }
    // Clicks only count for ads that were approved and paid. The live
    // window deliberately isn't checked: a shared or bookmarked ad link
    // keeps resolving after the 7 days end.
    if (!ad || ad.status !== 'APPROVED' || !ad.paid_at) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }

    // link_url was validated at submission; re-parse it as the last line
    // of defense before handing the visitor over.
    let target: URL
    try {
      target = new URL(String(ad.link_url))
    } catch {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }

    let seen = Number(ad.clicks) || 0
    for (let attempt = 0; attempt < INCREMENT_ATTEMPTS; attempt++) {
      const { data: bumped, error: bumpError } = await supabase
        .from('billboard_ads')
        .update({ clicks: seen + 1, updated_at: new Date().toISOString() })
        .eq('id', adId)
        .eq('clicks', seen)
        .select('id')
      if (bumpError) {
        console.warn('[Billboard] Click increment failed:', bumpError.message)
        break
      }
      if ((bumped || []).length > 0) break

      // Lost the race — reload the counter and try again.
      const { data: fresh, error: freshError } = await supabase
        .from('billboard_ads')
        .select('clicks')
        .eq('id', adId)
        .maybeSingle()
      if (freshError || !fresh) break
      seen = Number(fresh.clicks) || 0
    }

    // no-store so no CDN/proxy ever serves the redirect from cache and
    // swallows the click count.
    return NextResponse.redirect(target, {
      status: 302,
      headers: { 'Cache-Control': 'no-store' }
    })
  } catch (err) {
    console.error('[Billboard] Click error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
