'use client'

// Member side of team affiliation — the small page the bell's TEAM INVITE
// notification deep-links to. Shows the caller's current team (with a
// LEAVE action) and every pending invite with ACCEPT / DECLINE. A member
// can hold many pending invites but only one active affiliation, so
// accepting while already on a team is refused server-side with a
// friendly conflict message.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/leaderboard/Avatar'
import { formatRelative } from '@/components/dashboard-v2/format'
import { toast } from '@/components/Toaster'

const GOLD = 'var(--lb-gold)'

interface TeamIdentity {
  userId: number
  username: string
  name: string
  avatar: string | null
}

interface PendingInvite {
  affiliationId: number
  invitedAt: string
  live: boolean
  team: TeamIdentity
}

interface Membership {
  affiliationId: number
  acceptedAt: string | null
  live: boolean
  team: TeamIdentity
}

type Gate = 'loading' | 'ok' | 'signed-out' | 'error'

function TeamFace({ team }: { team: TeamIdentity }) {
  return (
    // Square-ish tile — teams fly the square avatar mark.
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg glass-inset-lite">
      <Avatar
        src={team.avatar}
        char={team.username[0]?.toUpperCase() ?? '?'}
        imgClassName="h-full w-full object-cover"
        fallbackClassName="flex h-full w-full items-center justify-center font-display text-[12px] text-yellow-300"
      />
    </span>
  )
}

function TeamNameBlock({
  team,
  sub
}: {
  team: TeamIdentity
  sub: string
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <Link
          href={`/u/${encodeURIComponent(team.username)}`}
          className="truncate text-xs text-zinc-100 transition-colors hover:text-white hover:underline underline-offset-2"
        >
          {team.name}
        </Link>
        <span className="truncate text-[10px] text-zinc-600">@{team.username}</span>
      </div>
      <div className="mt-0.5 text-[10px] tracking-[0.15em] text-zinc-600">{sub}</div>
    </div>
  )
}

