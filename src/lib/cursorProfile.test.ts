import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  mergeCursorDailySeries,
  normalizeCursorUsername,
  parseCursorProfileHtml
} from './cursorProfile'

// The parser against REAL pages saved from cursor.com — @birdabo (public
// profile) and a nonexistent handle (the soft-404 envelope), each trimmed
// to the RSC script chunks that matter — plus synthetic private/garbage/
// split-chunk pages. Nothing here touches the network —
// fetchCursorProfile's transport arms (HTTP 404 → not_found, network
// failure → fetch_error) are trivial wrappers left untested.

const fixtureHtml = readFileSync(
  fileURLToPath(new URL('./__fixtures__/cursor-profile-birdabo.html', import.meta.url)),
  'utf8'
)

// Saved from cursor.com/@zz-no-such-user-948213: HTTP 200, RSC chunks
// present, no profile payload, and an error row
// `26:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}` — how cursor.com
// answers for missing AND non-public profiles alike.
const notFoundFixtureHtml = readFileSync(
  fileURLToPath(new URL('./__fixtures__/cursor-profile-notfound.html', import.meta.url)),
  'utf8'
)

/** Wraps a raw RSC payload in push chunks exactly the way Next.js does:
 *  each piece is JSON-escaped into a quoted script-literal argument. */
function rscPage(...payloadPieces: string[]): string {
  const scripts = payloadPieces
    .map((piece) => `<script>self.__next_f.push([1,${JSON.stringify(piece)}])</script>`)
    .join('\n')
  return `<!DOCTYPE html><html><body><div id="__next"></div>\n${scripts}\n</body></html>`
}

