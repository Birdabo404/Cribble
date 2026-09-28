import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { unwrapMock, applyMock, insertMock, deleteEqMock } = vi.hoisted(() => ({
  unwrapMock: vi.fn(),
  applyMock: vi.fn(),
  insertMock: vi.fn(),
  deleteEqMock: vi.fn()
}))

vi.mock('@/lib/dodo', () => ({
  getDodoWebhookKey: () => process.env.DODO_PAYMENTS_WEBHOOK_KEY || null,
  getDodoClient: () =>
    process.env.DODO_PAYMENTS_API_KEY
      ? { webhooks: { unwrap: unwrapMock } }
      : null,
  isDodoActive: () => {
    if (!process.env.DODO_PAYMENTS_API_KEY) return false
    if (process.env.VERCEL_ENV === 'production') {
      return process.env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode'
    }
    return true
  }
}))

vi.mock('@/lib/dodoSync', () => ({
  applyDodoEvent: applyMock
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'payment_events') throw new Error(`Unexpected table: ${table}`)
      return {
        insert: insertMock,
        delete: () => ({ eq: deleteEqMock })
      }
    }
  })
}))

import { POST } from './route'

function webhookRequest(body: string) {
  return new NextRequest('https://cribble.dev/api/webhooks/dodo', {
    method: 'POST',
    body,
    headers: {
      'webhook-id': 'evt_dodo_1',
      'webhook-timestamp': '1690000000',
      'webhook-signature': 'v1,sig'
    }
  })
}

describe('POST /api/webhooks/dodo', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    unwrapMock.mockReset()
    applyMock.mockReset()
    insertMock.mockReset()
    deleteEqMock.mockReset()
  })

  it('returns 503 in production when the environment is still test mode', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('DODO_PAYMENTS_ENVIRONMENT', 'test_mode')
    vi.stubEnv('DODO_PAYMENTS_WEBHOOK_KEY', 'whsec_test')
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'test_key')
    const response = await POST(webhookRequest('{}'))
    expect(response.status).toBe(503)
    expect(unwrapMock).not.toHaveBeenCalled()
  })

  it('returns 503 when the webhook key is missing', async () => {
    vi.stubEnv('DODO_PAYMENTS_WEBHOOK_KEY', '')
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'test_key')
    const response = await POST(webhookRequest('{}'))
    expect(response.status).toBe(503)
    expect(unwrapMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the signature does not verify', async () => {
    vi.stubEnv('DODO_PAYMENTS_WEBHOOK_KEY', 'whsec_test')
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'test_key')
    unwrapMock.mockImplementation(() => {
      throw new Error('bad signature')
    })
    const response = await POST(webhookRequest('{}'))
    expect(response.status).toBe(403)
  })

  it('skips a duplicate event id', async () => {
    vi.stubEnv('DODO_PAYMENTS_WEBHOOK_KEY', 'whsec_test')
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'test_key')
    unwrapMock.mockReturnValue({ type: 'subscription.active', data: { subscription_id: 'sub_1' } })
    insertMock.mockResolvedValue({ error: { code: '23505', message: 'duplicate' } })
    const response = await POST(webhookRequest('{"type":"subscription.active"}'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, skipped: true })
    expect(applyMock).not.toHaveBeenCalled()
  })

  it('grants on subscription.active and deletes the event row if processing throws', async () => {
    vi.stubEnv('DODO_PAYMENTS_WEBHOOK_KEY', 'whsec_test')
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'test_key')
    unwrapMock.mockReturnValue({
      type: 'subscription.active',
      data: { subscription_id: 'sub_1', product_id: 'pdt_1', metadata: { userId: 4 } }
    })
    insertMock.mockResolvedValue({ error: null })
    applyMock.mockResolvedValueOnce(undefined)
    deleteEqMock.mockResolvedValue({ error: null })

    const ok = await POST(webhookRequest('{"type":"subscription.active"}'))
    expect(ok.status).toBe(200)
    expect(applyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'subscription.active' })
    )

    applyMock.mockRejectedValueOnce(new Error('grant failed'))
    const failed = await POST(webhookRequest('{"type":"subscription.active"}'))
    expect(failed.status).toBe(500)
    expect(deleteEqMock).toHaveBeenCalledWith('event_id', 'evt_dodo_1')
  })
})
