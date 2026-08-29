import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Member-side accept: the invite must still be this member's PENDING row
// AND the inviting team must still be live (TEAM tier + approved + not
// banned) — a lapsed team must not consume the member's single active
// slot. The partial unique index (one ACTIVE affiliation per member) is
// the accept-race backstop: its 23505 comes back as a friendly 409. A
// successful accept sweeps the member's open transfer requests — dead
// weight once they fly colors.

const { sessionMock, notifyMock, state } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  notifyMock: vi.fn(),
  state: {
    inviteRow: null as Record<string, unknown> | null,
    updateResult: {
      data: [{ id: 501 }] as { id: number }[] | null,
      error: null as { code?: string } | null
    },
    updates: [] as Record<string, unknown>[],
    deletes: [] as Record<string, unknown>[],
    memberRow: null as Record<string, unknown> | null
  }
}))

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: sessionMock }))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({
    success: true,
    limit: 60,
    remaining: 59,
    resetTime: Date.now() + 60_000
  }),
  createRateLimitResponse: () => new Headers(),
  rateLimitConfigs: { api: { windowMs: 60_000, maxRequests: 60 } }
}))

vi.mock('@/lib/notifications', () => ({ insertMissingNotifications: notifyMock }))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          // loadUserRow terminal — the accepting member's own row.
          maybeSingle: () => Promise.resolve({ data: state.memberRow, error: null })
        }
        return builder
      }
      if (table === 'team_affiliations') {
        let op: 'read' | 'update' | 'delete' = 'read'
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return builder
          },
          order: () => builder,
          maybeSingle: () => Promise.resolve({ data: state.inviteRow, error: null }),
          update: (values: Record<string, unknown>) => {
            op = 'update'
            state.updates.push(values)
            return builder
          },
          delete: () => {
            op = 'delete'
            // Reference, not copy: the eq() calls that follow land here.
            state.deletes.push(filters)
            return builder
          },
          // The guarded update chain ends in .select('id'), the sweep on
          // a bare eq() — both are awaited.
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) =>
            Promise.resolve(
              op === 'update'
                ? state.updateResult
                : op === 'delete'
                  ? { data: null, error: null }
                  : { data: [], error: null }
            ).then(onFulfilled, onRejected)
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { POST } from './route'

const LIVE_TEAM = {
  id: 7,
  twitter_username: 'acme',
  twitter_name: 'ACME Corp',
  twitter_profile_image: null,
  subscription_tier: 'TEAM',
  team_review_status: 'approved',
  status: 'active'
}

const PENDING_INVITE = {
  id: 501,
  status: 'pending',
  invited_at: '2026-08-01T00:00:00Z',
  accepted_at: null,
  team: LIVE_TEAM
}

function acceptRequest(affiliationId: number) {
  return new NextRequest('https://cribble.dev/api/team/invites', {
    method: 'POST',
    body: JSON.stringify({ affiliationId }),
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('POST /api/team/invites — accept guards', () => {
  beforeEach(() => {
    sessionMock.mockReset()
    sessionMock.mockResolvedValue({ ok: true, userId: 21 })
    notifyMock.mockReset()
    notifyMock.mockResolvedValue(undefined)
    state.inviteRow = { ...PENDING_INVITE, team: { ...LIVE_TEAM } }
    state.updateResult = { data: [{ id: 501 }], error: null }
    state.updates = []
    state.deletes = []
    state.memberRow = {
      id: 21,
      twitter_username: 'pilot',
      twitter_name: 'Pilot One',
      twitter_profile_image: null,
      subscription_tier: 'FREE',
      team_review_status: null,
      status: 'active'
    }
  })

  it('404s when the caller has no such pending invite', async () => {
    state.inviteRow = null

    const response = await POST(acceptRequest(501))

    expect(response.status).toBe(404)
    expect(state.updates).toHaveLength(0)
  })

  it('409s when the inviting team is no longer TEAM + approved', async () => {
    state.inviteRow = {
      ...PENDING_INVITE,
      team: { ...LIVE_TEAM, subscription_tier: 'FREE' }
    }

    const response = await POST(acceptRequest(501))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'This team is no longer active'
    })
    expect(state.updates).toHaveLength(0)
  })

  it('flips the row to active and notifies the team, keyed by the row id', async () => {
    const response = await POST(acceptRequest(501))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      team: { userId: 7, username: 'acme' }
    })
    expect(state.updates).toEqual([
      expect.objectContaining({ status: 'active', accepted_at: expect.any(String) })
    ])
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), 7, [
      expect.objectContaining({
        type: 'team_invite_accepted',
        dedupeKey: 'team_invite_accepted_501',
        data: expect.objectContaining({ memberUserId: 21, username: 'pilot' })
      })
    ])
  })

  it('sweeps the member\'s open transfer requests after an accept — pending invites untouched', async () => {
    const response = await POST(acceptRequest(501))

    expect(response.status).toBe(200)
    // Scoped to the member's APPLIED rows: status='applied' can never
    // match another pending invite (those die on the one-active index).
    expect(state.deletes).toEqual([{ member_user_id: 21, status: 'applied' }])
  })

  it('maps the one-active-affiliation 23505 to a friendly 409', async () => {
    state.updateResult = { data: null, error: { code: '23505' } }

    const response = await POST(acceptRequest(501))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'You already fly with a team — leave it first'
    })
    expect(notifyMock).not.toHaveBeenCalled()
    expect(state.deletes).toHaveLength(0)
  })

  it('409s when the guarded update matches nothing (row changed underneath)', async () => {
    state.updateResult = { data: [], error: null }

    const response = await POST(acceptRequest(501))

    expect(response.status).toBe(409)
    expect(notifyMock).not.toHaveBeenCalled()
  })
})
