'use client'

// Shared client-side fetcher for /api/user/me. On a hard load the nav
// shell (useNavUser) and whatever page mounted underneath it both want
// the session user — this module collapses those into a single network
// request via a shared in-flight promise, plus a short TTL cache so
// near-simultaneous mounts (client-side nav, lazy effects) reuse the
// same response. Flows that MUTATE user state (extension sync, manual
// refresh, logout) must call invalidate() first so their refetch skips
// the cache.

import type { MeResponsePayload } from '@/types/dashboard'

interface MeRequestSuccess {
  ok: true
  status: number
  data: MeResponsePayload
}

interface MeRequestFailure {
  ok: false
  /** HTTP status of the failed response; null for network-level errors. */
  status: number | null
}

export type MeRequestResult = MeRequestSuccess | MeRequestFailure

const TTL_MS = 12_000

let cached: { at: number; result: MeRequestResult } | null = null
let inflight: Promise<MeRequestResult> | null = null
// Bumped by invalidate(). A request that started before the bump must
// not write its (now stale) response into the cache when it settles.
let generation = 0

export function fetchMe(): Promise<MeRequestResult> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return Promise.resolve(cached.result)
  }
  if (inflight) return inflight

  const startedGeneration = generation
  const request = (async (): Promise<MeRequestResult> => {
    try {
      const res = await fetch('/api/user/me', { credentials: 'include' })
      if (!res.ok) {
        const result: MeRequestFailure = { ok: false, status: res.status }
        // HTTP auth/error answers are resolved session state too. Cache them
        // briefly so later shell effects do not repeat the same noisy probe;
        // network failures remain uncached and retryable.
        if (startedGeneration === generation) {
          cached = { at: Date.now(), result }
        }
        return result
      }
      const data = (await res.json()) as MeResponsePayload
      const result: MeRequestSuccess = { ok: true, status: res.status, data }
      if (startedGeneration === generation) {
        cached = { at: Date.now(), result }
      }
      return result
    } catch {
      // Resolve (never reject) so shared awaiters can't leak unhandled
      // rejections. Failures are never cached — a retry always refetches.
      return { ok: false, status: null }
    }
  })()
  inflight = request
  // Identity check: invalidate() may have already handed the slot to a
  // newer request by the time this one settles.
  void request.finally(() => {
    if (inflight === request) inflight = null
  })
  return request
}

export function invalidate(): void {
  generation += 1
  cached = null
  // Drop the in-flight request too: it was issued before the mutation
  // this invalidation announces, so its response is already stale.
  inflight = null
}
