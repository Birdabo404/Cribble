import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { CursorProfileData } from '@/lib/cursorProfile'

// The run-shape of the sync cron, not the per-profile scrape logic.
// Under test: the queue is ordered stalest-first (last_synced_at ASC
// NULLS FIRST) so a budget-stopped run rotates its unfinished tail to
// the front of the next one, and the loop stops CLEANLY once the
// elapsed time crosses the budget — reporting synced/failed/skipped
// instead of dying mid-run at maxDuration. Time is virtual: Date.now
// is spied and each faked scrape advances it, so no test waits on the
// 15s fetch timeout.

const { fetchCursorProfileMock, upsertDailyMock, recordFailureMock, orderMock } = vi.hoisted(
  () => ({
    fetchCursorProfileMock: vi.fn(),
    upsertDailyMock: vi.fn(),
    recordFailureMock: vi.fn(),
    orderMock: vi.fn()
  })
)

vi.mock('@/lib/cursorProfile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cursorProfile')>()),
  fetchCursorProfile: fetchCursorProfileMock
}))

vi.mock('@/lib/cursorProfileServer', () => ({
  cursorProfileSnapshotColumns: () => ({}),
  upsertCursorProfileDaily: upsertDailyMock,
  recordCursorProfileSyncFailure: recordFailureMock
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'cursor_profiles') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({ order: orderMock }),
        update: () => ({ eq: async () => ({ error: null }) })
      }
    }
  })
}))

import { POST } from './route'

const CRON_SECRET = 'test-cron-secret'

function cronRequest() {
  return new NextRequest('https://cribble.dev/api/cron/cursor-profile-sync', {
    method: 'POST',
    headers: { 'x-cron-secret': CRON_SECRET }
  })
}

function scrapedProfile(): CursorProfileData {
  return {
    displayName: 'Synced',
    avatarUrl: null,
    joinedDate: null,
    stats: {
      currentStreak: 1,
      longestStreak: 1,
      agentsLocal: 1,
      agentsCloud: 0,
      longestAgentSeconds: 10
    },
    topModels: [],
    tokensOverTime: [{ date: '2026-08-29', tokens: 5 }],
    agentsOverTime: []
  }
}

function linkedRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    user_id: index + 1,
    cursor_username: `user${index + 1}`
  }))
}

describe('cursor-profile-sync cron', () => {
  let logSpy: MockInstance
  let warnSpy: MockInstance
  /** Virtual clock behind the Date.now spy. */
  let nowMs = 0

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
    nowMs = 0
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    fetchCursorProfileMock.mockReset()
    upsertDailyMock.mockReset()
    upsertDailyMock.mockResolvedValue(null)
    recordFailureMock.mockReset()
    recordFailureMock.mockResolvedValue(null)
    orderMock.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
    vi.restoreAllMocks()
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('orders the queue stalest-first so a stopped tail leads the next run', async () => {
    orderMock.mockResolvedValue({ data: linkedRows(2), error: null })
    fetchCursorProfileMock.mockResolvedValue({ status: 'ok', profile: scrapedProfile() })

    const response = await POST(cronRequest())

    expect(response.status).toBe(200)
    expect(orderMock).toHaveBeenCalledWith('last_synced_at', {
      ascending: true,
      nullsFirst: true
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      synced: 2,
      failed: 0,
      skipped: 0
    })
  })

  it('stops cleanly before the budget and reports the skipped tail', async () => {
    orderMock.mockResolvedValue({ data: linkedRows(5), error: null })
    // Each scrape "takes" 100s of the 280s budget (300s maxDuration
    // minus 20s headroom): three fit, the check before the fourth
    // trips at 300s elapsed.
    fetchCursorProfileMock.mockImplementation(async () => {
      nowMs += 100_000
      return { status: 'ok', profile: scrapedProfile() }
    })

    const response = await POST(cronRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      synced: 3,
      failed: 0,
      skipped: 2
    })
    expect(fetchCursorProfileMock).toHaveBeenCalledTimes(3)
    expect(warnSpy).toHaveBeenCalledWith(
      '[CursorProfileSync] Budget reached after 3 profiles — skipping 2'
    )
  })

  it('counts a failing profile without ending the run', async () => {
    orderMock.mockResolvedValue({ data: linkedRows(2), error: null })
    fetchCursorProfileMock
      .mockResolvedValueOnce({ status: 'private' })
      .mockResolvedValueOnce({ status: 'ok', profile: scrapedProfile() })

    const response = await POST(cronRequest())

    await expect(response.json()).resolves.toEqual({
      success: true,
      synced: 1,
      failed: 1,
      skipped: 0
    })
    expect(recordFailureMock).toHaveBeenCalledTimes(1)
  })
})
