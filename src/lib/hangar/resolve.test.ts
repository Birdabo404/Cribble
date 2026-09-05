import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decodeEntities,
  githubCardFromApi,
  parseSiteMeta,
  resolveCard,
  resolverKindFor
} from './resolve'

// Resolvers against a stubbed global fetch: the GitHub JSON contract,
// the site HTML meta parser (pure), the manual redirect loop with its
// per-hop public-host gate, the content-type and byte caps. Nothing here
// touches the network.

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const requestUrl = (call: number): string => String(fetchMock.mock.calls[call]?.[0])
const requestInit = (call: number): RequestInit =>
  (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit
const requestHeader = (call: number, name: string): string | undefined =>
  (requestInit(call).headers as Record<string, string> | undefined)?.[name]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })

const html = (body: string, status = 200, contentType = 'text/html; charset=utf-8') =>
  new Response(body, { status, headers: { 'content-type': contentType } })

const redirect = (location: string, status = 301) =>
  new Response(null, { status, headers: { location } })

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

const REPO_FIXTURE = {
  id: 1,
  name: 'Cribble',
  full_name: 'Birdabo404/Cribble',
  owner: { login: 'Birdabo404', id: 2 },
  html_url: 'https://github.com/Birdabo404/Cribble',
  description: '  AI usage leaderboard\n\tfor developers  ',
  homepage: 'https://cribble.dev',
  stargazers_count: 1234,
  forks_count: 56,
  language: 'TypeScript',
  pushed_at: '2026-08-30T10:11:12Z',
  archived: false,
  private: false
}

describe('githubCardFromApi', () => {
  it('maps the REST payload onto a card', () => {
    expect(githubCardFromApi(REPO_FIXTURE, 'https://github.com/birdabo404/cribble')).toEqual({
      kind: 'github',
      url: 'https://github.com/Birdabo404/Cribble',
      owner: 'Birdabo404',
      repo: 'Cribble',
      description: 'AI usage leaderboard for developers',
      stars: 1234,
      forks: 56,
      language: 'TypeScript',
      languageColor: '#3178c6',
      pushedAt: '2026-08-30T10:11:12Z',
      archived: false,
      homepage: 'https://cribble.dev/'
    })
  })

  it('caps the description, nulls empty/unsafe homepages and unknown languages', () => {
    const card = githubCardFromApi(
      {
        ...REPO_FIXTURE,
        description: 'x'.repeat(200),
        homepage: '',
        language: 'Brainfuck',
        pushed_at: 'yesterday',
        stargazers_count: -3,
        forks_count: '9'
      },
      'https://github.com/Birdabo404/Cribble'
    )
    expect(card?.description).toHaveLength(160)
    expect(card?.homepage).toBeNull()
    expect(card?.language).toBe('Brainfuck')
    expect(card?.languageColor).toBeNull()
    expect(card?.pushedAt).toBeNull()
    expect(card?.stars).toBe(0)
    expect(card?.forks).toBe(0)

    expect(
      githubCardFromApi({ ...REPO_FIXTURE, homepage: 'http://localhost:3000' }, 'u')?.homepage
    ).toBeNull()
    expect(githubCardFromApi({ ...REPO_FIXTURE, homepage: 'cribble.dev' }, 'u')?.homepage).toBeNull()
  })

  it('falls back to the pinned URL when html_url is missing and rejects payloads without owner/name', () => {
    expect(
      githubCardFromApi({ ...REPO_FIXTURE, html_url: undefined }, 'https://github.com/a/b')?.url
    ).toBe('https://github.com/a/b')
    expect(githubCardFromApi({ ...REPO_FIXTURE, owner: null }, 'u')).toBeNull()
    expect(githubCardFromApi({ ...REPO_FIXTURE, name: '' }, 'u')).toBeNull()
    expect(githubCardFromApi({ message: 'Not Found' }, 'u')).toBeNull()
    expect(githubCardFromApi(null, 'u')).toBeNull()
  })
})