describe('parseCursorProfileHtml', () => {
  it('parses the saved public profile page end to end', () => {
    const result = parseCursorProfileHtml(fixtureHtml)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    expect(result.profile.displayName).toBe('sui 🧠')
    expect(result.profile.avatarUrl).toMatch(/^https:\/\/workoscdn\.com\//)
    expect(result.profile.joinedDate).toBe('2025-05-07T11:21:38.178Z')
    expect(result.profile.stats).toEqual({
      currentStreak: 13,
      longestStreak: 13,
      agentsLocal: 593,
      agentsCloud: 10,
      longestAgentSeconds: 19160
    })
    // Ranked names only — the vendor/agentRequests decoration is dropped.
    expect(result.profile.topModels).toEqual([
      'Claude Fable 5',
      'Cursor Grok 4.6',
      'Cursor Grok 4.5'
    ])

    expect(result.profile.tokensOverTime).toHaveLength(30)
    expect(result.profile.tokensOverTime[0]).toEqual({ date: '2026-07-30', tokens: 0 })
    expect(result.profile.tokensOverTime.at(-1)).toEqual({
      date: '2026-08-28',
      tokens: 28238518
    })

    expect(result.profile.agentsOverTime).toHaveLength(30)
    expect(result.profile.agentsOverTime.at(-1)).toEqual({
      date: '2026-08-28',
      local: 8,
      cloud: 0
    })
  })

  it('still parses when the profile payload splits across push chunks', () => {
    const payload =
      '23:["$","$L78",null,{"profile":{"handle":"split","displayName":"Split \\"Case\\"",' +
      '"avatarUrl":"https://example.com/a.png","joinedDate":"2025-01-01T00:00:00.000Z",' +
      '"visibility":"PUBLIC","stats":{"currentStreak":2,"longestStreak":5,"agentsLocal":7,' +
      '"agentsCloud":1,"longestAgentSeconds":90},"topModels":[{"name":"Model A"}],' +
      '"tokensOverTime":[{"date":"2026-08-01","tokens":10}],' +
      '"agentsOverTime":[{"date":"2026-08-01","local":1,"cloud":0}]}}]'
    // Split mid-object — each half is escaped independently, like Next does.
    const splitAt = payload.indexOf('"longestStreak"')
    const result = parseCursorProfileHtml(
      rscPage(payload.slice(0, splitAt), payload.slice(splitAt))
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.profile.displayName).toBe('Split "Case"')
    expect(result.profile.stats.longestStreak).toBe(5)
    expect(result.profile.tokensOverTime).toEqual([{ date: '2026-08-01', tokens: 10 }])
  })

  it('reports private when visibility is not PUBLIC', () => {
    const result = parseCursorProfileHtml(
      rscPage(
        '23:["$","$L78",null,{"profile":{"handle":"hidden","displayName":"Hidden",' +
          '"visibility":"PRIVATE"}}]'
      )
    )
    expect(result).toEqual({ status: 'private' })
  })

  it('reports private when the page is a profile but stats are missing', () => {
    const result = parseCursorProfileHtml(
      rscPage(
        '23:["$","$L78",null,{"profile":{"handle":"bare","displayName":"Bare",' +
          '"visibility":"PUBLIC"}}]'
      )
    )
    expect(result).toEqual({ status: 'private' })
  })

  it('reports parse_error for a page without RSC chunks', () => {
    const result = parseCursorProfileHtml('<!DOCTYPE html><html><body>404</body></html>')
    expect(result.status).toBe('parse_error')
  })

  it('reports parse_error for RSC chunks without a profile payload', () => {
    const result = parseCursorProfileHtml(rscPage('78:I[532588,["chunk.js"],"SomePage"]'))
    expect(result.status).toBe('parse_error')
  })

  it('reports not_found for the saved soft-404 page of a nonexistent handle', () => {
    // cursor.com answers missing/hidden profiles with HTTP 200 and a
    // NEXT_HTTP_ERROR_FALLBACK;404 error row instead of an HTTP 404.
    expect(parseCursorProfileHtml(notFoundFixtureHtml)).toEqual({ status: 'not_found' })
  })

  it('reports not_found when the 404 error row splits across push chunks', () => {
    const payload =
      '7d:I[208447,["chunk.js"],"IconMark"]\n' +
      '26:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}\n'
    const splitAt = payload.indexOf('FALLBACK')
    const result = parseCursorProfileHtml(
      rscPage(payload.slice(0, splitAt), payload.slice(splitAt))
    )
    expect(result).toEqual({ status: 'not_found' })
  })

  it('reports private for a 401/403 error row', () => {
    for (const code of [401, 403]) {
      const result = parseCursorProfileHtml(
        rscPage(`26:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;${code}"}\n`)
      )
      expect(result).toEqual({ status: 'private' })
    }
  })

  it('reports parse_error naming the digest for an opaque render-error row', () => {
    const result = parseCursorProfileHtml(rscPage('26:E{"digest":"1234567890abcdef"}\n'))
    expect(result.status).toBe('parse_error')
    if (result.status !== 'parse_error') return
    expect(result.message).toContain('1234567890abcdef')
  })

  it('prefers a present profile payload over an unrelated error row', () => {
    const result = parseCursorProfileHtml(
      rscPage(
        '30:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}\n' +
          '23:["$","$L78",null,{"profile":{"handle":"here","displayName":"Here",' +
          '"visibility":"PUBLIC","stats":{"currentStreak":1},' +
          '"tokensOverTime":[],"agentsOverTime":[]}}]'
      )
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.profile.displayName).toBe('Here')
  })

  it('does not mistake payload text resembling an error row for one', () => {
    // The digest text lives inside a STRING value of some payload row —
    // its newline is the two-character \n escape, never a real row
    // separator, so the row scan must not classify this as not_found.
    const result = parseCursorProfileHtml(
      rscPage(
        '2d:[["$","meta","1",{"name":"description","content":' +
          '"about\\n26:E{\\"digest\\":\\"NEXT_HTTP_ERROR_FALLBACK;404\\"}"}]]\n'
      )
    )
    expect(result).toEqual({
      status: 'parse_error',
      message: 'Profile payload not found in page'
    })
  })

  it('clamps pathological counter values to Postgres-safe ceilings', () => {
    const result = parseCursorProfileHtml(
      rscPage(
        '23:["$","$L78",null,{"profile":{"handle":"whale","visibility":"PUBLIC",' +
          '"stats":{"currentStreak":1e300,"longestStreak":3,"agentsLocal":9999999999,' +
          '"agentsCloud":2,"longestAgentSeconds":1},' +
          '"tokensOverTime":[{"date":"2026-08-01","tokens":1e300},' +
          '{"date":"2026-08-02","tokens":12345678901234567890}],' +
          '"agentsOverTime":[{"date":"2026-08-01","local":1e300,"cloud":3}]}}]'
      )
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // Tokens land in a BIGINT column — the ceiling is the largest exact
    // JS integer, so the row inserts instead of 500ing the whole claim.
    expect(result.profile.tokensOverTime).toEqual([
      { date: '2026-08-01', tokens: Number.MAX_SAFE_INTEGER },
      { date: '2026-08-02', tokens: Number.MAX_SAFE_INTEGER }
    ])
    // Every other counter lands in INTEGER columns.
    expect(result.profile.stats.currentStreak).toBe(2_147_483_647)
    expect(result.profile.stats.agentsLocal).toBe(2_147_483_647)
    expect(result.profile.stats.agentsCloud).toBe(2)
    expect(result.profile.agentsOverTime).toEqual([
      { date: '2026-08-01', local: 2_147_483_647, cloud: 3 }
    ])
  })

  it('nulls an oversized display name and keeps one exactly at the cap', () => {
    const page = (name: string) =>
      rscPage(
        `23:["$","$L78",null,{"profile":{"handle":"n","displayName":${JSON.stringify(name)},` +
          '"visibility":"PUBLIC","stats":{"currentStreak":1},' +
          '"tokensOverTime":[],"agentsOverTime":[]}}]'
      )

    const over = parseCursorProfileHtml(page('n'.repeat(121)))
    expect(over.status).toBe('ok')
    if (over.status !== 'ok') return
    expect(over.profile.displayName).toBeNull()

    // Measured in code points: 120 astral emoji are 240 UTF-16 units.
    const atCap = parseCursorProfileHtml(page('🧠'.repeat(120)))
    expect(atCap.status).toBe('ok')
    if (atCap.status !== 'ok') return
    expect(atCap.profile.displayName).toBe('🧠'.repeat(120))
  })

  it('only accepts https avatar URLs under the length cap, nulling violations', () => {
    const page = (avatarUrl: string) =>
      rscPage(
        `23:["$","$L78",null,{"profile":{"handle":"a","avatarUrl":${JSON.stringify(avatarUrl)},` +
          '"visibility":"PUBLIC","stats":{"currentStreak":1},' +
          '"tokensOverTime":[],"agentsOverTime":[]}}]'
      )
    const avatarOf = (html: string) => {
      const result = parseCursorProfileHtml(html)
      expect(result.status).toBe('ok')
      return result.status === 'ok' ? result.profile.avatarUrl : undefined
    }

    expect(avatarOf(page('https://example.com/a.png'))).toBe('https://example.com/a.png')
    expect(avatarOf(page('http://example.com/a.png'))).toBeNull()
    expect(avatarOf(page('javascript:alert(1)'))).toBeNull()
    expect(avatarOf(page('not a url at all'))).toBeNull()
    expect(avatarOf(page(`https://example.com/${'a'.repeat(2049)}`))).toBeNull()
  })

  it('tolerates malformed series entries instead of failing the profile', () => {
    const result = parseCursorProfileHtml(
      rscPage(
        '23:["$","$L78",null,{"profile":{"handle":"messy","visibility":"PUBLIC",' +
          '"stats":{"currentStreak":-3,"longestStreak":"nope","agentsLocal":1.6},' +
          '"topModels":["Plain Name",{"noName":true},{"name":"Named"}],' +
          '"tokensOverTime":[{"date":"not-a-date","tokens":5},{"date":"2026-08-02","tokens":7}],' +
          '"agentsOverTime":"broken"}}]'
      )
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.profile.stats).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      agentsLocal: 2,
      agentsCloud: 0,
      longestAgentSeconds: 0
    })
    expect(result.profile.topModels).toEqual(['Plain Name', 'Named'])
    expect(result.profile.tokensOverTime).toEqual([{ date: '2026-08-02', tokens: 7 }])
    expect(result.profile.agentsOverTime).toEqual([])
  })
})

