import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { parseBillboardLogoDataUri } from '@/lib/billboardServer'

// The upload endpoint's contract: any buyer — signed in or an
// anonymous guest sponsor composing their ad (migration 063) — posts
// one image as multipart/form-data and gets back a small inline webp
// data URI plus the accent extracted from the SAME encoded buffer —
// with nothing ever written to disk (the route holds everything in
// memory). The sharp pipeline runs unmocked so the size/dimension/
// format gates are exercised for real; the supabase client stub exists
// because rateLimit constructs one at module scope (this route itself
// never touches the database).

vi.mock('@/lib/supabaseServer', () => ({ createServiceClient: () => ({}) }))

import { POST } from './route'

function uploadRequest(form: FormData) {
  return new NextRequest('https://cribble.dev/api/billboard/logo', {
    method: 'POST',
    body: form
  })
}

function fileForm(bytes: Uint8Array, name = 'logo.png', type = 'image/png') {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type }))
  return form
}

describe('POST /api/billboard/logo', () => {
  it('processes an anonymous upload — guest sponsors compose before any identity exists', async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 40, b: 40 } }
    })
      .png()
      .toBuffer()
    const response = await POST(uploadRequest(fileForm(png)))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
  })

  it('rejects a missing or non-file `file` field', async () => {
    const empty = new FormData()
    expect((await POST(uploadRequest(empty))).status).toBe(400)

    const stringField = new FormData()
    stringField.append('file', 'not a file')
    expect((await POST(uploadRequest(stringField))).status).toBe(400)
  })

  it('413s an upload over the 2MB cap', async () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 7)
    const response = await POST(uploadRequest(fileForm(oversized)))

    expect(response.status).toBe(413)
    const body = await response.json()
    expect(body.error).toMatch(/2 MB/)
  })

  it('400s bytes that are not a decodable raster image', async () => {
    const response = await POST(
      uploadRequest(fileForm(Buffer.from('just some text pretending'), 'notes.txt', 'text/plain'))
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/not an image/i)
  })

  it('happy path: returns an inline webp within 256px + the accent from the same buffer', async () => {
    // A big landscape PNG — must come back as webp, fit inside 256x256
    // with the aspect ratio preserved.
    const png = await sharp({
      create: { width: 500, height: 300, channels: 3, background: { r: 200, g: 40, b: 40 } }
    })
      .png()
      .toBuffer()

    const response = await POST(uploadRequest(fileForm(png)))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.success).toBe(true)
    expect(body.logoData).toMatch(/^data:image\/webp;base64,/)
    expect(body.accentColor).toMatch(/^#[0-9a-f]{6}$/)

    const encoded = Buffer.from(body.logoData.split(',')[1], 'base64')
    const meta = await sharp(encoded).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(256)
    expect(meta.height).toBe(154) // 300 * 256/500, aspect preserved

    // The cross-route guarantee: what this endpoint mints is exactly
    // what the submit routes' validator admits.
    await expect(parseBillboardLogoDataUri(body.logoData)).resolves.not.toBeNull()
  })

  it('keeps small logos at native size and preserves alpha', async () => {
    const png = await sharp({
      create: { width: 32, height: 20, channels: 4, background: { r: 40, g: 80, b: 220, alpha: 0.4 } }
    })
      .png()
      .toBuffer()

    const response = await POST(uploadRequest(fileForm(png)))
    expect(response.status).toBe(200)
    const body = await response.json()

    const encoded = Buffer.from(body.logoData.split(',')[1], 'base64')
    const meta = await sharp(encoded).metadata()
    expect(meta.width).toBe(32) // withoutEnlargement — never upscaled
    expect(meta.height).toBe(20)
    expect(meta.hasAlpha).toBe(true)
  })
})
