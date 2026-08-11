import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// sendWaitlistInviteEmail is the only outbound email in the app. Under
// test: config detection, the exact provider payload (one recipient,
// join URL + raw code in both bodies, the stable idempotency key that
// makes retries safe), sanitized failure text, and lazy client
// construction — `next build` must survive with zero email env set.

const { resendConstructorMock, sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn()
  const resendConstructorMock = vi.fn(() => ({ emails: { send: sendMock } }))
  return { resendConstructorMock, sendMock }
})

vi.mock('resend', () => ({ Resend: resendConstructorMock }))

import { isInviteEmailConfigured, sendWaitlistInviteEmail } from './inviteEmail'

const WAITLIST_ID = '7d3f2a15-4c0b-4e8a-9f6d-1b2c3d4e5f60'

const invite = () => ({
  to: 'first@waitlist.dev',
  code: 'CRIB-ABCD-2345',
  joinUrl: 'https://cribble.dev/join/CRIB-ABCD-2345',
  waitlistId: WAITLIST_ID
})

beforeEach(() => {
  sendMock.mockReset()
  resendConstructorMock.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isInviteEmailConfigured', () => {
  it('is true when both RESEND_API_KEY and INVITE_EMAIL_FROM are set', () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('INVITE_EMAIL_FROM', 'Cribble <invites@cribble.dev>')

    expect(isInviteEmailConfigured()).toBe(true)
  })

  it('is false without RESEND_API_KEY', () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('INVITE_EMAIL_FROM', 'Cribble <invites@cribble.dev>')

    expect(isInviteEmailConfigured()).toBe(false)
  })

  it('is false without INVITE_EMAIL_FROM', () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('INVITE_EMAIL_FROM', '')

    expect(isInviteEmailConfigured()).toBe(false)
  })
})

describe('sendWaitlistInviteEmail', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('INVITE_EMAIL_FROM', 'Cribble <invites@cribble.dev>')
  })

  it('sends one email carrying the join URL, raw code and stable idempotency key', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_123' }, error: null })

    const result = await sendWaitlistInviteEmail(invite())

    expect(result).toEqual({ ok: true, messageId: 'msg_123' })
    expect(resendConstructorMock).toHaveBeenCalledTimes(1)
    expect(resendConstructorMock).toHaveBeenCalledWith('re_test_123')
    expect(sendMock).toHaveBeenCalledTimes(1)
    const [payload, options] = sendMock.mock.calls[0]
    expect(payload.from).toBe('Cribble <invites@cribble.dev>')
    // A single string recipient — never a list.
    expect(payload.to).toBe('first@waitlist.dev')
    expect(payload.subject).toBe('Your Cribble beta invite')
    for (const body of [payload.html, payload.text]) {
      expect(body).toContain('https://cribble.dev/join/CRIB-ABCD-2345')
      expect(body).toContain('CRIB-ABCD-2345')
    }
    expect(options).toEqual({ idempotencyKey: `waitlist-invite/${WAITLIST_ID}` })
  })

  it('maps a provider error object to a sanitized ok:false result', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'The from address is not verified' }
    })

    await expect(sendWaitlistInviteEmail(invite())).resolves.toEqual({
      ok: false,
      error: 'validation_error: The from address is not verified'
    })
  })

  it('catches a thrown network error and truncates the sanitized message', async () => {
    sendMock.mockRejectedValue(new TypeError(`fetch failed: ${'x'.repeat(400)}`))

    const result = await sendWaitlistInviteEmail(invite())

    expect(result.ok).toBe(false)
    const failure = result as Extract<typeof result, { ok: false }>
    expect(failure.error.startsWith('TypeError: fetch failed')).toBe(true)
    expect(failure.error).toHaveLength(300)
  })

  it('fails closed without constructing a client when unconfigured', async () => {
    vi.stubEnv('RESEND_API_KEY', '')

    await expect(sendWaitlistInviteEmail(invite())).resolves.toEqual({
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
    vi.stubEnv('INVITE_EMAIL_FROM', '')
    vi.resetModules()

    // A top-level `new Resend(...)` would fire (or throw) right here.
    const freshModule = await import('./inviteEmail')

    expect(resendConstructorMock).not.toHaveBeenCalled()
    expect(freshModule.isInviteEmailConfigured()).toBe(false)
  })
})
