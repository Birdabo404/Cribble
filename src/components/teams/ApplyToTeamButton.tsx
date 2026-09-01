'use client'

// The transfer-request affordance on a team's public profile. One probe
// of GET /api/team/apply?teamUserId=N maps the viewer's relationship to
// this team onto a single control: APPLY (opens the TRANSFER REQUEST
// modal), REQUESTED (two-click withdraw), INVITED — RESPOND (deep link
// to /team/invites), a SIGNED tag for members, dim ROSTER CLOSED / FULL
// plates, or nothing at all (signed out, the team itself, a pilot who
// already flies other colors, or a team that isn't live). The same
// probe carries the team's HIRING BAR and the viewer's stamp, rendered
// as a compact verdict chip beside APPLY (CLEARS BAR / BELOW BAR /
// BAR UNVERIFIED) with the full per-metric breakdown in the modal —
// soft signal only, APPLY never disables on it.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from '@/components/Toaster'
import { hiringBarChips, type BarStamp, type HiringBar } from '@/lib/teamHiring'
import { ApplyModal, parseHiringSignal, type HiringSignal } from './ApplyModal'

const GOLD = 'var(--lb-gold)'

const TARGET_STATES = [
  'can-apply',
  'applied',
  'invited',
  'member',
  'has-team',
  'roster-closed',
  'roster-full',
  'own-team',
  'team-account',
  'not-live'
] as const

type TargetState = (typeof TARGET_STATES)[number]

const isTargetState = (value: unknown): value is TargetState =>
  typeof value === 'string' && (TARGET_STATES as readonly string[]).includes(value)

type View =
  | { id: 'loading' }
  | { id: 'hidden' }
  | { id: 'can-apply' }
  | { id: 'applied'; applicationId: number }
  | { id: 'invited' }
  | { id: 'member' }
  | { id: 'roster-closed' }
  | { id: 'roster-full' }

