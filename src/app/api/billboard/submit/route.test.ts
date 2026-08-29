import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { SPONSOR_CLAIM_COOKIE } from '@/lib/sponsorAuth'

// The guest half of the submit route (migration 063): a visitor with no
// identity becomes a guest exactly at submit time — the billing email
// mints a billboard_guests row, the bearer token rides back as the
// httpOnly claim cookie, and the tracking magic link is emailed
// best-effort. Under test: the mint-on-submit rule (rejected bodies
// mint nothing), the cookie/email/response contract of the guest 201,
// the returning cookie-guest reusing their row with the one-in-flight
// rule keyed on guest_id, the per-IP distributed budget for
// non-account submissions, and the signed-in path keeping its exact
// original response shape. sponsorAuth and createSponsorGuest run REAL
// against the stateful fake — the token in the cookie, the email and
// the guests table must all be the same 64-hex secret.

const {
  getSessionUserIdMock,
  distributedLimitMock,
  isEmailConfiguredMock,
  sendGuestTrackingEmailMock,
  db
} = vi.hoisted(() => ({
  getSessionUserIdMock: vi.fn(),
  distributedLimitMock: vi.fn(),
  isEmailConfiguredMock: vi.fn(),
  sendGuestTrackingEmailMock: vi.fn(),
  db: {
    guests: [] as Array<Record<string, unknown>>,
    ads: [] as Array<Record<string, unknown>>,
    nextGuestId: 21,
    nextAdId: 100,
    guestInsertError: null as { message: string } | null,
    adInsertError: null as { message: string } | null
  }
}))

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: getSessionUserIdMock }))

// The cross-instance per-IP budget (Postgres-backed in production) is
// faked; the process-local prefilter runs real and stays far under its
// allowance here.
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  checkDistributedRateLimit: distributedLimitMock
}))

vi.mock('@/lib/sponsorshipEmail', () => ({
  isSponsorshipEmailConfigured: isEmailConfiguredMock,
  sendGuestTrackingEmail: sendGuestTrackingEmailMock
}))

// A stateful multi-table fake shared by the route AND sponsorAuth (both
// build their service client from this factory), honoring exactly the
// chains they issue: the guest cookie lookup and createSponsorGuest's
// insert on billboard_guests, the in-flight check (select -> eq -> in
// -> limit, awaited) and insert on billboard_ads, and the signed-in
// avatar-fallback read on users.
vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'billboard_guests') {
        return {
          select: () => ({
            eq: (_column: string, token: unknown) => ({
              maybeSingle: async () => ({
                data: db.guests.find((guest) => guest.token === token) ?? null,
                error: null
              })
            })
          }),
          insert: (values: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                if (db.guestInsertError) return { data: null, error: db.guestInsertError }
                const row = { id: db.nextGuestId++, ...values }
                db.guests.push(row)
                return { data: { id: row.id }, error: null }
              }
            })
          })
        }
      }
      if (table === 'billboard_ads') {
        return {
          select: () => {
            const filters: Array<[string, unknown]> = []
            let statuses: unknown[] = []
            const builder = {
              eq: (column: string, value: unknown) => {
                filters.push([column, value])
                return builder
              },
              in: (_column: string, values: unknown[]) => {
                statuses = values
                return builder
              },
              limit: () => builder,
              then: (onFulfilled: (value: unknown) => unknown) =>
                Promise.resolve({
                  data: db.ads
                    .filter((ad) => filters.every(([column, value]) => ad[column] === value))
                    .filter((ad) => statuses.includes(ad.status))
                    .slice(0, 1),
                  error: null
                }).then(onFulfilled)
            }
            return builder
          },
          insert: (values: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                if (db.adInsertError) return { data: null, error: db.adInsertError }
                const row = { id: db.nextAdId++, ...values }
                db.ads.push(row)
                return { data: { ...row }, error: null }
              }
            })
          })
        }
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) })
          })
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { POST } from './route'