describe('resolveCard — github', () => {
  it('calls the repos endpoint with the GitHub headers and returns a github card', async () => {
    fetchMock.mockResolvedValueOnce(json(REPO_FIXTURE))

    const card = await resolveCard('https://github.com/Birdabo404/Cribble/tree/main/src')

    expect(requestUrl(0)).toBe('https://api.github.com/repos/Birdabo404/Cribble')
    expect(requestHeader(0, 'Accept')).toBe('application/vnd.github+json')
    expect(requestHeader(0, 'User-Agent')).toBe('Cribble')
    expect(requestHeader(0, 'X-GitHub-Api-Version')).toBe('2022-11-28')
    expect(requestHeader(0, 'Authorization')).toBeUndefined()
    expect(requestInit(0).signal).toBeInstanceOf(AbortSignal)
    expect(card.kind).toBe('github')
    if (card.kind !== 'github') return
    expect(card.stars).toBe(1234)
    expect(card.url).toBe('https://github.com/Birdabo404/Cribble')
  })

  it('sends a bearer token when GITHUB_TOKEN is set', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test')
    fetchMock.mockResolvedValueOnce(json(REPO_FIXTURE))

    await resolveCard('https://github.com/Birdabo404/Cribble')

    expect(requestHeader(0, 'Authorization')).toBe('Bearer ghp_test')
  })

  it('returns pending on 404, 403 and network failure', async () => {
    const url = 'https://github.com/nobody/nothing'
    const pending = { kind: 'pending', url, host: 'github.com' }

    fetchMock.mockResolvedValueOnce(json({ message: 'Not Found' }, 404))
    expect(await resolveCard(url)).toEqual(pending)

    fetchMock.mockResolvedValueOnce(json({ message: 'rate limited' }, 403))
    expect(await resolveCard(url)).toEqual(pending)

    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    expect(await resolveCard(url)).toEqual(pending)

    fetchMock.mockResolvedValueOnce(html('<html>not json</html>'))
    expect(await resolveCard(url)).toEqual(pending)
  })
})

/* ------------------------------------------------------------------ */
/* Site meta parser                                                    */
/* ------------------------------------------------------------------ */

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>  Fallback &amp; Title  </title>
  <meta name="description" content="Plain description">
  <meta property="og:title" content="Cribble &mdash; AI usage leaderboard">
  <meta property="og:description" content="Track&#8217;s   your
    AI tool usage &#x26; climb the board">
  <meta name="twitter:title" content="Twitter title">
  <meta name="twitter:description" content="Twitter description">
  <link rel="stylesheet" href="/app.css">
  <link rel="mask-icon" href="/mask.svg" color="#000">
  <link rel="shortcut icon" href="/static/favicon.png?v=3">
  <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png">
