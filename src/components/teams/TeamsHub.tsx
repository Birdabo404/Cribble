'use client'

// The adaptive gate for /teams. One probe of GET /api/team/dashboard
// decides the whole page: a TEAM-tier account gets its command deck;
// only "not yours to see" answers (401 signed out, 403 not a team) fall
// through to the public Team-plan buy page. (The recruitment board
// moved off this route — hiring now lives on the TEAMS leaderboard's
// HIRING tab.) Any other failure — 500, network, a mangled payload —
// gets a quiet error screen with a RETRY: showing a team owner the
// public buy page would just pitch a plan they already own. A 429 honours
// Retry-After — RETRY sits out the countdown so hammering it can't extend
// the limit. Same gate pattern as the /team console — a quiet skeleton
// while the probe is in flight, never a flash of the wrong surface.

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseTeamDashboard, TeamDashboard, type TeamDashboardData } from './TeamDashboard'
import { TeamsLanding } from './TeamsLanding'

type Gate =
  | { id: 'loading' }
  | { id: 'dashboard'; data: TeamDashboardData }
  | { id: 'landing' }
  /** `retryUntil` is an absolute epoch-ms deadline from Retry-After on a
   *  429, null for every other failure. Absolute, not "seconds left", so
   *  two back-to-back 429s with the same header still restart the clock. */
  | { id: 'error'; retryUntil: number | null }

// Retry-After is integer seconds or an HTTP-date. Returns an absolute
// deadline; 30s out when the header is missing or unreadable.
function retryDeadline(res: Response): number {
  const raw = res.headers.get('retry-after')?.trim()
  const now = Date.now()
  if (!raw) return now + 30_000
  if (/^\d+$/.test(raw)) return now + Number(raw) * 1000
  const at = Date.parse(raw)
  return Number.isNaN(at) ? now + 30_000 : Math.max(now, at)
}

function secondsUntil(deadline: number | null): number {
  return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
}

// Whole seconds left until `deadline`, 0 when idle or elapsed. Re-derived
// from the clock on every tick rather than decremented, so a tab that was
// backgrounded (throttled timers) still reads true when it comes back.
function useCountdown(deadline: number | null): number {
  const [state, setState] = useState(() => ({ deadline, left: secondsUntil(deadline) }))
  // Resync during render on a new deadline — no frame of a stale count.
  if (state.deadline !== deadline) setState({ deadline, left: secondsUntil(deadline) })
  useEffect(() => {
    if (deadline === null || deadline <= Date.now()) return
    const timer = setInterval(() => {
      const left = secondsUntil(deadline)
      setState({ deadline, left })
      if (left === 0) clearInterval(timer)
    }, 500)
    return () => clearInterval(timer)
  }, [deadline])
  return state.deadline === deadline ? state.left : secondsUntil(deadline)
}

export function TeamsHub() {
  const [gate, setGate] = useState<Gate>({ id: 'loading' })
  const probeSeq = useRef(0)
  const retryIn = useCountdown(gate.id === 'error' ? gate.retryUntil : null)

  const probe = useCallback(async () => {
    const seq = ++probeSeq.current
    setGate({ id: 'loading' })
    try {
      const res = await fetch('/api/team/dashboard', {
        cache: 'no-store',
        credentials: 'include'
      })
      if (seq !== probeSeq.current) return
      if (res.status === 401 || res.status === 403) {
        setGate({ id: 'landing' })
        return
      }
      if (res.status === 429) {
        setGate({ id: 'error', retryUntil: retryDeadline(res) })
        return
      }
      if (res.ok) {
        const payload = await res.json().catch(() => null)
        if (seq !== probeSeq.current) return
        const data = payload?.success ? parseTeamDashboard(payload) : null
        if (data) {
          setGate({ id: 'dashboard', data })
          return
        }
      }
      setGate({ id: 'error', retryUntil: null })
    } catch {
      if (seq === probeSeq.current) setGate({ id: 'error', retryUntil: null })
    }
  }, [])

  useEffect(() => {
    void probe()
    return () => {
      // Retire in-flight probes on unmount.
      probeSeq.current += 1
    }
  }, [probe])

  switch (gate.id) {
    case 'loading':
      return (
        <div
          role="status"
          className="command-deck page-zoom-out mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-6"
          aria-busy="true"
          aria-label="Loading the team deck"
        >
          <div className="deck-mast">
            <div>
              <div className="deck-skel h-10 w-56" />
              <div className="deck-skel mt-3 h-3 w-40" />
            </div>
            <div className="deck-skel h-14 w-64" />
          </div>
          <span aria-hidden className="deck-rule deck-rule-gold" />
          <div className="deck-shell">
            <div className="deck-kpi-row">
              <div className="deck-kpi h-[5.5rem]" />
              <div className="deck-kpi h-[5.5rem]" />
              <div className="deck-kpi h-[5.5rem]" />
              <div className="deck-kpi h-[5.5rem]" />
            </div>
            <div className="deck-cell h-14" />
            <div className="deck-body deck-body-split">
              <div className="deck-cell h-[30rem]" />
              <div className="deck-cell h-[30rem]" />
            </div>
            <div className="deck-cell h-9" />
          </div>
        </div>
      )
    case 'dashboard':
      return <TeamDashboard initial={gate.data} />
    case 'error': {
      const message =
        gate.retryUntil === null
          ? '[ THE TEAMS SECTOR FAILED TO ANSWER ]'
          : retryIn > 0
            ? `[ RATE LIMITED — RETRY IN ${retryIn}S ]`
            : '[ RATE LIMIT LIFTED — RETRY ]'
      return (
        <div
          role="alert"
          className="command-deck page-zoom-out mx-auto flex max-w-4xl flex-col items-center gap-4 px-4 pb-16 pt-24 text-center sm:px-6"
        >
          <span className="deck-mute font-data text-[11px] font-semibold tracking-[0.24em]">
            {message}
          </span>
          <button
            type="button"
            onClick={() => void probe()}
            disabled={retryIn > 0}
            className="deck-btn deck-btn-quiet deck-btn-hard disabled:cursor-not-allowed disabled:opacity-40"
          >
            RETRY
          </button>
        </div>
      )
    }
    case 'landing':
      return <TeamsLanding />
    default: {
      const exhaustive: never = gate
      return exhaustive
    }
  }
}
