import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
  BURN_CONSENT_MIN_VERSION,
  clearBurnAggregateCache,
  fetchPilotHiringFacts,
  hasBurnBoardConsent
} from './teamHiringServer'

// Two contracts live here. First, the DRIFT TRIPWIRE: the consent
// predicate in teamHiringServer.ts mirrors the gate inside the
// agent_token_leaderboard RPC (currently migrations/047, which
// superseded 043). The RPC silently drops non-consented pilots from its
// result, so if the gate ever moves on one side only, the mirror would
// mint false verdicts — a pilot the RPC excludes would read "verified,
// zero usage" (MISSED) instead of UNVERIFIED. The tripwire parses the
// gate out of the migration SQL in this repo and pins the mirror to it.
// Second, the burn-aggregate TTL CACHE: the RPC is a full-population
// all-time scan, so one successful run is shared for 60s; failures are
// never cached and consent stays a live per-request read.

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations'
)

/** The body of the CURRENT agent_token_leaderboard definition: scan the
 *  numbered migration files in order and keep the last CREATE FUNCTION,
 *  so a future migration that redefines the RPC moves this pin with it. */
function currentLeaderboardRpcBody(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  let latest: string | null = null
  for (const name of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
    const creates = [
      ...sql.matchAll(/create (?:or replace )?function public\.agent_token_leaderboard\s*\(/g)
    ]
    if (creates.length === 0) continue
    const start = creates[creates.length - 1].index ?? 0
    const bodyOpen = sql.indexOf('$$', start)
    const bodyClose = sql.indexOf('$$;', bodyOpen + 2)
    latest = sql.slice(bodyOpen, bodyClose)
  }

  if (latest === null) {
    throw new Error('No agent_token_leaderboard definition found under migrations/')
  }
  return latest
}

describe('consent-gate mirror vs the agent_token_leaderboard RPC', () => {
  it('pins the mirror to the gate inside the current RPC definition', () => {
    const body = currentLeaderboardRpcBody()

    // The RPC's enabled_users CTE must still require the sharing flag...
    expect(body).toMatch(/sharing\.leaderboard_enabled\b/)

    // ...and its consent floor must equal the mirror's constant. If this
    // fails, one side of the gate moved alone: update BOTH the RPC (via
    // a new migration) and hasBurnBoardConsent in teamHiringServer.ts.
    const version = body.match(/sharing\.consent_version\s*>=\s*(\d+)/)
    expect(Number(version?.[1])).toBe(BURN_CONSENT_MIN_VERSION)
  })

  it('applies leaderboard_enabled AND consent_version >= 2 to sharing rows', () => {
    const consent = (leaderboard_enabled: boolean, consent_version: number | string | null) =>
      hasBurnBoardConsent({ leaderboard_enabled, consent_version })

    expect(consent(true, BURN_CONSENT_MIN_VERSION)).toBe(true)
    expect(consent(true, BURN_CONSENT_MIN_VERSION + 1)).toBe(true)
    // SMALLINT can ride as a string off the wire.
    expect(consent(true, String(BURN_CONSENT_MIN_VERSION))).toBe(true)
    expect(consent(true, BURN_CONSENT_MIN_VERSION - 1)).toBe(false)
    expect(consent(false, 99)).toBe(false)
    expect(consent(true, null)).toBe(false)
  })
})

interface FakeRows {
  scores: { user_id: number; total_score: number | null }[]
  sharing: { user_id: number; leaderboard_enabled: boolean; consent_version: number | null }[]
}

/** Just enough client for fetchPilotHiringFacts: two table reads that
 *  terminate on .in(), and the burn RPC handed in as a mock. */
function fakeClient(rows: FakeRows, rpc: Mock): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({
        in: () =>
          Promise.resolve({
            data: table === 'user_scores' ? rows.scores : rows.sharing,
            error: null
          })
      })
    }),
    rpc
  } as unknown as SupabaseClient
}

