'use client'

// Team console — roster management for TEAM-tier (company) accounts.
// One screen: review-status banner, seat meter (pending invites hold a
// seat), invite-by-callsign console, and the roster with revoke/remove.
// The page renders for any TEAM-tier account so a just-paid company can
// see where it stands, but every mutation is disabled (and refused
// server-side) until the manual anti-impersonation review approves them.
//
// It is also the team checkout's success URL (?checkout=success&
// checkout_id=...): the bounce shows a CONFIRMING PAYMENT state instead
// of the not-team gate, POSTs /api/user/subscription/sync with the
// checkout id (the shop's deduped-ack pattern — and, since webhooks
// can't reach localhost, the call that actually grants TEAM), then loads
// the roster and scrubs the URL.

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Avatar } from '@/components/leaderboard/Avatar'
import { formatRelative } from '@/components/dashboard-v2/format'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'

const GOLD = 'var(--lb-gold)'

interface RosterMember {
  affiliationId: number
  status: 'pending' | 'active'
  invitedAt: string
  acceptedAt: string | null
  userId: number
  username: string
  name: string
  avatar: string | null
}

interface RosterData {
  reviewStatus: string | null
  approved: boolean
  seatLimit: number
  seatsUsed: number
  members: RosterMember[]
}

type Gate = 'loading' | 'confirming' | 'ok' | 'not-team' | 'signed-out' | 'error'

/* ================= chrome bits ================= */

