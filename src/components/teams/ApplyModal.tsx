'use client'

// The TRANSFER REQUEST filing window — CursorOptInModal's arena modal
// pattern (fixed overlay, solid ink panel, pixel title, Escape/backdrop
// close) re-toned to the TEAM gold. A pilot picks a team on the
// recruitment board or a team profile, optionally attaches a pitch, and
// POST /api/team/apply files the request; the server owns every guard
// (one team per pilot, open-request cap, roster lamp) and replies with
// friendly strings we surface verbatim. When the team publishes a
// HIRING BAR, a panel above the pitch shows each threshold with the
// viewer's stamp (check / cross / dimmed UNVERIFIED) and the overall
// CLEARS BAR / BELOW BAR verdict — a soft signal only: FILE REQUEST
// never disables on it, matching the server, which never gates.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/leaderboard/Avatar'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'
import {
  formatHiringScore,
  formatHiringTokens,
  formatHiringUsd,
  hasBar,
  type BarStamp,
  type HiringBar,
  type MetricStamp
} from '@/lib/teamHiring'

const GOLD = 'var(--lb-gold)'

// Mirrors the caps in src/lib/teamApplications.ts (built in parallel —
// inlined here so this component never imports server-side code).
const MESSAGE_MAX = 280

export interface ApplyModalTeam {
  userId: number
  username: string
  name: string
  avatar: string | null
}

/* ================= hiring bar (apply GET target decoration) ================= */

/** The apply GET target's hiring decoration: the team's published bar
 *  and, when the viewer's facts resolved server-side, their per-metric
 *  stamps. The server omits `stamp` for empty bars and failed facts
 *  reads, so it rides as null here. */
export interface HiringSignal {
  bar: HiringBar
  stamp: BarStamp | null
}

const METRIC_STAMPS = ['met', 'missed', 'unverified'] as const
const OVERALL_VERDICTS = ['clears', 'below', 'partial', 'no-bar'] as const

const parseThreshold = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

const parseMetricStamp = (value: unknown): MetricStamp | null =>
  typeof value === 'string' && (METRIC_STAMPS as readonly string[]).includes(value)
    ? (value as MetricStamp)
    : null

/** Defensive read of `target.bar` / `target.stamp` off the apply GET —
 *  shared with ApplyToTeamButton so both surfaces parse (and therefore
 *  render) the same signal. Malformed or empty bars read as null. */
export function parseHiringSignal(target: unknown): HiringSignal | null {
  if (typeof target !== 'object' || target === null) return null
  const fields = target as Record<string, unknown>
  if (typeof fields.bar !== 'object' || fields.bar === null) return null
  const rawBar = fields.bar as Record<string, unknown>
  const bar: HiringBar = {
    minScore: parseThreshold(rawBar.minScore),
    minTokens: parseThreshold(rawBar.minTokens),
    minBurnUsd: parseThreshold(rawBar.minBurnUsd)
  }
  if (!hasBar(bar)) return null

  let stamp: BarStamp | null = null
  if (typeof fields.stamp === 'object' && fields.stamp !== null) {
    const rawStamp = fields.stamp as Record<string, unknown>
    const overall = rawStamp.overall
    if (
      typeof overall === 'string' &&
      (OVERALL_VERDICTS as readonly string[]).includes(overall)
    ) {
      stamp = {
        score: parseMetricStamp(rawStamp.score),
        tokens: parseMetricStamp(rawStamp.tokens),
        burnUsd: parseMetricStamp(rawStamp.burnUsd),
        overall: overall as BarStamp['overall']
      }
    }
  }
  return { bar, stamp }
}

function StampMark({ stamp }: { stamp: MetricStamp | null }) {
  if (stamp === null) return null
  switch (stamp) {
    case 'met':
      return (
        <span aria-label="met" style={{ color: `rgb(${GOLD})` }}>
          ✓
        </span>
      )
    case 'missed':
      return (
        <span aria-label="missed" className="text-rose-300/80">
          ✕
        </span>
      )
    case 'unverified':
      return (
        <span className="text-[8px] tracking-[0.18em] text-zinc-600">UNVERIFIED</span>
      )
    default: {
      const exhaustive: never = stamp
      return exhaustive
    }
  }
}

