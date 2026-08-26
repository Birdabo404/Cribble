import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The shared click resolver supports two payment models: flipper/rail
// ads are paid on billboard_ads itself, while leaderboard payments live
// in a contribution ledger and intentionally leave the ad's paid_at NULL.
// These route tests lock that distinction down so a paid sponsor can
// always reach its destination.

const { adReadResult, paidBidReadResult, bumpUpdateMock } = vi.hoisted(() => ({
  adReadResult: { value: { data: null, error: null } as { data: unknown; error: unknown } },
  paidBidReadResult: {
    value: { data: null, error: null } as { data: unknown; error: unknown }
  },
  bumpUpdateMock: vi.fn()
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'billboard_ads') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve(adReadResult.value) })
          }),
          update: bumpUpdateMock
        }
      }
      if (table === 'leaderboard_sponsor_bids') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                not: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve(paidBidReadResult.value)
                  })
                })
              })
            })
          })
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { GET } from './route'

function clickRequest(adId = 13) {
  return new NextRequest(`https://cribble.dev/api/billboard/${adId}/click`)
}

function approvedAd(overrides: Record<string, unknown> = {}) {
  return {
    id: 13,
    link_url: 'https://advertiser.example/offer',
    placement: 'leaderboard',
    status: 'APPROVED',
    paid_at: null,
    clicks: 4,
    ...overrides
  }
}

describe('GET /api/billboard/[id]/click', () => {
  beforeEach(() => {
    adReadResult.value = { data: approvedAd(), error: null }
    paidBidReadResult.value = { data: { id: 91 }, error: null }
    bumpUpdateMock.mockReset()
    bumpUpdateMock.mockReturnValue({
      eq: () => ({
        eq: () => ({
          select: () => Promise.resolve({ data: [{ id: 13 }], error: null })
        })
      })
    })
  })

  it('redirects a paid leaderboard sponsor whose ad-row paid_at is intentionally null', async () => {
    const response = await GET(clickRequest(), { params: Promise.resolve({ id: '13' }) })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://advertiser.example/offer')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(bumpUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ clicks: 5 })
    )
  })

  it('does not expose an approved leaderboard creative that has never been paid', async () => {
    paidBidReadResult.value = { data: null, error: null }

    const response = await GET(clickRequest(), { params: Promise.resolve({ id: '13' }) })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Ad not found' })
    expect(bumpUpdateMock).not.toHaveBeenCalled()
  })

  it('keeps the existing ad-row payment path for flipper and rail ads', async () => {
    adReadResult.value = {
      data: approvedAd({
        placement: 'rail',
        paid_at: '2026-08-20T00:00:00.000Z'
      }),
      error: null
    }

    const response = await GET(clickRequest(), { params: Promise.resolve({ id: '13' }) })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://advertiser.example/offer')
  })
})
