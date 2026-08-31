import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'

// Same-origin image proxy for the ShareCard capture. html-to-image
// snapshots the card onto a canvas, and any cross-origin <img> without
// CORS headers taints that canvas — so the card loads avatars/banners
// through this route instead. Locked to the handful of hosts our
// render layers actually use; everything else is refused.
//
//   GET /api/img/card-proxy?u=<encodeURIComponent(absolute https URL)>
//     → image bytes, upstream content-type, cached for a day

export const dynamic = 'force-dynamic'

const FETCH_TIMEOUT_MS = 8_000
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const ALLOWED_HOSTS = new Set([
  'pbs.twimg.com', // stored X avatars/banners
  'abs.twimg.com', // X default avatars
  'unavatar.io', // live-avatar refresh hop (lib/avatarRefresh)
  'avatars.githubusercontent.com' // GitHub sign-ins
])
// Supabase storage (user-uploaded assets) — host derives from the env
// project URL, so it can't be hardcoded; skip silently when unset.
const supabaseHost = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
})()
if (supabaseHost) ALLOWED_HOSTS.add(supabaseHost)

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
  if (!rateLimitResult.success) {
    return new NextResponse('Rate limit exceeded', {
      status: 429,
      headers: createRateLimitResponse(rateLimitResult)
    })
  }

  let target: URL
  try {
    target = new URL(request.nextUrl.searchParams.get('u') ?? '')
  } catch {
    return new NextResponse('Invalid image URL', { status: 400 })
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return new NextResponse('Image host not allowed', { status: 400 })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let upstream: Response
    try {
      upstream = await fetch(target, {
        signal: controller.signal,
        redirect: 'follow',
        cache: 'no-store'
      })
    } catch {
      return new NextResponse('Upstream fetch failed', { status: 502 })
    }

    // Redirects are followed, so re-check where we actually landed —
    // an allowlisted host must not become an open proxy via a 302.
    try {
      if (!ALLOWED_HOSTS.has(new URL(upstream.url).hostname)) {
        return new NextResponse('Image host not allowed', { status: 400 })
      }
    } catch {
      return new NextResponse('Image host not allowed', { status: 400 })
    }

    if (!upstream.ok || !upstream.body) {
      // 404 passes through: unavatar?fallback=false 404s on purpose so
      // the client's <img> fallback chain can take over.
      return new NextResponse('Upstream image unavailable', {
        status: upstream.status === 404 ? 404 : 502
      })
    }

    const contentType = upstream.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return new NextResponse('Upstream is not an image', { status: 502 })
    }

    const declaredBytes = Number(upstream.headers.get('content-length'))
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_IMAGE_BYTES) {
      return new NextResponse('Image too large', { status: 502 })
    }

    // Buffer with a hard cap — content-length is upstream-controlled
    // and may be absent or lying. Reads abort with the fetch signal, so
    // the timeout covers slow bodies too.
    const reader = upstream.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel()
          return new NextResponse('Image too large', { status: 502 })
        }
        chunks.push(value)
      }
    } catch {
      return new NextResponse('Upstream fetch failed', { status: 502 })
    }

    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } finally {
    clearTimeout(timer)
  }
}
