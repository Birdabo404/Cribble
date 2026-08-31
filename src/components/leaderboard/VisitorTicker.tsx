'use client'

// Inline arena stats. The compact ticker/search-bar chip grows down and
// lifts forward in place — no modal, no portal. Any page interaction
// (outside pointer, Escape) plays the reverse collapse. Live pulse from
// /api/analytics/visitors; path counts from /api/analytics/tracker.

import { useCallback, useEffect, useRef, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import { IconGoatCounter } from '@/components/analytics/IconGoatCounter'
import { formatNumber } from '@/components/dashboard-v2/format'
import { goatcounterStatsUrl } from '@/lib/goatcounterPublic'
import { parseTrackerApiSnapshot, type TrackerStats } from '@/lib/goatcounterStats'
import {
  isArenaStatsShellAnimationEnd,
  nextArenaStatsPhase,
  parseVisitorPulseJson,
  type ArenaStatsPhase,
  type VisitorPulse
} from '@/lib/visitorPulse'

const POLL_MS = 30_000
const STATS_URL = goatcounterStatsUrl()

type Tracker = Pick<TrackerStats, 'periodVisits' | 'pages'>

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
  const [pulse, setPulse] = useState<VisitorPulse | null>(null)
  const [tracker, setTracker] = useState<Tracker | null>(null)
  const [trackerError, setTrackerError] = useState(false)
  const [phase, setPhase] = useState<ArenaStatsPhase>('closed')
  const shellRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const open = phase !== 'closed'

  const dismiss = useCallback(() => {
    setPhase((p) => nextArenaStatsPhase(p, 'dismiss'))
  }, [])

  const openStats = useCallback(() => {
    setPhase((p) => nextArenaStatsPhase(p, 'open'))
  }, [])

  const loadPulse = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics/visitors', { cache: 'no-store' })
      const data: unknown = await res.json().catch(() => null)
      const next = parseVisitorPulseJson(data)
      if (next) setPulse(next)
    } catch {
      // Keep the last good pulse (or the dash placeholders) on a blip.
    }
  }, [])

  const loadTracker = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics/tracker', { cache: 'no-store' })
      const data: unknown = await res.json().catch(() => null)
      const snapshot = res.ok ? parseTrackerApiSnapshot(data) : null
      if (!snapshot) {
        setTracker(null)
        setTrackerError(true)
        return
      }
      setTrackerError(false)
      setTracker({ periodVisits: snapshot.periodVisits, pages: snapshot.pages })
    } catch {
      setTracker(null)
      setTrackerError(true)
    }
  }, [])

  useEffect(() => {
    void loadPulse()
    const id = setInterval(() => {
      if (!document.hidden) void loadPulse()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadPulse()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadPulse])

  useEffect(() => {
    if (phase !== 'open') return
    void loadTracker()
    const id = setInterval(() => {
      if (!document.hidden) void loadTracker()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [phase, loadTracker])

  useEffect(() => {
    if (phase !== 'closing') return
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduced) return
    setPhase((p) => nextArenaStatsPhase(p, 'settled'))
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [phase])

  useEffect(() => {
    if (phase !== 'open') return
    const onPointer = (e: PointerEvent) => {
      const el = shellRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      dismiss()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    const onScroll = () => dismiss()
    document.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [phase, dismiss])

  const live = pulse?.live ?? null
  const last12h = pulse?.last12h ?? null
  const countsLabel =
    live === null || last12h === null
      ? 'Visitor counts loading'
      : `${formatNumber(live)} visitors online, ${formatNumber(last12h)} in the last 12 hours`

  return (
    <div className="mt-5 flex justify-center px-1">
      <div
        ref={shellRef}
        className={`arena-stats-shell w-full max-w-md ${
          phase === 'closed' ? 'rounded-full' : 'rounded-2xl'
        }`}
        data-phase={phase}
        onAnimationEnd={(e) => {
          if (!isArenaStatsShellAnimationEnd(e)) return
          setPhase((p) => nextArenaStatsPhase(p, 'settled'))
          if (phase === 'closing') requestAnimationFrame(() => triggerRef.current?.focus())
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (phase === 'open' ? dismiss() : openStats())}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="lb-arena-stats"
          aria-label={`${countsLabel}. ${open ? 'Close' : 'Open'} arena stats`}
          className="flex w-full max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 py-1.5 font-data text-[10px] tracking-[0.08em] text-zinc-500 sm:gap-x-2.5 sm:px-3.5 sm:tracking-[0.12em]"
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
            <span className="sm:hidden">{open ? 'close' : 'stats →'}</span>
            <span className="hidden sm:inline">{open ? 'close' : 'see stats →'}</span>
          </span>
        </button>

        {open && (
          <div
            id="lb-arena-stats"
            role="region"
            aria-labelledby="lb-stats-title"
            className="border-t border-white/[0.08] px-4 pb-4 pt-3 font-mono"
          >
            <div className="mb-3 flex items-center gap-2.5">
              <IconGoatCounter size={14} className="shrink-0" />
              <span id="lb-stats-title" className="text-[10px] tracking-[0.4em] text-zinc-300">
                ARENA STATS
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                <div className="text-[9px] tracking-[0.3em] text-zinc-500">ONLINE</div>
                <div className="mt-1 font-data text-lg tabular-nums text-[rgb(var(--lb-up))]">
                  <Count value={live} />
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                <div className="text-[9px] tracking-[0.3em] text-zinc-500">LAST 12H</div>
                <div className="mt-1 font-data text-lg tabular-nums text-zinc-200">
                  <Count value={last12h} />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] tracking-[0.3em] text-zinc-500">TRACKER · THIS WEEK</span>
                <span className="font-data text-[10px] tabular-nums text-zinc-400">
                  {tracker ? (
                    <>
                      <Count value={tracker.periodVisits} /> visits
                    </>
                  ) : trackerError ? (
                    'unavailable'
                  ) : (
                    'loading'
                  )}
                </span>
              </div>
              <ol className="mt-2 space-y-1.5">
                {(tracker?.pages ?? []).map((page) => (
                  <li
                    key={page.path}
                    className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] py-1 text-[11px]"
                  >
                    <span className="truncate text-zinc-300">{page.path}</span>
                    <span className="shrink-0 font-data tabular-nums text-zinc-400">
                      {formatNumber(page.count)}
                    </span>
                  </li>
                ))}
              </ol>
              {trackerError && (
                <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
                  Tracker snapshot failed. Counts stay closed rather than guessed.
                </p>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-3">
              <a
                href={STATS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] tracking-[0.2em] text-zinc-400 transition-colors hover:text-zinc-200"
              >
                Open tracker →
              </a>
              <button
                type="button"
                onClick={dismiss}
                className="h-8 rounded-lg border border-accent/40 bg-accent/10 px-5 text-[10px] font-bold tracking-[0.3em] text-accent transition-colors hover:bg-accent/20"
              >
                CLOSE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
