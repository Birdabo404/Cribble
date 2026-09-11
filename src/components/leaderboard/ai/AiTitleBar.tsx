'use client'

// The slab's title bar — one line of chrome in the drinks-menu register:
// a lit amber dot, the board name, `::` and `//` separators, the
// site-wide totals and the ranking window, with the freshness stamp
// pinned right. Totals count in through GSAP proxies. No lamp, no green:
// freshness is a word (UPDATED 2M AGO / STALE / OFFLINE), not a light.

import { useEffect, useReducer } from 'react'
import { formatNumber } from '@/components/dashboard-v2/format'
import {
  updatedLabel,
  type AiStatus
} from '@/components/leaderboard/ai/aiBoardState'
import { useCounter } from '@/components/leaderboard/ai/aiMotion'

export type AiTitleBarProps = {
  machines: number
  players: number
  points: number
  /** `SEASON 04` | `ALL-TIME` — see windowLabel(). */
  windowLabel: string
  generatedAt: string | null
  status: AiStatus
}

export function AiTitleBar({
  machines,
  players,
  points,
  windowLabel,
  generatedAt,
  status
}: AiTitleBarProps) {
  const machinesRef = useCounter<HTMLSpanElement>(machines, formatNumber)
  const playersRef = useCounter<HTMLSpanElement>(players, formatNumber)
  const pointsRef = useCounter<HTMLSpanElement>(points, formatNumber)

  return (
    <header className="aib-titlebar" aria-label="AI board status">
      <span className="aib-titlebar-dot" aria-hidden>
        ●
      </span>
      <p className="aib-titlebar-text">
        <span className="aib-titlebar-name">CRIBBLE AI</span>
        <span className="aib-titlebar-num-opt">
          <Sep glyph="::" />
          <span ref={machinesRef} className="aib-titlebar-num">
            {formatNumber(machines)}
          </span>{' '}
          machines
        </span>
        <span className="aib-titlebar-opt">
          <Sep glyph="//" />
          <span ref={playersRef} className="aib-titlebar-num">
            {formatNumber(players)}
          </span>{' '}
          players
          <Sep glyph="//" />
          <span ref={pointsRef} className="aib-titlebar-num">
            {formatNumber(points)}
          </span>{' '}
          pts
        </span>
        <Sep glyph="//" />
        <span className="aib-titlebar-num">{windowLabel}</span>
      </p>
      <Stamp generatedAt={generatedAt} status={status} />
    </header>
  )
}

/** Title bar for the AGENTS card — same chrome, its own figures. The
 *  burn total is the headline; the harness count folds away where the
 *  card sits in the narrow side column (see .aib-agents rules). */
export function AiAgentsTitleBar({
  harnesses,
  burnLabel
}: {
  harnesses: number
  /** Pre-formatted total burn, e.g. `$327,835`. */
  burnLabel: string
}) {
  const harnessesRef = useCounter<HTMLSpanElement>(harnesses, formatNumber)
  return (
    <header className="aib-titlebar" aria-label="Agents panel status">
      <span className="aib-titlebar-dot" aria-hidden>
        ●
      </span>
      <p className="aib-titlebar-text">
        <span className="aib-titlebar-name">AGENTS</span>
        <Sep glyph="::" />
        <span className="aib-titlebar-num">{burnLabel}</span> burned
        <span className="aib-titlebar-num-opt">
          <Sep glyph="//" />
          <span ref={harnessesRef} className="aib-titlebar-num">
            {formatNumber(harnesses)}
          </span>{' '}
          harnesses
        </span>
      </p>
      <span className="aib-titlebar-stamp" data-status="live">
        OPT-IN†
      </span>
    </header>
  )
}

function Sep({ glyph }: { glyph: string }) {
  return (
    <span className="aib-titlebar-sep" aria-hidden>
      {glyph}
    </span>
  )
}

/** Self-ticking freshness stamp so only this leaf re-renders. The board
 *  is a 5-minute server cache, so a 30s tick is plenty. STALE and
 *  OFFLINE print in amber; a healthy feed is quiet grey. */
function Stamp({ generatedAt, status }: { generatedAt: string | null; status: AiStatus }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!generatedAt) return
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [generatedAt])

  // `UPDATED JUST NOW` — the verb folds away on phones (see
  // .aib-titlebar-verb) so the window label keeps its room.
  const updated = updatedLabel(generatedAt, Date.now())
  const freshness = updated.startsWith('UPDATED ') ? (
    <>
      <span className="aib-titlebar-verb">UPDATED </span>
      {updated.slice('UPDATED '.length)}
    </>
  ) : (
    updated
  )
  const label =
    status === 'offline'
      ? 'OFFLINE'
      : status === 'sync'
        ? 'CONNECTING'
        : status === 'stale'
          ? <>STALE · {freshness}</>
          : freshness

  return (
    <span className="aib-titlebar-stamp" data-status={status} suppressHydrationWarning>
      {label}
    </span>
  )
}