</head>
<body><h1>hi</h1></body>
</html>`

describe('parseSiteMeta', () => {
  it('prefers og:* and absolutises the first icon link against the served URL', () => {
    expect(parseSiteMeta(PAGE, 'https://www.example.com/launch/')).toEqual({
      title: 'Cribble \u2014 AI usage leaderboard',
      description: 'Track\u2019s your AI tool usage & climb the board',
      icon: 'https://www.example.com/static/favicon.png?v=3'
    })
  })

  it('falls through twitter:title then <title>, and description then twitter:description', () => {
    const noOg = PAGE.replace(/<meta property="og:[^>]*>\n?/g, '')
    expect(parseSiteMeta(noOg, 'https://example.com/').title).toBe('Twitter title')
    expect(parseSiteMeta(noOg, 'https://example.com/').description).toBe('Plain description')

    const bare = noOg.replace(/<meta name="(twitter:title|description)"[^>]*>\n?/g, '')
    expect(parseSiteMeta(bare, 'https://example.com/').title).toBe('Fallback & Title')
    expect(parseSiteMeta(bare, 'https://example.com/').description).toBe('Twitter description')
  })

  it('accepts name="og:title" and attribute order does not matter', () => {
    const page = `<meta content="Order Free" name="og:title" /><meta content='Single quoted' property='og:description'>`
    expect(parseSiteMeta(page, 'https://example.com/')).toEqual({
      title: 'Order Free',
      description: 'Single quoted',
      icon: 'https://example.com/favicon.ico'
    })
  })

  it('caps title at 80 and description at 160 after entity decoding and whitespace collapse', () => {
    const page = `<title>${'t '.repeat(100)}</title><meta name="description" content="${'d&amp;'.repeat(100)}">`
    const meta = parseSiteMeta(page, 'https://example.com/')
    // Slice then trim (same as the route's cleanText): the cut lands on a
    // space here, so the result is 79 — never longer than the cap, never
    // ending in whitespace.
    expect(meta.title?.length).toBeLessThanOrEqual(80)
    expect(meta.title?.length).toBeGreaterThan(70)
    expect(meta.title?.endsWith(' ')).toBe(false)
    expect(meta.description).toHaveLength(160)
    expect(meta.description?.includes('&amp;')).toBe(false)
  })

  it('strips control characters and yields null for empty candidates', () => {
    const page = `<title>\u0001\u0002   </title><meta property="og:description" content="ok\u0007">`
    expect(parseSiteMeta(page, 'https://example.com/')).toEqual({
      title: null,
      description: 'ok',
      icon: 'https://example.com/favicon.ico'
    })
  })

  it('falls back to /favicon.ico when the icon is missing, data:, or on a private host', () => {
    expect(parseSiteMeta('<html></html>', 'https://example.com/a/b').icon).toBe(
      'https://example.com/favicon.ico'
    )
    expect(
      parseSiteMeta('<link rel="icon" href="data:image/png;base64,AAAA">', 'https://example.com/')
        .icon
    ).toBe('https://example.com/favicon.ico')
    expect(
      parseSiteMeta('<link rel="icon" href="http://192.168.1.1/i.png">', 'https://example.com/')
        .icon
    ).toBe('https://example.com/favicon.ico')
    expect(
      parseSiteMeta('<link rel="icon" href="//cdn.example.com/i.png">', 'https://example.com/')
        .icon
    ).toBe('https://cdn.example.com/i.png')
    expect(parseSiteMeta('<link rel="apple-touch-icon" href="/t.png">', 'https://example.com/x').icon).toBe(
      'https://example.com/t.png'
    )
  })

  it('decodeEntities handles the named subset, decimal and hex, and leaves unknowns alone', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41; &nbsp;f &bogus; &#0;')).toBe(
      'a & b <c> "d" \'e\' A  f &bogus; &#0;'
    )
    // Single pass: a double-encoded ampersand decodes once.
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })
})

/* ------------------------------------------------------------------ */
/* Site fetch                                                          */
/* ------------------------------------------------------------------ */

describe('resolveCard — site', () => {
  it('fetches with manual redirects, only text/html, and builds a site card', async () => {
    fetchMock.mockResolvedValueOnce(html(PAGE))

    const card = await resolveCard('https://Example.com/launch?utm_source=x')

    expect(requestUrl(0)).toBe('https://example.com/launch?utm_source=x')
    expect(requestInit(0).redirect).toBe('manual')
    expect(requestHeader(0, 'Accept')).toContain('text/html')
    expect(card).toEqual({
      kind: 'site',
      url: 'https://example.com/launch?utm_source=x',
      host: 'example.com',
      title: 'Cribble \u2014 AI usage leaderboard',
      description: 'Track\u2019s your AI tool usage & climb the board',
      icon: 'https://example.com/static/favicon.png?v=3'
    })
  })

  it('follows up to three public redirects and absolutises icons against the final URL', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/step1'))
      .mockResolvedValueOnce(redirect('https://cdn.example.org/step2', 302))
      .mockResolvedValueOnce(redirect('final/', 307))
      .mockResolvedValueOnce(html(PAGE))

    const card = await resolveCard('https://example.com/start')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(requestUrl(1)).toBe('https://example.com/step1')
    expect(requestUrl(2)).toBe('https://cdn.example.org/step2')
    expect(requestUrl(3)).toBe('https://cdn.example.org/final/')
    expect(card.kind).toBe('site')
    if (card.kind !== 'site') return
    // Link target stays the pin; the icon came from where the page lived.
    expect(card.url).toBe('https://example.com/start')
    expect(card.icon).toBe('https://cdn.example.org/static/favicon.png?v=3')
  })

  it('gives up after the fourth redirect', async () => {
    fetchMock.mockResolvedValue(redirect('/again'))

    const card = await resolveCard('https://example.com/loop')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(card.kind).toBe('pending')
  })

  it('refuses to follow a redirect into private address space', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data/'))

    const card = await resolveCard('https://example.com/bounce')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(card).toEqual({ kind: 'pending', url: 'https://example.com/bounce', host: 'example.com' })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(redirect('http://localhost:5432/'))
    expect((await resolveCard('https://example.com/bounce')).kind).toBe('pending')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(redirect('ftp://example.com/x'))
    expect((await resolveCard('https://example.com/bounce')).kind).toBe('pending')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never fetches an unsafe pin at all', async () => {
    expect((await resolveCard('http://127.0.0.1:3000/')).kind).toBe('pending')
    expect((await resolveCard('http://intranet.local/')).kind).toBe('pending')
    expect((await resolveCard('https://user:pw@example.com/')).kind).toBe('pending')
    expect((await resolveCard('not a url')).kind).toBe('pending')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns pending for non-HTML, error statuses, missing Location and network failure', async () => {
    const url = 'https://example.com/file'

    fetchMock.mockResolvedValueOnce(
      new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } })
    )
    expect((await resolveCard(url)).kind).toBe('pending')

    fetchMock.mockResolvedValueOnce(html('<title>Server error</title>', 500))
    expect((await resolveCard(url)).kind).toBe('pending')

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }))
    expect((await resolveCard(url)).kind).toBe('pending')

    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    expect((await resolveCard(url)).kind).toBe('pending')
  })

  it('reads at most 256KB of the body', async () => {
    const padding = `<!--${'x'.repeat(300 * 1024)}-->`
    fetchMock.mockResolvedValueOnce(
      html(`<html><head>${padding}<title>Too deep</title></head></html>`)
    )

    const card = await resolveCard('https://example.com/huge')

    expect(card.kind).toBe('site')
    if (card.kind !== 'site') return
    expect(card.title).toBeNull()
    expect(card.icon).toBe('https://example.com/favicon.ico')
  })

  it('honours a non-UTF-8 charset from the content-type', async () => {
    const latin1 = new Uint8Array([
      ...new TextEncoder().encode('<title>caf'),
      0xe9,
      ...new TextEncoder().encode('</title>')
    ])
    fetchMock.mockResolvedValueOnce(html(latin1 as unknown as string, 200, 'text/html; charset=iso-8859-1'))

    const card = await resolveCard('https://example.com/cafe')

    expect(card.kind).toBe('site')
    if (card.kind !== 'site') return
    expect(card.title).toBe('caf\u00e9')
  })
})

describe('resolverKindFor', () => {
  it('routes GitHub repos to github and everything else to site', () => {
    expect(resolverKindFor('https://github.com/a/b')).toBe('github')
    expect(resolverKindFor('https://github.com/a/b/tree/main')).toBe('github')
    expect(resolverKindFor('https://github.com/a')).toBe('site')
    expect(resolverKindFor('https://gitlab.com/a/b')).toBe('site')
    expect(resolverKindFor('garbage')).toBe('site')
  })
})