function viewForTarget(state: TargetState, applicationId: number): View {
  switch (state) {
    case 'can-apply':
      return { id: 'can-apply' }
    case 'applied':
      return applicationId > 0 ? { id: 'applied', applicationId } : { id: 'hidden' }
    case 'invited':
      return { id: 'invited' }
    case 'member':
      return { id: 'member' }
    case 'roster-closed':
      return { id: 'roster-closed' }
    case 'roster-full':
      return { id: 'roster-full' }
    case 'has-team':
    case 'own-team':
    case 'team-account':
    case 'not-live':
      return { id: 'hidden' }
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

const CHIP =
  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[9px] tracking-[0.25em]'

const goldStyle = {
  color: `rgb(${GOLD})`,
  borderColor: `rgb(${GOLD} / 0.45)`,
  background: `rgb(${GOLD} / 0.07)`
} as const

/** The one-word verdict beside APPLY; the title spells out the bar so
 *  the chip stays compact in the profile header. */
function BarVerdictChip({ bar, stamp }: { bar: HiringBar; stamp: BarStamp }) {
  const title = `HIRING BAR — ${hiringBarChips(bar).join(' · ')}`
  switch (stamp.overall) {
    case 'clears':
      return (
        <span
          className={CHIP}
          title={title}
          style={{ color: `rgb(${GOLD})`, borderColor: `rgb(${GOLD} / 0.3)` }}
        >
          CLEARS BAR
        </span>
      )
    case 'below':
      return (
        <span className={`${CHIP} border-rose-400/25 text-rose-300/70`} title={title}>
          BELOW BAR
        </span>
      )
    case 'partial':
      return (
        <span className={`${CHIP} border-zinc-800 text-zinc-500`} title={title}>
          BAR UNVERIFIED
        </span>
      )
    case 'no-bar':
      // Unreachable — parseHiringSignal drops empty bars — but the
      // union says it exists, so the arm does too.
      return null
    default: {
      const exhaustive: never = stamp.overall
      return exhaustive
    }
  }
}

export function ApplyToTeamButton({
  teamUserId,
  teamUsername,
  teamName,
  teamAvatar
}: {
  teamUserId: number
  teamUsername: string
  teamName: string
  teamAvatar: string | null
}) {
  const [view, setView] = useState<View>({ id: 'loading' })
  const [hiring, setHiring] = useState<HiringSignal | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/team/apply?teamUserId=${teamUserId}`, {
          cache: 'no-store',
          credentials: 'include'
        })
        if (cancelled) return
        if (!res.ok) {
          setView({ id: 'hidden' })
          return
        }
        const data = await res.json().catch(() => null)
        if (cancelled) return
        const state: unknown = data?.success ? data?.target?.state : null
        if (!isTargetState(state)) {
          setView({ id: 'hidden' })
          return
        }
        setHiring(parseHiringSignal(data?.target))
        setView(viewForTarget(state, Number(data?.target?.applicationId) || 0))
      } catch {
        if (!cancelled) setView({ id: 'hidden' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [teamUserId])

  const withdraw = async (applicationId: number) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/team/apply?applicationId=${applicationId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        // 404 = the row is already gone (withdrawn in another tab, or
        // the team passed) — quietly fall back to APPLY instead of
        // stranding the REQUESTED chip.
        if (res.status === 404) {
          setView({ id: 'can-apply' })
          return
        }
        toast({
          kind: 'error',
          title: 'COULD NOT WITHDRAW',
          body: typeof data?.error === 'string' ? data.error : 'Try again in a moment.'
        })
        return
      }
      toast({
        kind: 'success',
        title: 'REQUEST WITHDRAWN',
        body: `Your transfer request to @${teamUsername} was pulled.`
      })
      setView({ id: 'can-apply' })
    } catch {
      toast({ kind: 'error', title: 'COULD NOT WITHDRAW', body: 'Try again in a moment.' })
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }

  switch (view.id) {
    case 'loading':
    case 'hidden':
      return null
    case 'can-apply':
      return (
        <>
          <span className="inline-flex flex-wrap items-center gap-2">
            {hiring?.stamp && <BarVerdictChip bar={hiring.bar} stamp={hiring.stamp} />}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className={`${CHIP} transition-colors hover:brightness-125`}
              style={goldStyle}
              aria-label={`Apply to join ${teamName}`}
            >
              APPLY
            </button>
          </span>
          {modalOpen && (
            <ApplyModal
              team={{
                userId: teamUserId,
                username: teamUsername,
                name: teamName,
                avatar: teamAvatar
              }}
              hiring={hiring}
              onClose={() => setModalOpen(false)}
              onApplied={(applicationId) => {
                setModalOpen(false)
                setView(
                  applicationId > 0 ? { id: 'applied', applicationId } : { id: 'hidden' }
                )
              }}
            />
          )}
        </>
      )
    case 'applied':
      return (
        <button
          type="button"
          disabled={busy}
          onClick={armed ? () => void withdraw(view.applicationId) : () => setArmed(true)}
          title={armed ? undefined : 'Withdraw this transfer request'}
          className={`${CHIP} transition-colors disabled:cursor-wait disabled:opacity-60 ${
            armed
              ? 'border-rose-400/60 bg-rose-500/15 text-rose-200'
              : 'border-zinc-800 text-zinc-400 hover:border-rose-400/40 hover:text-rose-300'
          }`}
        >
          {busy ? '…' : armed ? 'WITHDRAW?' : 'REQUESTED'}
        </button>
      )
    case 'invited':
      return (
        <Link href="/team/invites" className={`${CHIP} transition-colors hover:brightness-125`} style={goldStyle}>
          INVITED — RESPOND
        </Link>
      )
    case 'member':
      return (
        <span className={CHIP} style={goldStyle}>
          SIGNED
        </span>
      )
    case 'roster-closed':
      return <span className={`${CHIP} border-zinc-800 text-zinc-600`}>ROSTER CLOSED</span>
    case 'roster-full':
      return <span className={`${CHIP} border-zinc-800 text-zinc-600`}>ROSTER FULL</span>
    default: {
      const exhaustive: never = view
      return exhaustive
    }
  }
}