function GoldPanel({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={{
        border: `1px solid rgb(${GOLD} / 0.24)`,
        background: `linear-gradient(180deg, rgb(${GOLD} / 0.05), transparent 55%), rgb(var(--lb-panel-bg))`,
        boxShadow: `0 24px 70px -30px rgb(${GOLD} / 0.22), 0 18px 50px -24px rgb(0 0 0 / 0.6)`
      }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 z-10 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent 4%, rgb(${GOLD} / 0.85) 50%, transparent 96%)`,
          boxShadow: `0 0 12px rgb(${GOLD} / 0.45)`
        }}
      />
      {children}
    </div>
  )
}

/** Ten-slot seat meter: filled = pending or active, lit gold. */
function SeatMeter({ used, limit }: { used: number; limit: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" role="img" aria-label={`${used} of ${limit} seats used`}>
        {Array.from({ length: limit }, (_, i) => (
          <span
            key={i}
            className="h-3 w-2 rounded-[2px]"
            style={
              i < used
                ? {
                    background: `rgb(${GOLD} / 0.85)`,
                    boxShadow: `0 0 8px rgb(${GOLD} / 0.5)`
                  }
                : { background: 'rgb(255 255 255 / 0.07)' }
            }
          />
        ))}
      </div>
      <span className="text-[11px] tabular-nums tracking-[0.2em] text-zinc-400">
        <span style={{ color: `rgb(${GOLD})` }}>{used}</span>/{limit} SEATS
      </span>
    </div>
  )
}

function ReviewBanner({ reviewStatus }: { reviewStatus: string | null }) {
  const rejected = reviewStatus === 'rejected'
  const fg = rejected ? 'rgb(var(--lb-down))' : `rgb(${GOLD})`
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3"
      style={{
        border: `1px solid ${rejected ? 'rgb(var(--lb-down) / 0.35)' : `rgb(${GOLD} / 0.3)`}`,
        background: `linear-gradient(180deg, ${
          rejected ? 'rgb(var(--lb-down) / 0.07)' : `rgb(${GOLD} / 0.06)`
        }, transparent 70%), rgb(var(--lb-panel-bg))`
      }}
    >
      <span className="text-[10px] tracking-[0.3em]" style={{ color: fg }}>
        {rejected ? 'REVIEW REJECTED' : 'UNDER REVIEW'}
      </span>
      <span className="min-w-0 flex-1 basis-52 text-[11px] leading-relaxed text-zinc-400">
        {rejected
          ? 'Your team account did not pass identity review. Contact support — invites stay locked.'
          : 'Every team is verified by hand before the gold badge and invites unlock. Reviews clear within 24 hours.'}
      </span>
    </div>
  )
}

/* ================= roster row ================= */

function RosterRow({
  member,
  approved,
  busy,
  armed,
  onArm,
  onRemove
}: {
  member: RosterMember
  approved: boolean
  busy: boolean
  armed: boolean
  onArm: () => void
  onRemove: () => void
}) {
  const active = member.status === 'active'
  const removeLabel = active ? 'REMOVE' : 'REVOKE'
  return (
    <li className="flex items-center gap-3 border-b border-white/[0.05] px-4 py-3 last:border-b-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg glass-inset-lite">
        <Avatar
          src={member.avatar}
          char={member.username[0]?.toUpperCase() ?? '?'}
          imgClassName="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center font-display text-[11px] text-zinc-300"
        />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/u/${encodeURIComponent(member.username)}`}
            className="truncate text-xs text-zinc-100 transition-colors hover:text-white hover:underline underline-offset-2"
          >
            @{member.username}
          </Link>
          <span
            className="shrink-0 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
            style={
              active
                ? {
                    color: 'rgb(var(--lb-up))',
                    borderColor: 'rgb(var(--lb-up) / 0.4)',
                    background: 'rgb(var(--lb-up) / 0.06)'
                  }
                : {
                    color: `rgb(${GOLD})`,
                    borderColor: `rgb(${GOLD} / 0.4)`,
                    background: `rgb(${GOLD} / 0.06)`
                  }
            }
          >
            {active ? 'ACTIVE' : 'PENDING'}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[10px] tracking-[0.15em] text-zinc-600">
          {active
            ? `joined ${formatRelative(member.acceptedAt)}`
            : `invited ${formatRelative(member.invitedAt)}`}
        </div>
      </div>

      {approved && (
        <button
          type="button"
          disabled={busy}
          onClick={armed ? onRemove : onArm}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-[9px] tracking-[0.3em] transition-colors disabled:cursor-wait disabled:opacity-60 ${
            armed
              ? 'border-rose-400/60 bg-rose-500/15 text-rose-200'
              : 'border-zinc-800 text-zinc-500 hover:border-rose-400/40 hover:text-rose-300'
          }`}
        >
          {busy ? 'WORKING…' : armed ? 'CONFIRM?' : removeLabel}
        </button>
      )}
    </li>
  )
}

/* ================= page ================= */

function TeamConsole() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [gate, setGate] = useState<Gate>('loading')
  const [roster, setRoster] = useState<RosterData | null>(null)

  const [callsign, setCallsign] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Two-click remove: first click arms the row, second fires. Any other
  // row click or a fresh fetch disarms.
  const [armedId, setArmedId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/team/roster', {
        cache: 'no-store',
        credentials: 'include'
      })
      if (res.status === 401) {
        setGate('signed-out')
        return
      }
      if (res.status === 403) {
        setGate('not-team')
        return
      }
      const data = await res.json()
      if (!res.ok || !data?.success) {
        setGate('error')
        return
      }
      setRoster({
        reviewStatus: data.reviewStatus ?? null,
        approved: Boolean(data.approved),
        seatLimit: Number(data.seatLimit) || 10,
        seatsUsed: Number(data.seatsUsed) || 0,
        members: Array.isArray(data.members) ? data.members : []
      })
      setArmedId(null)
      setGate('ok')
    } catch {
      setGate('error')
    }
  }, [])

  /** The checkout=success bounce: POST the sync with the checkout id
   *  (verifies the checkout against Polar, drops the deduped ack, and —
   *  the part webhooks can't do on localhost — grants TEAM), then let the
   *  roster read decide the gate. Sync failures are swallowed: a roster
   *  403 after the sync falls back to the normal not-team gate, and the
   *  webhook backstops the grant later. */
  const confirmAndLoad = useCallback(
    async (checkoutId?: string) => {
      try {
        await fetch('/api/user/subscription/sync', {
          method: 'POST',
          credentials: 'include',
          ...(checkoutId
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checkoutId })
              }
            : {})
        })
      } catch {
        // Best-effort by design — load() below decides the gate.
      }
      // The welcome + order-ack notifications land with the sync; poke the
      // bell instead of waiting on its 60s poll.
      requestNotificationsRefresh()
      await load()
    },
    [load]
  )

  // Boot: a checkout=success bounce must win this race — the guard keeps
  // the URL scrub's re-render (empty params) from firing a plain load()
  // that would 403 into the not-team gate mid-confirmation.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (searchParams.get('checkout') === 'success') {
      setGate('confirming')
      const checkoutId = searchParams.get('checkout_id')
      void confirmAndLoad(checkoutId ?? undefined)
      // Scrub so a reload or share doesn't replay the confirmation.
      router.replace('/team', { scroll: false })
      return
    }
    void load()
  }, [searchParams, router, confirmAndLoad, load])

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault()
    const value = callsign.trim()
    if (!value || inviting) return
    setInviting(true)
    setInviteError(null)
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign: value })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        setInviteError(data?.error || 'Failed to send invite')
        return
      }
      setCallsign('')
      toast({
        kind: 'success',
        title: 'INVITE SENT',
        body: `@${data.member?.username ?? value} has been invited to your roster.`
      })
      await load()
    } catch {
      setInviteError('Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  const handleRemove = async (member: RosterMember) => {
    setBusyId(member.affiliationId)
    try {
      const res = await fetch(`/api/team/roster?affiliationId=${member.affiliationId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        toast({
          kind: 'error',
          title: 'ACTION FAILED',
          body: data?.error || 'Could not update the roster.'
        })
        return
      }
      toast({
        kind: 'success',
        title: member.status === 'active' ? 'MEMBER REMOVED' : 'INVITE REVOKED',
        body: `@${member.username} no longer holds a seat.`
      })
      await load()
    } catch {
      toast({ kind: 'error', title: 'ACTION FAILED', body: 'Could not update the roster.' })
    } finally {
      setBusyId(null)
      setArmedId(null)
    }
  }

  /* ---------- gates ---------- */

  if (gate === 'loading') {
    return (
      <div className="page-zoom-out mx-auto max-w-3xl px-6 pb-16 pt-10">
        <div className="h-8 w-56 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-6 h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
        <div className="mt-4 h-64 animate-pulse rounded-2xl bg-white/[0.04]" />
      </div>
    )
  }

  if (gate === 'confirming') {
    return (
      <div
        role="status"
        className="page-zoom-out mx-auto max-w-3xl px-6 pb-16 pt-16 text-center"
      >
        <h1
          className="text-lg leading-none [font-family:var(--font-pixel)]"
          style={{ color: `rgb(${GOLD})`, textShadow: `0 0 18px rgb(${GOLD} / 0.4)` }}
        >
          CONFIRMING PAYMENT…
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-zinc-400">
          Polar has your order — switching this account to a company profile.
          This takes a few seconds.
        </p>
        <div aria-hidden className="mt-8 flex justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-3 w-2 animate-pulse rounded-[2px]"
              style={{
                background: `rgb(${GOLD} / 0.85)`,
                boxShadow: `0 0 8px rgb(${GOLD} / 0.5)`,
                animationDelay: `${i * 220}ms`
              }}
            />
          ))}
        </div>
      </div>
    )
  }

  if (gate !== 'ok' || !roster) {
    const copy =
      gate === 'signed-out'
        ? {
            title: 'SIGN IN REQUIRED',
            body: 'The team console is tied to your account.',
            href: '/login' as string | null,
            cta: 'SIGN IN'
          }
        : gate === 'not-team'
          ? {
              title: 'TEAM ACCOUNTS ONLY',
              body: 'This console belongs to Cribble Team accounts — the gold badge, the square avatar, and up to 10 affiliated pilots.',
              href: '/teams' as string | null,
              cta: 'SEE THE TEAM PLAN'
            }
          : {
              title: 'CONSOLE OFFLINE',
              body: 'Could not load your roster. Give it a moment and try again.',
              href: null,
              cta: 'RETRY'
            }
    const ctaCls =
      'mt-6 inline-block rounded-lg border px-4 py-2 text-[10px] tracking-[0.3em] transition-colors'
    const ctaStyle = {
      color: `rgb(${GOLD})`,
      borderColor: `rgb(${GOLD} / 0.4)`,
      background: `rgb(${GOLD} / 0.06)`
    }
    return (
      <div className="page-zoom-out mx-auto max-w-3xl px-6 pb-16 pt-16 text-center">
        <h1
          className="text-lg leading-none [font-family:var(--font-pixel)]"
          style={{ color: `rgb(${GOLD})`, textShadow: `0 0 18px rgb(${GOLD} / 0.4)` }}
        >
          {copy.title}
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-zinc-400">{copy.body}</p>
        {copy.href ? (
          <Link href={copy.href} className={ctaCls} style={ctaStyle}>
            {copy.cta}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              setGate('loading')
              void load()
            }}
            className={ctaCls}
            style={ctaStyle}
          >
            {copy.cta}
          </button>
        )}
      </div>
    )
  }

  /* ---------- console ---------- */

  const seatsFree = roster.seatsUsed < roster.seatLimit
  const canInvite = roster.approved && seatsFree
  const pending = roster.members.filter((m) => m.status === 'pending')
  const activeMembers = roster.members.filter((m) => m.status === 'active')

  return (
    <div className="page-zoom-out mx-auto max-w-3xl px-6 pb-16 pt-6">
      {/* ---------- title lockup ---------- */}
      <header className="mt-3 flex flex-col items-center">
        <span className="text-[9px] tracking-[0.5em] text-zinc-600">COMPANY OPERATIONS</span>
        <h1
          className="mt-3 select-none text-center text-2xl leading-none [font-family:var(--font-pixel)] md:text-3xl"
          style={{
            color: `rgb(${GOLD})`,
            textShadow: `0 0 22px rgb(${GOLD} / 0.4), 0 0 52px rgb(${GOLD} / 0.16)`
          }}
        >
          TEAM CONSOLE
        </h1>
        <p className="mt-3 text-center text-[10px] tracking-[0.3em] text-zinc-600">
          UP TO {roster.seatLimit} AFFILIATED PILOTS · PENDING INVITES HOLD A SEAT
        </p>
      </header>

      <main className="mt-8 space-y-4">
        {!roster.approved && <ReviewBanner reviewStatus={roster.reviewStatus} />}

        {/* ---------- invite console ---------- */}
        <GoldPanel>
          <div className="px-5 py-4 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <span className="text-[9px] tracking-[0.35em] text-zinc-500">RECRUITMENT</span>
              <SeatMeter used={roster.seatsUsed} limit={roster.seatLimit} />
            </div>

            <form onSubmit={handleInvite} className="mt-4 flex gap-2">
              <input
                type="text"
                value={callsign}
                onChange={(e) => {
                  setCallsign(e.target.value)
                  if (inviteError) setInviteError(null)
                }}
                placeholder="@callsign"
                maxLength={40}
                disabled={!canInvite || inviting}
                aria-label="Invite by callsign"
                className="lb-inset min-w-0 flex-1 rounded-lg px-3 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!canInvite || inviting || callsign.trim().length === 0}
                className="shrink-0 rounded-lg border px-4 py-2.5 text-[10px] tracking-[0.3em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  color: `rgb(${GOLD})`,
                  borderColor: `rgb(${GOLD} / 0.45)`,
                  background: `rgb(${GOLD} / 0.07)`
                }}
              >
                {inviting ? 'SENDING…' : 'INVITE'}
              </button>
            </form>

            <p
              className="mt-2.5 text-[9px] tracking-[0.2em]"
              style={inviteError ? { color: 'rgb(var(--lb-down))' } : undefined}
            >
              {inviteError ? (
                inviteError.toUpperCase()
              ) : (
                <span className="text-zinc-600">
                  {!roster.approved
                    ? 'INVITES UNLOCK ONCE YOUR TEAM PASSES REVIEW'
                    : !seatsFree
                      ? 'ALL SEATS IN USE — REMOVE A MEMBER OR REVOKE AN INVITE TO FREE ONE'
                      : 'INVITED PILOTS ACCEPT FROM THEIR NOTIFICATIONS BELL'}
                </span>
              )}
            </p>
          </div>
        </GoldPanel>

        {/* ---------- roster ---------- */}
        <div className="lb-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <span className="text-[9px] tracking-[0.35em] text-zinc-500">THE ROSTER</span>
            <span className="text-[9px] tracking-[0.2em] text-zinc-600 tabular-nums">
              {activeMembers.length} ACTIVE · {pending.length} PENDING
            </span>
          </div>

          {roster.members.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-[10px] tracking-[0.35em] text-zinc-300">NO AFFILIATES YET</div>
              <p className="mx-auto mt-2 max-w-[280px] text-[11px] leading-relaxed text-zinc-500">
                {roster.approved
                  ? 'Invite pilots by callsign above — they wear your logo across the leaderboard once they accept.'
                  : 'Your roster opens up as soon as review clears.'}
              </p>
            </div>
          ) : (
            <ul>
              {[...activeMembers, ...pending].map((member) => (
                <RosterRow
                  key={member.affiliationId}
                  member={member}
                  approved={roster.approved}
                  busy={busyId === member.affiliationId}
                  armed={armedId === member.affiliationId}
                  onArm={() => setArmedId(member.affiliationId)}
                  onRemove={() => void handleRemove(member)}
                />
              ))}
            </ul>
          )}
        </div>

        <p className="text-center text-[9px] tracking-[0.25em] text-zinc-700">
          AFFILIATES WEAR YOUR MARK WHILE YOUR SUBSCRIPTION IS ACTIVE AND APPROVED
        </p>
      </main>
    </div>
  )
}

/* ================= page shell ================= */

// useSearchParams requires a Suspense boundary at prerender time; the
// console's own loading gate renders immediately, so the null fallback
// is never visible in practice.
export default function TeamConsolePage() {
  return (
    <Suspense fallback={null}>
      <TeamConsole />
    </Suspense>
  )
}
