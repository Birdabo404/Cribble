'use client'

// The rail feed for the profile's TRANSMISSIONS panel: GET
// /api/billboard/rails, retried ~30s after a failure, gated on the first
// success. Lifted from the retired fixed rail columns minus their
// viewport gate — the panel now sits inside the profile layout, which
// decides when it shows.
//
// Keyed on `enabled` and the concrete pathname so profile-to-profile
// navigation refetches (the feed is 60s-cached server-side, so repeat
// hits are cheap). A network failure, non-ok status or malformed body
// schedules one retry by bumping retryNonce; a retry that fails again
// re-arms the timer, so attempts keep a ~30s cadence for as long as the
// hook stays enabled. Success schedules nothing, and a pending timer
// dies in the cleanup whenever the deps change or the consumer
// unmounts. A failed refetch after an earlier success keeps the
// previous feed on screen: items/loaded are only ever written on
// success — the loaded gate is what keeps an OPEN cell from ever
// flashing over a sold slot.
//
// `failed` reports the latest attempt: set on every failure, cleared by
// the next success, never reset by the retry itself — the cadence has no
// terminal state, so it is the consumer's cue to stop showing a loading
// placeholder (the panel swaps its skeleton for a quiet FEED OFFLINE row)
// rather than pulse through the 30s waits. Before any attempt settles it
// is false, which together with loaded=false means "first fetch in flight".

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { RailItem } from '@/lib/billboard'

/** Delay before a failed rails fetch is re-attempted. */
const RETRY_DELAY_MS = 30_000

export interface RailFeed {
  items: RailItem[]
  /** True once any fetch has succeeded; items are only written then. */
  loaded: boolean
  /** True when the most recent attempt failed (a retry is pending). */
  failed: boolean
}

export function useRailFeed(enabled: boolean): RailFeed {
  const pathname = usePathname() ?? ''
  const [items, setItems] = useState<RailItem[]>([])
  // Vacant CTAs may only render once we know which slots are sold.
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  // Bumped RETRY_DELAY_MS after a failed fetch to re-run the fetch
  // effect (the ticker's retryTick, single-shot instead of an interval).
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let retryTimer = 0
    const scheduleRetry = () => {
      setFailed(true)
      retryTimer = window.setTimeout(() => setRetryNonce((n) => n + 1), RETRY_DELAY_MS)
    }
    fetch('/api/billboard/rails')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: RailItem[] } | null) => {
        if (cancelled) return
        if (!data || !Array.isArray(data.items)) {
          scheduleRetry()
          return
        }
        setItems(data.items)
        setLoaded(true)
        setFailed(false)
      })
      .catch(() => {
        // Network hiccups and invalid-JSON rejections land here alike.
        if (cancelled) return
        scheduleRetry()
      })
    return () => {
      cancelled = true
      window.clearTimeout(retryTimer)
    }
  }, [enabled, pathname, retryNonce])

  return { items, loaded, failed }
}
