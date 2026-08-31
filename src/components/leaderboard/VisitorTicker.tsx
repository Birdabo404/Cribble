'use client'

// In-UI stats popup. The ticker chip stays on the leaderboard; "see
// stats" opens this dialog instead of a new GoatCounter tab. Live pulse
// still comes from /api/analytics/visitors. Path counts stream from
// /api/analytics/tracker (bounded GoatCounter snapshot). A single
// outbound link remains for the canonical tracker.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AnimatedCounter from '@/components/AnimatedCounter'
import { IconGoatCounter } from '@/components/analytics/IconGoatCounter'
import { formatNumber } from '@/components/dashboard-v2/format'
import { goatcounterStatsUrl } from '@/lib/goatcounterPublic'
import { parseTrackerApiSnapshot, type TrackerStats } from '@/lib/goatcounterStats'

const POLL_MS = 30_000
const STATS_URL = goatcounterStatsUrl()

type Pulse = { live: number; last12h: number }
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

function StatsPopup({
  pulse,
  tracker,
  trackerError,
  onClose
}: {
  pulse: Pulse | null
  tracker: Tracker | null
  trackerError: boolean
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const live = pulse?.live ?? null
  const last12h = pulse?.last12h ?? null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lb-stats-title"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl glass-pop"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <IconGoatCounter size={14} className="shrink-0" />
            <span id="lb-stats-title" className="text-[10px] tracking-[0.4em] text-zinc-300">
              ARENA STATS
            </span>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="text-zinc-500 transition-colors hover:text-zinc-200"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path
                fill="currentColor"
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
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

          <div>
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
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.08] px-5 py-3">
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
            onClick={onClose}
            className="h-9 rounded-lg border border-accent/40 bg-accent/10 px-6 text-[10px] font-bold tracking-[0.3em] text-accent transition-colors hover:bg-accent/20"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function VisitorTicker() {
  const [pulse, setPulse] = useState<Pulse | null>(null)
  const [tracker, setTracker] = useState<Tracker | null>(null)
  const [trackerError, setTrackerError] = useState(false)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const closeStats = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const loadPulse = useCallback(async () => {
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
    if (!open) return
    void loadTracker()
    const id = setInterval(() => {
      if (!document.hidden) void loadTracker()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [open, loadTracker])

  const live = pulse?.live ?? null
  const last12h = pulse?.last12h ?? null
  const countsLabel =
    live === null || last12h === null
      ? 'Visitor counts loading'
      : `${formatNumber(live)} visitors online, ${formatNumber(last12h)} in the last 12 hours`

  return (
    <div className="mt-5 flex justify-center px-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${countsLabel}. Open arena stats`}
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
      </button>
      {open && (
        <StatsPopup
          pulse={pulse}
          tracker={tracker}
          trackerError={trackerError}
          onClose={closeStats}
        />
      )}
    </div>
  )
}