function OverallPlate({ overall }: { overall: BarStamp['overall'] }) {
  const plate = 'rounded border px-1.5 py-0.5 text-[8px] tracking-[0.2em]'
  switch (overall) {
    case 'clears':
      return (
        <span
          className={plate}
          style={{
            color: `rgb(${GOLD})`,
            borderColor: `rgb(${GOLD} / 0.4)`,
            background: `rgb(${GOLD} / 0.06)`
          }}
        >
          CLEARS BAR
        </span>
      )
    case 'below':
      return (
        <span className={`${plate} border-rose-400/30 text-rose-300/80`}>BELOW BAR</span>
      )
    case 'partial':
      return <span className={`${plate} border-zinc-800 text-zinc-500`}>UNVERIFIED</span>
    case 'no-bar':
      // Unreachable — the panel only renders behind hasBar — but the
      // union says it exists, so the arm does too.
      return null
    default: {
      const exhaustive: never = overall
      return exhaustive
    }
  }
}

function BarMetricRow({
  label,
  amount,
  stamp
}: {
  label: string
  amount: string
  stamp: MetricStamp | null
}) {
  return (
    <li className="flex items-center justify-between gap-2 text-[9px] tracking-[0.18em]">
      <span className="text-zinc-500">{label}</span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums text-zinc-300">{amount}</span>
        <StampMark stamp={stamp} />
      </span>
    </li>
  )
}

