'use client'

// The adaptive gate for /teams. One probe of GET /api/team/dashboard
// decides the whole page: a TEAM-tier account gets its command deck;
// only "not yours to see" answers (401 signed out, 403 not a team) fall
// through to the public Team-plan buy page. (The recruitment board
// moved off this route — hiring now lives on the TEAMS leaderboard's
// HIRING tab.) Any other failure — 500, network, a mangled payload —
// gets a quiet error screen with a RETRY: showing a team owner the
// public buy page would just pitch a plan they already own. Same gate
// pattern as the /team console — a quiet skeleton while the probe is in
// flight, never a flash of the wrong surface.

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseTeamDashboard, TeamDashboard, type TeamDashboardData } from './TeamDashboard'
import { TeamsLanding } from './TeamsLanding'

type Gate =
  | { id: 'loading' }
  | { id: 'dashboard'; data: TeamDashboardData }
  | { id: 'directory' }
  | { id: 'error' }

export function TeamsHub() {
  const [gate, setGate] = useState<Gate>({ id: 'loading' })
  const probeSeq = useRef(0)

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
        setGate({ id: 'directory' })
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
      setGate({ id: 'error' })
    } catch {
      if (seq === probeSeq.current) setGate({ id: 'error' })
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
        <div className="command-deck page-zoom-out mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-6">
          <div className="deck-mast">
            <div className="deck-skel h-10 w-56" />
            <div className="deck-skel h-3 w-64" />
          </div>
          <div className="deck-shell mt-3">
            <div className="deck-cell h-16" />
            <div className="deck-kpi-row">
              <div className="deck-kpi h-20" />
              <div className="deck-kpi h-20" />
              <div className="deck-kpi h-20" />
              <div className="deck-kpi h-20" />
            </div>
            <div className="deck-cell h-64" />
          </div>
        </div>
      )
    case 'dashboard':
      return <TeamDashboard initial={gate.data} />
    case 'error':
      return (
        <div className="command-deck page-zoom-out mx-auto flex max-w-4xl flex-col items-center gap-4 px-4 pb-16 pt-24 text-center sm:px-6">
          <span className="deck-mute font-data text-[11px] font-semibold tracking-[0.24em]">
            [ THE TEAMS SECTOR FAILED TO ANSWER ]
          </span>
          <button
            type="button"
            onClick={() => void probe()}
            className="deck-btn deck-btn-quiet deck-btn-hard"
          >
            RETRY
          </button>
        </div>
      )
    case 'directory':
      return <TeamsLanding />
    default: {
      const exhaustive: never = gate
      return exhaustive
    }
  }
}