describe('fetchPilotHiringFacts — burn aggregate TTL cache', () => {
  const SCORES = [{ user_id: 21, total_score: 60_000 }]
  const CONSENTED = [{ user_id: 21, leaderboard_enabled: true, consent_version: 2 }]
  const RPC_ROWS = [{ user_id: 21, total_tokens: 5_000_000, cost_usd: 12 }]
  const VERIFIED_FACTS = {
    totalScore: 60_000,
    burnVerified: true,
    totalTokens: 5_000_000,
    burnUsd: 12
  }
  const UNVERIFIED_FACTS = {
    totalScore: 60_000,
    burnVerified: false,
    totalTokens: null,
    burnUsd: null
  }

  let rpcMock: Mock

  beforeEach(() => {
    clearBurnAggregateCache()
    vi.useFakeTimers()
    rpcMock = vi.fn().mockResolvedValue({ data: RPC_ROWS, error: null })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('runs the full-population scan once and shares it across reads inside the TTL', async () => {
    const client = fakeClient({ scores: SCORES, sharing: CONSENTED }, rpcMock)

    const first = await fetchPilotHiringFacts(client, [21])
    vi.advanceTimersByTime(59_000)
    const second = await fetchPilotHiringFacts(client, [21])

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(first.get(21)).toEqual(VERIFIED_FACTS)
    expect(second.get(21)).toEqual(VERIFIED_FACTS)
  })

  it('rescans once the 60s TTL lapses', async () => {
    const client = fakeClient({ scores: SCORES, sharing: CONSENTED }, rpcMock)

    await fetchPilotHiringFacts(client, [21])
    vi.advanceTimersByTime(60_000)
    const refreshed = await fetchPilotHiringFacts(client, [21])

    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(refreshed.get(21)).toEqual(VERIFIED_FACTS)
  })

  it('never caches a failed scan — this read degrades to UNVERIFIED and the next retries', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: 'scan timeout' } })
      .mockResolvedValueOnce({ data: RPC_ROWS, error: null })
    const client = fakeClient({ scores: SCORES, sharing: CONSENTED }, rpcMock)

    const degraded = await fetchPilotHiringFacts(client, [21])
    const recovered = await fetchPilotHiringFacts(client, [21])

    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(degraded.get(21)).toEqual(UNVERIFIED_FACTS)
    expect(recovered.get(21)).toEqual(VERIFIED_FACTS)
  })

  it('degrades a thrown scan the same way, without poisoning the cache', async () => {
    rpcMock.mockRejectedValueOnce(new Error('network down'))
    const client = fakeClient({ scores: SCORES, sharing: CONSENTED }, rpcMock)

    const degraded = await fetchPilotHiringFacts(client, [21])
    const recovered = await fetchPilotHiringFacts(client, [21])

    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(degraded.get(21)).toEqual(UNVERIFIED_FACTS)
    expect(recovered.get(21)).toEqual(VERIFIED_FACTS)
  })

  it('skips the scan entirely when no requested pilot holds burn-board consent', async () => {
    const client = fakeClient(
      {
        scores: SCORES,
        // v1 consent predates the breakdown disclosure — below the gate.
        sharing: [{ user_id: 21, leaderboard_enabled: true, consent_version: 1 }]
      },
      rpcMock
    )

    const facts = await fetchPilotHiringFacts(client, [21])

    expect(rpcMock).not.toHaveBeenCalled()
    expect(facts.get(21)).toEqual(UNVERIFIED_FACTS)
  })

  it('honors a mid-window revocation — live consent outranks the cached aggregate row', async () => {
    const client = fakeClient({ scores: SCORES, sharing: CONSENTED }, rpcMock)
    await fetchPilotHiringFacts(client, [21])

    const revoked = fakeClient(
      {
        scores: SCORES,
        sharing: [{ user_id: 21, leaderboard_enabled: false, consent_version: 2 }]
      },
      rpcMock
    )
    const facts = await fetchPilotHiringFacts(revoked, [21])

    // The pilot's row still sits in the cached population-wide map, but
    // the fresh per-request consent read keeps it unreadable.
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(facts.get(21)).toEqual(UNVERIFIED_FACTS)
  })
})