function HiringBarPanel({ signal }: { signal: HiringSignal }) {
  const { bar, stamp } = signal
  const unverified = stamp?.tokens === 'unverified' || stamp?.burnUsd === 'unverified'
  return (
    <div
      className="mt-4 border px-3.5 py-3 text-left"
      style={{ borderColor: `rgb(${GOLD} / 0.16)`, background: 'rgb(255 255 255 / 0.02)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[8px] tracking-[0.3em] text-zinc-600">HIRING BAR</span>
        {stamp && <OverallPlate overall={stamp.overall} />}
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {bar.minScore !== null && (
          <BarMetricRow
            label="GLOBAL SCORE"
            amount={formatHiringScore(bar.minScore)}
            stamp={stamp?.score ?? null}
          />
        )}
        {bar.minTokens !== null && (
          <BarMetricRow
            label="TOKENS BURNED"
            amount={formatHiringTokens(bar.minTokens)}
            stamp={stamp?.tokens ?? null}
          />
        )}
        {bar.minBurnUsd !== null && (
          <BarMetricRow
            label="USD BURNED"
            amount={formatHiringUsd(bar.minBurnUsd)}
            stamp={stamp?.burnUsd ?? null}
          />
        )}
      </ul>
      {unverified && (
        <p className="mt-2 text-[8px] leading-4 tracking-[0.12em] text-zinc-600">
          OPT INTO THE BURN BOARD TO VERIFY YOUR BURN
        </p>
      )}
    </div>
  )
}

export function ApplyModal({
  team,
  hiring,
  onClose,
  onApplied
}: {
  team: ApplyModalTeam
  /** The team's hiring bar + viewer stamp. undefined = unknown (the
   *  modal probes GET /api/team/apply?teamUserId itself); null = the
   *  caller already knows there is no bar, so the probe is skipped. */
  hiring?: HiringSignal | null
  onClose: () => void
  /** Fires once the request lands so the caller can flip its row state. */
  onApplied: (applicationId: number) => void
}) {
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [hiringSignal, setHiringSignal] = useState<HiringSignal | null>(hiring ?? null)
  const pendingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Self-probe for callers that only know the bar exists (the directory
  // payload carries bars but never viewer stamps). Display-only: any
  // failure just means the pitch window opens without the bar panel.
  useEffect(() => {
    if (hiring !== undefined) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/team/apply?teamUserId=${team.userId}`, {
          cache: 'no-store',
          credentials: 'include'
        })
        if (cancelled || !res.ok) return
        const data = await res.json().catch(() => null)
        if (cancelled || !data?.success) return
        setHiringSignal(parseHiringSignal(data.target))
      } catch {
        // Soft signal — stay silent.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hiring, team.userId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = useCallback(async () => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      const pitch = message.trim().slice(0, MESSAGE_MAX)
      const res = await fetch('/api/team/apply', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamUserId: team.userId,
          ...(pitch ? { message: pitch } : {})
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        toast({
          kind: 'error',
          title: 'REQUEST REFUSED',
          body:
            typeof data?.error === 'string'
              ? data.error
              : 'Could not file the transfer request. Try again in a moment.'
        })
        return
      }
      toast({
        kind: 'success',
        title: 'REQUEST FILED',
        body: `Your transfer request is in @${team.username}'s inbox.`
      })
      requestNotificationsRefresh()
      onApplied(Number(data.applicationId) || 0)
    } catch {
      toast({
        kind: 'error',
        title: 'REQUEST REFUSED',
        body: 'Network hiccup — try again.'
      })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [message, onApplied, team.userId, team.username])

  return (
    <div
      className="tra-root fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`File a transfer request to ${team.name}`}
    >
      <div className="tra-backdrop absolute inset-0" onClick={onClose} aria-hidden />

      <div
        className="tra-panel relative w-full max-w-[420px] overflow-hidden bg-[rgb(12_12_14)] px-6 py-7 text-center"
        style={{
          border: `1px solid rgb(${GOLD} / 0.3)`,
          boxShadow: `0 0 60px rgb(${GOLD} / 0.1)`
        }}
      >
        <div aria-hidden className="tra-ember pointer-events-none absolute inset-x-0 top-0 h-px" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center text-zinc-600 transition-colors hover:text-zinc-200"
        >
          ✕
        </button>

        <div className="flex justify-center">
          <TeamBadge size={22} />
        </div>
        <h2
          className="mt-3 text-[12px] tracking-[0.3em] [font-family:var(--font-pixel)]"
          style={{ color: `rgb(${GOLD})`, textShadow: `0 0 14px rgb(${GOLD} / 0.4)` }}
        >
          TRANSFER REQUEST
        </h2>

        {/* team identity — the square company mark */}
        <div className="mt-4 flex items-center justify-center gap-3">
          <Avatar
            src={team.avatar}
            char={team.username[0]?.toUpperCase() ?? '?'}
            imgClassName="h-10 w-10 shrink-0 rounded-md border border-zinc-800 object-cover"
            fallbackClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 font-display text-[12px] text-yellow-300"
          />
          <div className="min-w-0 text-left">
            <div className="truncate font-display text-[13px] font-medium text-zinc-100">
              {team.name}
            </div>
            <div className="truncate text-[10px] text-zinc-600">@{team.username}</div>
          </div>
        </div>

        {hiringSignal && <HiringBarPanel signal={hiringSignal} />}

        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={MESSAGE_MAX}
            rows={4}
            disabled={pending}
            placeholder="your pitch to the squad (optional)"
            className="w-full resize-none border bg-black/40 p-3 font-data text-[12px] leading-5 text-zinc-100 placeholder:text-zinc-700 focus:outline-none"
            style={{ borderColor: `rgb(${GOLD} / 0.2)` }}
          />
          <div className="mt-1 flex items-center justify-between text-[9px] tracking-[0.14em] text-zinc-700">
            <span>ONE TEAM PER PILOT — 3 OPEN REQUESTS MAX</span>
            <span className="tabular-nums">
              {message.length}/{MESSAGE_MAX}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="border border-zinc-800 px-3 py-3 text-[10px] tracking-[0.3em] text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-60"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-3 py-3 text-[10px] tracking-[0.3em] transition-colors disabled:cursor-wait disabled:opacity-60"
              style={{
                color: `rgb(${GOLD})`,
                border: `1px solid rgb(${GOLD} / 0.4)`,
                background: `rgb(${GOLD} / 0.08)`
              }}
            >
              {pending ? 'FILING…' : 'FILE REQUEST'}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .tra-backdrop {
          background: rgb(0 0 0 / 0.6);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: tra-fade-in 220ms ease backwards;
        }
        .tra-panel {
          animation: tra-pop-in 340ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        .tra-ember {
          background: linear-gradient(
            90deg,
            transparent,
            rgb(255 214 68 / 0.8),
            transparent
          );
          animation: tra-ember-sweep 2.6s ease-in-out infinite;
        }
        @keyframes tra-fade-in {
          from {
            opacity: 0;
          }
        }
        @keyframes tra-pop-in {
          from {
            opacity: 0;
            transform: translateY(14px) scale(0.97);
          }
        }
        @keyframes tra-ember-sweep {
          0%,
          100% {
            transform: translateX(-35%);
            opacity: 0.5;
          }
          50% {
            transform: translateX(35%);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tra-backdrop,
          .tra-panel,
          .tra-ember {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
