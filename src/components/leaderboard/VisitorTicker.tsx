'use client'

// Arena visitor pulse — Cribble-style stand-in for the outbid.lol live
// chip. Sits under the LEADERBOARD wordmark, reads the first-party
// pulse through /api/analytics/visitors (hashes only, never IPs).
// The pill opens the public GoatCounter dashboard.

import { useCallback, useEffect, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import { IconGoatCounter } from '@/components/analytics/IconGoatCounter'
import { formatNumber } from '@/components/dashboard-v2/format'
import { goatcounterStatsUrl } from '@/lib/goatcounterPublic'

const POLL_MS = 30_000
const STATS_URL = goatcounterStatsUrl()

type Pulse = { live: number; last12h: number }

function Sep() {
  return (
    <span className="text-zinc-700" aria-hidden>
      ·
    </span>
  )
}

function Count({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="tabular-nums text-zinc-600" aria-hidden>
        —
      </span>
    )
  }
  return (
    <AnimatedCounter
      value={value}
      duration={900}
      formatter={(n) => formatNumber(Math.round(n))}
      className="tabular-nums"
    />
  )
}

export function VisitorTicker() {
  const [pulse, setPulse] = useState<Pulse | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics/visitors', { cache: 'no-store' })
      if (!res.ok) return
      const data: unknown = await res.json()
      if (!data || typeof data !== 'object') return
      const rec = data as Record<string, unknown>
      if (rec.success !== true) return
      if (typeof rec.live !== 'number' || typeof rec.last12h !== 'number') return
      setPulse({ live: rec.live, last12h: rec.last12h })
    } catch {
      // Keep the last good pulse (or the dash placeholders) on a blip.
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      if (!document.hidden) void load()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const live = pulse?.live ?? null
  const last12h = pulse?.last12h ?? null
  const countsLabel =
    live === null || last12h === null
      ? 'Visitor counts loading'
      : `${formatNumber(live)} visitors online, ${formatNumber(last12h)} in the last 12 hours`

  return (
    <div className="mt-5 flex justify-center px-1">
      <a
        href={STATS_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${countsLabel}. Open Cribble stats on GoatCounter`}
        className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-[rgb(var(--lb-panel-edge)/0.1)] bg-[rgb(var(--lb-panel-edge)/0.04)] px-3 py-1.5 font-data text-[10px] tracking-[0.08em] text-zinc-500 transition-colors hover:border-[rgb(var(--lb-panel-edge)/0.2)] hover:bg-[rgb(var(--lb-panel-edge)/0.07)] sm:gap-x-2.5 sm:px-3.5 sm:tracking-[0.12em]"
      >
        <IconGoatCounter size={13} className="shrink-0" />
        <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-[rgb(var(--lb-up))]">
          <span className="lb4-live-dot h-1.5 w-1.5 shrink-0 rounded-full" />
          <Count value={live} />
          <span>
            <span className="sm:hidden"> online</span>
            <span className="hidden sm:inline"> visitors online</span>
          </span>
        </span>
        <Sep />
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Count value={last12h} />
          <span>
            <span className="sm:hidden"> / 12h</span>
            <span className="hidden sm:inline"> in the last 12 hours</span>
          </span>
        </span>
        <Sep />
        <span className="shrink-0 text-zinc-200">
          <span className="sm:hidden">stats →</span>
          <span className="hidden sm:inline">see stats →</span>
        </span>
      </a>
    </div>
  )
}
