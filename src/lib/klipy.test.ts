import { describe, expect, it } from 'vitest'
import { normalizeKlipyResponse } from './klipy'

// Fixtures mirror Klipy's live envelope (verified against their official
// demo apps): { result, data: { data: [item…], current_page, has_next } }
// with items shaped { slug, title, type, file: { hd|md|sm|xs: { gif|webp } } }.

const fileMeta = (url: string, width = 480, height = 270) => ({
  url,
  width,
  height,
  size: 1024
})

const fullItem = (slug: string) => ({
  slug,
  title: `${slug} title`,
  type: 'gif',
  blur_preview: 'base64…',
  file: {
    hd: {
      gif: fileMeta(`https://static.klipy.com/${slug}/hd.gif`, 960, 540),
      webp: fileMeta(`https://static.klipy.com/${slug}/hd.webp`, 960, 540)
    },
    sm: {
      gif: fileMeta(`https://static.klipy.com/${slug}/sm.gif`, 320, 180),
      webp: fileMeta(`https://static.klipy.com/${slug}/sm.webp`, 320, 180)
    }
  }
})

const envelope = (items: unknown[], overrides: Record<string, unknown> = {}) => ({
  result: true,
  data: {
    data: items,
    current_page: 1,
    per_page: items.length,
    has_next: false,
    ...overrides
  }
})

describe('normalizeKlipyResponse', () => {
  it('maps items to picker gifs — webp preferred, hd full / sm preview', () => {
    const page = normalizeKlipyResponse(envelope([fullItem('dancing-cat')]), 1)
    expect(page).not.toBeNull()
    expect(page!.items).toEqual([
      {
        id: 'dancing-cat',
        title: 'dancing-cat title',
        previewUrl: 'https://static.klipy.com/dancing-cat/sm.webp',
        fullUrl: 'https://static.klipy.com/dancing-cat/hd.webp',
        width: 320,
        height: 180
      }
    ])
  })

  it('falls back to gif when webp is missing', () => {
    const item = {
      slug: 'gif-only',
      title: 'gif only',
      file: { md: { gif: fileMeta('https://static.klipy.com/gif-only/md.gif') } }
    }
    const page = normalizeKlipyResponse(envelope([item]), 1)
    expect(page!.items[0].fullUrl).toBe('https://static.klipy.com/gif-only/md.gif')
    expect(page!.items[0].previewUrl).toBe('https://static.klipy.com/gif-only/md.gif')
  })

  it('walks the size ladder when preferred buckets are absent', () => {
    const item = {
      slug: 'tiny',
      file: { xs: { webp: fileMeta('https://static.klipy.com/tiny/xs.webp', 90, 51) } }
    }
    const page = normalizeKlipyResponse(envelope([item]), 1)
    expect(page!.items[0].fullUrl).toBe('https://static.klipy.com/tiny/xs.webp')
    expect(page!.items[0].previewUrl).toBe('https://static.klipy.com/tiny/xs.webp')
  })

  it('drops ad slots and malformed items, keeps the good ones', () => {
    const page = normalizeKlipyResponse(
      envelope([
        { type: 'ad', width: 300, height: 250, content: '<div>ad html</div>' },
        { slug: '', file: fullItem('x').file }, // empty slug
        { slug: 'no-file', title: 'nope' }, // missing file matrix
        { slug: 'bad-url', file: { hd: { webp: fileMeta('javascript:alert(1)') } } },
        { slug: 'empty-buckets', file: { hd: {}, sm: null } },
        'not-an-object',
        null,
        fullItem('keeper')
      ]),
      1
    )
    expect(page!.items.map((g) => g.id)).toEqual(['keeper'])
  })

  it('tolerates missing dimensions (renders 0, never NaN)', () => {
    const item = {
      slug: 'dimless',
      file: { hd: { webp: { url: 'https://static.klipy.com/dimless/hd.webp' } } }
    }
    const page = normalizeKlipyResponse(envelope([item]), 1)
    expect(page!.items[0].width).toBe(0)
    expect(page!.items[0].height).toBe(0)
  })

  it('carries pagination through, falling back to the requested page', () => {
    const withPage = normalizeKlipyResponse(
      envelope([fullItem('a')], { current_page: 3, has_next: true }),
      9
    )
    expect(withPage!.page).toBe(3)
    expect(withPage!.hasNext).toBe(true)

    const withoutPage = normalizeKlipyResponse(
      envelope([fullItem('a')], { current_page: undefined }),
      4
    )
    expect(withoutPage!.page).toBe(4)
    expect(withoutPage!.hasNext).toBe(false)
  })

  it('returns an empty page for a successful envelope with no items', () => {
    const page = normalizeKlipyResponse(envelope([]), 2)
    expect(page).toEqual({ items: [], page: 1, hasNext: false })
  })

  it('rejects payloads that are not a successful Klipy envelope', () => {
    expect(normalizeKlipyResponse(null, 1)).toBeNull()
    expect(normalizeKlipyResponse('nope', 1)).toBeNull()
    expect(normalizeKlipyResponse({ result: false, message: 'bad key' }, 1)).toBeNull()
    expect(normalizeKlipyResponse({ data: { data: [] } }, 1)).toBeNull()
  })
})
