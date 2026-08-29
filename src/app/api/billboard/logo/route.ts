import { NextRequest, NextResponse } from 'next/server'
import { BILLBOARD_LOGO_UPLOAD_MAX_BYTES } from '@/lib/billboard'
import {
  BILLBOARD_LOGO_DATA_URI_PREFIX,
  BILLBOARD_LOGO_MAX_DIM,
  extractAccentFromImageBuffer
} from '@/lib/billboardServer'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'

// Buyer-side logo upload for the Billboard composer. Takes one image as
// multipart/form-data (field `file`), verifies it decodes as a real
// raster image, downsizes it to a small webp fully in memory with sharp
// and returns it as an inline data URI plus the accent color extracted
// from the same buffer. The client then ships that data URI as logo_url
// on submit/edit, where parseBillboardLogoDataUri re-validates it —
// this route's output is a convenience, never a credential.
//
// No identity gate: guest sponsors (migration 063) compose their ad
// BEFORE any identity exists, and this route is stateless image
// processing that persists nothing — the per-IP rate limit is the only
// admission control it needs.
//
// PRODUCT REQUIREMENT: the server has no file/object storage — the
// upload is processed entirely in memory and NOTHING is ever written to
// disk or any store here. The only place the image persists is the
// billboard_ads.logo_url TEXT column, as the small data URI the submit
// routes accept.

export const dynamic = 'force-dynamic'

/** First encode pass: longest edge (the validator's exact ceiling, so
 *  minted logos always re-validate) and webp quality of the kept logo. */
const LOGO_DIM = BILLBOARD_LOGO_MAX_DIM
const LOGO_QUALITY = 82
/** Fallback pass when the first encode lands over the byte cap —
 *  photographic "logos" mostly; half the pixels, harder quantizing. */
const LOGO_RETRY_DIM = 128
const LOGO_RETRY_QUALITY = 70
/** Ceiling on the encoded webp. Sized so the stored data URI stays a
 *  small TEXT value (48KB of bytes is 64KB of base64, the exact
 *  decoded ceiling parseBillboardLogoDataUri admits). */
const LOGO_ENCODED_MAX_BYTES = 48 * 1024
/** Decode ceiling (~32MP): a 2MB compressed file can inflate to
 *  hundreds of megapixels under sharp's default ~268MP limit. */
const LOGO_INPUT_MAX_PIXELS = 32 * 1024 * 1024
/** Multipart framing (boundaries, part headers) rides on top of the
 *  file bytes, so the content-length prefilter gets this much slack —
 *  the real cap is enforced on the file itself either way. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

/** Container formats sharp decodes that are actual raster images — the
 *  vector/document formats it also accepts (svg, pdf) are refused. */
const RASTER_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'])

export async function POST(request: NextRequest) {
  try {
    // The per-IP budget — an upload is one button press in the
    // composer, on the general API allowance, and the only gate in
    // front of anonymous callers.
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    // Cheap prefilter on the declared size before buffering the body.
    // Client-controlled, so it only ever rejects — the enforced caps
    // are on the actual bytes below.
    const declaredBytes = Number(request.headers.get('content-length'))
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > BILLBOARD_LOGO_UPLOAD_MAX_BYTES + MULTIPART_OVERHEAD_BYTES
    ) {
      return NextResponse.json({ error: 'Image must be 2 MB or smaller' }, { status: 413 })
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return NextResponse.json(
        { error: 'Expected multipart/form-data with a `file` field' },
        { status: 400 }
      )
    }
    const file = form.get('file')
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'Missing `file` field' }, { status: 400 })
    }
    if (file.size > BILLBOARD_LOGO_UPLOAD_MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 2 MB or smaller' }, { status: 413 })
    }
    const input = Buffer.from(await file.arrayBuffer())
    if (input.byteLength > BILLBOARD_LOGO_UPLOAD_MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 2 MB or smaller' }, { status: 413 })
    }

    // Lazy sharp import, same stance as lib/billboardServer's accent
    // extractors: a missing platform binary must not take down the
    // whole route module graph at import time.
    const { default: sharp } = await import('sharp')

    // Prove the bytes are a real raster image before any pixel work —
    // metadata() only reads the container header, and formats sharp
    // decodes but browsers shouldn't be handed as "images" here (svg,
    // pdf) are refused alongside outright non-images.
    let format: string | undefined
    try {
      format = (await sharp(input, { limitInputPixels: LOGO_INPUT_MAX_PIXELS }).metadata()).format
    } catch {
      format = undefined
    }
    if (!format || !RASTER_FORMATS.has(format)) {
      return NextResponse.json(
        { error: 'That file is not an image we can read — use a PNG, JPEG or WebP' },
        { status: 400 }
      )
    }

    // fit 'inside' preserves aspect ratio (and alpha survives the webp
    // encode); withoutEnlargement keeps small marks at native size.
    const encodeAt = (dim: number, quality: number) =>
      sharp(input, { limitInputPixels: LOGO_INPUT_MAX_PIXELS })
        .resize(dim, dim, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toBuffer()

    let encoded: Buffer
    try {
      encoded = await encodeAt(LOGO_DIM, LOGO_QUALITY)
      if (encoded.byteLength > LOGO_ENCODED_MAX_BYTES) {
        encoded = await encodeAt(LOGO_RETRY_DIM, LOGO_RETRY_QUALITY)
      }
    } catch {
      // A header that parsed but pixels that don't decode (truncated or
      // crafted file) is still a non-image as far as the buyer cares.
      return NextResponse.json(
        { error: 'That image could not be decoded — try re-exporting it' },
        { status: 400 }
      )
    }
    if (encoded.byteLength > LOGO_ENCODED_MAX_BYTES) {
      return NextResponse.json(
        { error: 'That image will not compress small enough for an inline logo — try a simpler one' },
        { status: 400 }
      )
    }

    // The accent comes from the exact buffer being stored — what
    // viewers will see — instead of a second fetch/decode of anything.
    const accentColor = await extractAccentFromImageBuffer(encoded)

    return NextResponse.json({
      success: true,
      logoData: `${BILLBOARD_LOGO_DATA_URI_PREFIX}${encoded.toString('base64')}`,
      accentColor
    })
  } catch (error) {
    console.error('[BillboardLogo] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
