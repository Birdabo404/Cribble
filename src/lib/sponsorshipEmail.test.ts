import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// sendSponsorshipPaymentEmail is the Billboard half of outbound email
// (the waitlist invite being the other). Under test: the three-var
// config gate (reply-to included — buyer questions land in that
// thread), the exact provider payload (one recipient, reply-to, the
// ask + pay-and-track link + X backup in both bodies, the per-decision
// idempotency key), sanitized failure text, and lazy client
// construction — `next build` must survive with zero email env set.

const { resendConstructorMock, sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn()
  const resendConstructorMock = vi.fn(() => ({ emails: { send: sendMock } }))
  return { resendConstructorMock, sendMock }
})

vi.mock('resend', () => ({ Resend: resendConstructorMock }))

import { isSponsorshipEmailConfigured, sendSponsorshipPaymentEmail } from './sponsorshipEmail'

const REVIEWED_AT = '2026-08-11T09:30:00.000Z'

const payment = () => ({
  to: 'buyer@acme.dev',
  adId: 17,
  reviewedAt: REVIEWED_AT,
  placement: 'rail' as const,
  priceLine: '$499/wk · slot R1'
})

beforeEach(() => {
  sendMock.mockReset()
  resendConstructorMock.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isSponsorshipEmailConfigured', () => {
  it('is true when RESEND_API_KEY, SPONSORSHIP_EMAIL_FROM and SPONSORSHIP_EMAIL_REPLY_TO are set', () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('SPONSORSHIP_EMAIL_FROM', 'Cribble <birdabo@cribble.dev>')
    vi.stubEnv('SPONSORSHIP_EMAIL_REPLY_TO', 'birdabo@cribble.dev')

    expect(isSponsorshipEmailConfigured()).toBe(true)
  })

  it('is false without RESEND_API_KEY', () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('SPONSORSHIP_EMAIL_FROM', 'Cribble <birdabo@cribble.dev>')
    vi.stubEnv('SPONSORSHIP_EMAIL_REPLY_TO', 'birdabo@cribble.dev')

    expect(isSponsorshipEmailConfigured()).toBe(false)
  })

  it('is false without SPONSORSHIP_EMAIL_FROM', () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('SPONSORSHIP_EMAIL_FROM', '')
    vi.stubEnv('SPONSORSHIP_EMAIL_REPLY_TO', 'birdabo@cribble.dev')

    expect(isSponsorshipEmailConfigured()).toBe(false)
  })

  it('is false without SPONSORSHIP_EMAIL_REPLY_TO', () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('SPONSORSHIP_EMAIL_FROM', 'Cribble <birdabo@cribble.dev>')
    vi.stubEnv('SPONSORSHIP_EMAIL_REPLY_TO', '')

    expect(isSponsorshipEmailConfigured()).toBe(false)
  })
})

describe('sendSponsorshipPaymentEmail', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('SPONSORSHIP_EMAIL_FROM', 'Cribble <birdabo@cribble.dev>')
    vi.stubEnv('SPONSORSHIP_EMAIL_REPLY_TO', 'birdabo@cribble.dev')
  })

  it('sends one email carrying the ask, tracker link, X backup and per-decision idempotency key', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_456' }, error: null })

    const result = await sendSponsorshipPaymentEmail(payment())

    expect(result).toEqual({ ok: true, messageId: 'msg_456' })
    expect(resendConstructorMock).toHaveBeenCalledTimes(1)
    expect(resendConstructorMock).toHaveBeenCalledWith('re_test_123')
    expect(sendMock).toHaveBeenCalledTimes(1)
    const [payload, options] = sendMock.mock.calls[0]
    expect(payload.from).toBe('Cribble <birdabo@cribble.dev>')
    // A single string recipient — never a list.
    expect(payload.to).toBe('buyer@acme.dev')
    // Replies with questions go straight to the founder inbox.
    expect(payload.replyTo).toBe('birdabo@cribble.dev')
    expect(payload.subject).toBe('Your Cribble sponsorship is approved — payment details')
    for (const body of [payload.html, payload.text]) {
      expect(body).toContain('$499/wk · slot R1')
      expect(body).toContain('https://cribble.dev/sponsorship')
      expect(body).toContain('https://x.com/birdabo')
      expect(body).toContain('@birdabo')
      expect(body).toContain('7 days')
    }
    expect(options).toEqual({ idempotencyKey: `billboard-payment/17/${REVIEWED_AT}` })
  })

  it('maps a provider error object to a sanitized ok:false result', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'The from address is not verified' }
    })

    await expect(sendSponsorshipPaymentEmail(payment())).resolves.toEqual({
      ok: false,
      error: 'validation_error: The from address is not verified'
    })
  })

  it('catches a thrown network error and truncates the sanitized message', async () => {
    sendMock.mockRejectedValue(new TypeError(`fetch failed: ${'x'.repeat(400)}`))

    const result = await sendSponsorshipPaymentEmail(payment())

    expect(result.ok).toBe(false)
    const failure = result as Extract<typeof result, { ok: false }>
    expect(failure.error.startsWith('TypeError: fetch failed')).toBe(true)
    expect(failure.error).toHaveLength(300)
  })

  it('fails closed without constructing a client when unconfigured', async () => {
    vi.stubEnv('RESEND_API_KEY', '')

    await expect(sendSponsorshipPaymentEmail(payment())).resolves.toEqual({
      ok: false,
      error: 'Email delivery is not configured'
    })
    expect(resendConstructorMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('fails closed when only the reply-to inbox is missing', async () => {
    vi.stubEnv('SPONSORSHIP_EMAIL_REPLY_TO', '')

    await expect(sendSponsorshipPaymentEmail(payment())).resolves.toEqual({
      ok: false,
      error: 'Email delivery is not configured'
    })
    expect(resendConstructorMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('module import', () => {
  it('constructs no Resend client at import time with the env unset', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('SPONSORSHIP_EMAIL_FROM', '')
    vi.stubEnv('SPONSORSHIP_EMAIL_REPLY_TO', '')
    vi.resetModules()

    // A top-level `new Resend(...)` would fire (or throw) right here.
    const freshModule = await import('./sponsorshipEmail')

    expect(resendConstructorMock).not.toHaveBeenCalled()
    expect(freshModule.isSponsorshipEmailConfigured()).toBe(false)
  })
})