describe('mergeCursorDailySeries', () => {
  it('merges both series by date against the fixture without losing a day', () => {
    const parsed = parseCursorProfileHtml(fixtureHtml)
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return

    const rows = mergeCursorDailySeries(parsed.profile)
    expect(rows).toHaveLength(30)
    expect(rows.reduce((sum, row) => sum + row.tokens, 0)).toBe(1_795_290_126)

    const aug1 = rows.find((row) => row.date === '2026-08-01')
    expect(aug1).toEqual({
      date: '2026-08-01',
      tokens: 71_228_207,
      agentsLocal: 18,
      agentsCloud: 1
    })
  })

  it('zero-fills dates present in only one series and sorts by date', () => {
    const rows = mergeCursorDailySeries({
      tokensOverTime: [{ date: '2026-08-03', tokens: 12 }],
      agentsOverTime: [{ date: '2026-08-01', local: 2, cloud: 1 }]
    })
    expect(rows).toEqual([
      { date: '2026-08-01', tokens: 0, agentsLocal: 2, agentsCloud: 1 },
      { date: '2026-08-03', tokens: 12, agentsLocal: 0, agentsCloud: 0 }
    ])
  })
})

describe('normalizeCursorUsername', () => {
  it('strips one leading @, trims, and lowercases', () => {
    expect(normalizeCursorUsername('  @BirdAbo ')).toBe('birdabo')
    expect(normalizeCursorUsername('user.name-2_x')).toBe('user.name-2_x')
  })

  it('rejects handles that could escape the profile path or are empty', () => {
    expect(normalizeCursorUsername('')).toBeNull()
    expect(normalizeCursorUsername('@')).toBeNull()
    expect(normalizeCursorUsername('../evil')).toBeNull()
    expect(normalizeCursorUsername('has space')).toBeNull()
    expect(normalizeCursorUsername('@@double')).toBeNull()
    expect(normalizeCursorUsername('a'.repeat(65))).toBeNull()
  })
})
