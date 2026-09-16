import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function moduleWith(response: () => Promise<Response>) {
  const fetch = vi.fn(response)
  vi.stubGlobal('fetch', fetch)
  const api = await import('./fetchMe')
  return { ...api, fetch }
}

describe('fetchMe session readiness cache', () => {
  it('collapses callers while the session is loading', async () => {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => { resolve = done })
    const { fetchMe, fetch } = await moduleWith(() => pending)
    const first = fetchMe()
    const second = fetchMe()
    expect(fetch).toHaveBeenCalledTimes(1)
    resolve(new Response('{}', { status: 401 }))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: false, status: 401 },
      { ok: false, status: 401 }
    ])
  })

  it.each([401, 503])('caches resolved HTTP session state %s', async (status) => {
    const { fetchMe, fetch } = await moduleWith(async () => new Response('{}', { status }))
    await fetchMe()
    await fetchMe()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('caches a signed-in response', async () => {
    const { fetchMe, fetch } = await moduleWith(async () =>
      new Response(JSON.stringify({ user: { id: 1 } }), { status: 200 })
    )
    await expect(fetchMe()).resolves.toMatchObject({ ok: true, status: 200 })
    await fetchMe()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not cache network errors', async () => {
    const { fetchMe, fetch } = await moduleWith(async () => { throw new Error('offline') })
    await fetchMe()
    await fetchMe()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