/** A returning guest's bearer token — 64 lowercase hex, the minted shape. */
const GUEST_TOKEN = 'cd'.repeat(32)

function submitRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('https://cribble.dev/api/billboard/submit', {
    method: 'POST',
    headers: { host: 'cribble.dev', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

/** A valid logo-less pitch — no logo means no accent fetch runs. */
const validBody = () => ({
  text: 'Ship faster with Acme',
  company_name: 'Acme',
  link_url: 'https://example.com',
  billing_email: 'guest@acme.dev'
})

describe('POST /api/billboard/submit (guest paths)', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    getSessionUserIdMock.mockReset()
    // No session by default — these are the guest paths.
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    distributedLimitMock.mockReset()
    distributedLimitMock.mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      resetTime: Date.now() + 60_000
    })
    isEmailConfiguredMock.mockReset()
    isEmailConfiguredMock.mockReturnValue(true)
    sendGuestTrackingEmailMock.mockReset()
    sendGuestTrackingEmailMock.mockResolvedValue({ ok: true, messageId: 'msg_1' })
    db.guests = []
    db.ads = []
    db.nextGuestId = 21
    db.nextAdId = 100
    db.guestInsertError = null
    db.adInsertError = null
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('mints a guest on an anonymous submit: token cookie, tracking email and the guest 201 all carry the same identity', async () => {
    const response = await POST(submitRequest(validBody()))

    expect(response.status).toBe(201)

    // One fresh guest, keyed to the billing email, with a minted
    // 64-hex bearer token.
    expect(db.guests).toHaveLength(1)
    const guest = db.guests[0]
    expect(guest.email).toBe('guest@acme.dev')
    expect(guest.token).toMatch(/^[0-9a-f]{64}$/)

    // The ad row belongs to the guest — never a user column.
    expect(db.ads).toHaveLength(1)
    expect(db.ads[0].guest_id).toBe(21)
    expect(db.ads[0]).not.toHaveProperty('owner_user_id')
    expect(db.ads[0].status).toBe('PENDING')

    // The 201 tells the form it minted a guest and promised an inbox.
    const body = await response.json()
    expect(body).toMatchObject({ success: true, guest: true, trackingEmailSent: true })
    expect(body.ad.id).toBe(100)

    // The claim cookie is the SAME secret the guests row holds.
    const cookie = response.cookies.get(SPONSOR_CLAIM_COOKIE)
    expect(cookie?.value).toBe(guest.token)
    expect(cookie?.httpOnly).toBe(true)

    // And the magic-link email went to the billing address with it.
    expect(sendGuestTrackingEmailMock).toHaveBeenCalledWith({
      to: 'guest@acme.dev',
      adId: 100,
      token: guest.token
    })
  })

  it('still 201s with trackingEmailSent false when the email fails — the cookie already covers this browser', async () => {
    sendGuestTrackingEmailMock.mockResolvedValue({ ok: false, error: 'provider down' })

    const response = await POST(submitRequest(validBody()))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      guest: true,
      trackingEmailSent: false
    })
    expect(response.cookies.get(SPONSOR_CLAIM_COOKIE)?.value).toBe(db.guests[0].token)
  })

  it('skips the send entirely when email is unconfigured, without failing the submission', async () => {
    isEmailConfiguredMock.mockReturnValue(false)

    const response = await POST(submitRequest(validBody()))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      guest: true,
      trackingEmailSent: false
    })
    expect(sendGuestTrackingEmailMock).not.toHaveBeenCalled()
  })

  it('reuses the cookie guest on a return visit: no new guest, no new cookie, no email', async () => {
    db.guests = [{ id: 21, token: GUEST_TOKEN, email: 'guest@acme.dev' }]

    const response = await POST(
      submitRequest(validBody(), { cookie: `${SPONSOR_CLAIM_COOKIE}=${GUEST_TOKEN}` })
    )

    expect(response.status).toBe(201)
    expect(db.guests).toHaveLength(1)
    expect(db.ads[0].guest_id).toBe(21)

    const body = await response.json()
    expect(body).toMatchObject({ success: true, guest: true })
    // No fresh mint means no email promise and no re-set cookie.
    expect(body.trackingEmailSent).toBeUndefined()
    expect(response.cookies.get(SPONSOR_CLAIM_COOKIE)).toBeUndefined()
    expect(sendGuestTrackingEmailMock).not.toHaveBeenCalled()
  })

  it("enforces one in-flight submission per guest_id — another guest's pending ad never blocks", async () => {
    db.guests = [
      { id: 21, token: GUEST_TOKEN, email: 'guest@acme.dev' },
      { id: 22, token: 'ef'.repeat(32), email: 'other@acme.dev' }
    ]
    db.ads = [{ id: 7, guest_id: 22, status: 'PENDING' }]

    // Guest 22's pending row is invisible to guest 21.
    const clear = await POST(
      submitRequest(validBody(), { cookie: `${SPONSOR_CLAIM_COOKIE}=${GUEST_TOKEN}` })
    )
    expect(clear.status).toBe(201)

    // Now guest 21 has their own in-flight row — the 409 names it.
    const blocked = await POST(
      submitRequest(validBody(), { cookie: `${SPONSOR_CLAIM_COOKIE}=${GUEST_TOKEN}` })
    )
    expect(blocked.status).toBe(409)
    await expect(blocked.json()).resolves.toMatchObject({ pendingAdId: 100 })
    expect(db.ads).toHaveLength(2)
  })

  it('holds anonymous submissions to the per-IP distributed budget before anything mints', async () => {
    distributedLimitMock.mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      retryAfter: 60
    })

    const response = await POST(
      submitRequest(validBody(), { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    )

    expect(response.status).toBe(429)
    // Keyed on the visitor IP (first forwarded hop), cross-instance —
    // cookie-clearing must not reset the anonymous budget.
    expect(distributedLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ windowMs: 60 * 60 * 1000, maxRequests: 5 }),
      'bb-submit-ip:203.0.113.7'
    )
    expect(db.guests).toHaveLength(0)
    expect(db.ads).toHaveLength(0)
  })

  it('buckets header-stripping clients under the shared unknown key', async () => {
    await POST(submitRequest(validBody(), { 'x-forwarded-for': 'not-an-ip' }))

    expect(distributedLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'bb-submit-ip:unknown'
    )
  })

  it('rejects an invalid body BEFORE minting a guest — a refused pitch leaves no identity behind', async () => {
    const withoutEmail: Record<string, unknown> = { ...validBody() }
    delete withoutEmail.billing_email

    const response = await POST(submitRequest(withoutEmail))

    expect(response.status).toBe(400)
    expect(db.guests).toHaveLength(0)
    expect(db.ads).toHaveLength(0)
    expect(sendGuestTrackingEmailMock).not.toHaveBeenCalled()
  })

  it('500s when the guest mint fails, inserting no ad', async () => {
    db.guestInsertError = { message: 'insert failed' }

    const response = await POST(submitRequest(validBody()))

    expect(response.status).toBe(500)
    expect(db.ads).toHaveLength(0)
  })

  it('keeps the signed-in path byte-for-byte: original response shape, no cookie, no distributed limit', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 9 })

    const response = await POST(submitRequest(validBody()))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.guest).toBeUndefined()
    expect(body.trackingEmailSent).toBeUndefined()
    expect(response.cookies.get(SPONSOR_CLAIM_COOKIE)).toBeUndefined()
    // Users are budgeted by their account, not the anonymous IP pool.
    expect(distributedLimitMock).not.toHaveBeenCalled()
    expect(db.ads[0].owner_user_id).toBe(9)
    expect(db.ads[0]).not.toHaveProperty('guest_id')
    expect(db.guests).toHaveLength(0)
  })
})