export default function TeamInvitesPage() {
  const [gate, setGate] = useState<Gate>('loading')
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [membership, setMembership] = useState<Membership | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [leaveArmed, setLeaveArmed] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/team/invites', {
        cache: 'no-store',
        credentials: 'include'
      })
      if (res.status === 401) {
        setGate('signed-out')
        return
      }
      const data = await res.json()
      if (!res.ok || !data?.success) {
        setGate('error')
        return
      }
      setInvites(Array.isArray(data.invites) ? data.invites : [])
      setMembership(data.membership ?? null)
      setLeaveArmed(false)
      setGate('ok')
    } catch {
      setGate('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const respond = async (invite: PendingInvite, accept: boolean) => {
    setBusyId(invite.affiliationId)
    try {
      const res = accept
        ? await fetch('/api/team/invites', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ affiliationId: invite.affiliationId })
          })
        : await fetch(`/api/team/invites?affiliationId=${invite.affiliationId}`, {
            method: 'DELETE',
            credentials: 'include'
          })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        toast({
          kind: 'error',
          title: accept ? 'COULD NOT ACCEPT' : 'COULD NOT DECLINE',
          body: data?.error || 'Try again in a moment.'
        })
        return
      }
      toast({
        kind: 'success',
        title: accept ? 'AFFILIATION ACTIVE' : 'INVITE DECLINED',
        body: accept
          ? `You now fly with @${invite.team.username}. Their mark appears once the team is live.`
          : `@${invite.team.username}'s invite was declined.`
      })
      await load()
    } catch {
      toast({ kind: 'error', title: 'ACTION FAILED', body: 'Try again in a moment.' })
    } finally {
      setBusyId(null)
    }
  }

  const leave = async () => {
    if (!membership) return
    setLeaving(true)
    try {
      const res = await fetch('/api/team/membership', {
        method: 'DELETE',
        credentials: 'include'
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        toast({
          kind: 'error',
          title: 'COULD NOT LEAVE',
          body: data?.error || 'Try again in a moment.'
        })
        return
      }
      toast({
        kind: 'success',
        title: 'LEFT THE TEAM',
        body: `You no longer fly with @${membership.team.username}.`
      })
      await load()
    } catch {
      toast({ kind: 'error', title: 'COULD NOT LEAVE', body: 'Try again in a moment.' })
    } finally {
      setLeaving(false)
      setLeaveArmed(false)
    }
  }

  if (gate === 'loading') {
    return (
      <div className="page-zoom-out mx-auto max-w-xl px-6 pb-16 pt-10">
        <div className="mx-auto h-7 w-48 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-8 h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
        <div className="mt-3 h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
      </div>
    )
  }

  if (gate !== 'ok') {
    const signedOut = gate === 'signed-out'
    const ctaCls =
      'mt-6 inline-block rounded-lg border px-4 py-2 text-[10px] tracking-[0.3em] transition-colors'
    const ctaStyle = {
      color: `rgb(${GOLD})`,
      borderColor: `rgb(${GOLD} / 0.4)`,
      background: `rgb(${GOLD} / 0.06)`
    }
    return (
      <div className="page-zoom-out mx-auto max-w-xl px-6 pb-16 pt-16 text-center">
        <h1
          className="text-lg leading-none [font-family:var(--font-pixel)]"
          style={{ color: `rgb(${GOLD})`, textShadow: `0 0 18px rgb(${GOLD} / 0.4)` }}
        >
          {signedOut ? 'SIGN IN REQUIRED' : 'INVITES OFFLINE'}
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-zinc-400">
          {signedOut
            ? 'Team invites are tied to your account.'
            : 'Could not load your invites. Give it a moment and try again.'}
        </p>
        {signedOut ? (
          <Link href="/login" className={ctaCls} style={ctaStyle}>
            SIGN IN
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
            RETRY
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="page-zoom-out mx-auto max-w-xl px-6 pb-16 pt-6">
      <header className="mt-3 flex flex-col items-center">
        <span className="text-[9px] tracking-[0.5em] text-zinc-600">AFFILIATION</span>
        <h1
          className="mt-3 select-none text-center text-xl leading-none [font-family:var(--font-pixel)] md:text-2xl"
          style={{
            color: `rgb(${GOLD})`,
            textShadow: `0 0 22px rgb(${GOLD} / 0.4), 0 0 52px rgb(${GOLD} / 0.16)`
          }}
        >
          TEAM INVITES
        </h1>
        <p className="mt-3 text-center text-[10px] tracking-[0.3em] text-zinc-600">
          ONE TEAM AT A TIME · THEIR MARK RIDES NEXT TO YOUR CALLSIGN
        </p>
      </header>

      <main className="mt-8 space-y-3">
        {/* ---------- current team ---------- */}
        {membership && (
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
            style={{
              border: `1px solid rgb(${GOLD} / 0.28)`,
              background: `linear-gradient(180deg, rgb(${GOLD} / 0.05), transparent 60%), rgb(var(--lb-panel-bg))`
            }}
          >
            <TeamFace team={membership.team} />
            <TeamNameBlock
              team={membership.team}
              sub={`your team · joined ${formatRelative(membership.acceptedAt)}${
                membership.live ? '' : ' · currently inactive'
              }`}
            />
            <button
              type="button"
              disabled={leaving}
              onClick={leaveArmed ? () => void leave() : () => setLeaveArmed(true)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-[9px] tracking-[0.3em] transition-colors disabled:cursor-wait disabled:opacity-60 ${
                leaveArmed
                  ? 'border-rose-400/60 bg-rose-500/15 text-rose-200'
                  : 'border-zinc-800 text-zinc-500 hover:border-rose-400/40 hover:text-rose-300'
              }`}
            >
              {leaving ? 'LEAVING…' : leaveArmed ? 'CONFIRM?' : 'LEAVE'}
            </button>
          </div>
        )}

        {/* ---------- pending invites ---------- */}
        {invites.length === 0 ? (
          <div className="lb-panel rounded-2xl px-6 py-12 text-center">
            <div className="text-[10px] tracking-[0.35em] text-zinc-300">
              {membership ? 'NO OTHER INVITES' : 'NO TEAM INVITES'}
            </div>
            <p className="mx-auto mt-2 max-w-[280px] text-[11px] leading-relaxed text-zinc-500">
              When a team invites you, it lands here and in your notifications bell.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {invites.map((invite) => {
              const busy = busyId === invite.affiliationId
              const blocked = Boolean(membership) || !invite.live
              return (
                <li key={invite.affiliationId} className="lb-panel rounded-2xl px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <TeamFace team={invite.team} />
                    <TeamNameBlock
                      team={invite.team}
                      sub={`invited you ${formatRelative(invite.invitedAt)}${
                        invite.live ? '' : ' · team currently inactive'
                      }`}
                    />
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || blocked}
                        title={
                          membership
                            ? 'Leave your current team first'
                            : invite.live
                              ? undefined
                              : 'This team is not active right now'
                        }
                        onClick={() => void respond(invite, true)}
                        className="rounded-lg border px-3 py-1.5 text-[9px] tracking-[0.3em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        style={{
                          color: `rgb(${GOLD})`,
                          borderColor: `rgb(${GOLD} / 0.45)`,
                          background: `rgb(${GOLD} / 0.07)`
                        }}
                      >
                        {busy ? '…' : 'ACCEPT'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void respond(invite, false)}
                        className="rounded-lg border border-zinc-800 px-3 py-1.5 text-[9px] tracking-[0.3em] text-zinc-500 transition-colors hover:border-rose-400/40 hover:text-rose-300 disabled:cursor-wait disabled:opacity-60"
                      >
                        DECLINE
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {membership && invites.length > 0 && (
          <p className="text-center text-[9px] tracking-[0.25em] text-zinc-700">
            LEAVE YOUR CURRENT TEAM TO ACCEPT A DIFFERENT INVITE
          </p>
        )}
      </main>
    </div>
  )
}
