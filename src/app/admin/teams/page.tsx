'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AdminShell, formatDate, type StaffMe } from '@/components/admin/AdminShell'
import { ReasonDialog } from '@/components/admin/ReasonDialog'

// Team review queue: every account that bought the team plan waits here
// (pay first, badge later) until the owner approves or rejects it. The
// row surfaces the anti-impersonation signals — OAuth provider identity,
// account age, claimed website, tier and seat usage — and approving is
// one click, while rejecting demands a written reason (it reverts the
// tier; the refund itself happens manually in Polar).

interface TeamRow {
  userId: number
  username: string | null
  display_name: string
  avatar: string | null
  provider_user_id: string | null
  provider_hint: 'github' | 'x' | 'unknown'
  account_status: string
  tier: string
  review_status: string
  team_approved_at: string | null
  website: string | null
  team_since: string | null
  created_at: string | null
  last_login: string | null
  seats: number | null
}

const FILTERS = ['pending', 'approved', 'rejected'] as const
type ReviewFilter = (typeof FILTERS)[number]

const chipCls = 'rounded border px-2 py-0.5 text-[10px] tracking-[0.2em]'

function reviewChip(status: string): { label: string; className: string } {
  if (status === 'approved') {
    return { label: 'APPROVED', className: 'text-emerald-400 border-emerald-500/30' }
  }
  if (status === 'rejected') {
    return { label: 'REJECTED', className: 'text-red-400 border-red-500/30' }
  }
  return { label: 'PENDING', className: 'text-amber-300 border-amber-400/30' }
}

/** Compact account age — brand-new accounts are the impersonation tell. */
function accountAge(created: string | null): string {
  if (!created) return '—'
  const ms = Date.now() - new Date(created).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return '<1d'
  if (days < 60) return `${days}d`
  if (days < 730) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

function providerLabel(hint: TeamRow['provider_hint']): string {
  if (hint === 'github') return 'GITHUB'
  if (hint === 'x') return 'X'
  return 'PROVIDER?'
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] tracking-[0.3em] text-zinc-600">{label}</div>
      <div className="mt-0.5 text-xs text-zinc-300">{value}</div>
    </div>
  )
}

function TeamQueue({ me }: { me: StaffMe }) {
  const [filter, setFilter] = useState<ReviewFilter>('pending')
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<TeamRow | null>(null)

  const load = useCallback(async (status: ReviewFilter) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/teams?status=${status}`, {
        credentials: 'include'
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data?.teams)) {
        throw new Error(data?.error ?? 'Failed to load teams.')
      }
      setTeams(data.teams as TeamRow[])
    } catch (err) {
      setTeams([])
      setError(err instanceof Error ? err.message : 'Failed to load teams.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(filter)
  }, [filter, load])

  const approve = async (team: TeamRow) => {
    if (workingId !== null) return
    setWorkingId(team.userId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/teams/${team.userId}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to approve team.')
      }
      setNotice(`@${team.username ?? team.userId} approved — gold badge is live.`)
      await load(filter)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve team.')
    } finally {
      setWorkingId(null)
    }
  }

  /** Runs inside ReasonDialog: an error string keeps the dialog open. */
  const reject = async (team: TeamRow, reason: string): Promise<string | null> => {
    const res = await fetch(`/api/admin/teams/${team.userId}/review`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', reason })
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return data?.error ?? 'Failed to reject team.'
    }
    setNotice(
      `@${team.username ?? team.userId} rejected. ${data?.refundReminder ?? ''}`.trim()
    )
    await load(filter)
    return null
  }

  const isOwner = me.role === 'owner'

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Team review</h1>
        <p className="text-sm text-gray-400">
          Pay-first anti-impersonation gate: badges and affiliate seats stay off until an
          account is approved here. Rejections revert the tier — refunds are manual in Polar.
        </p>
      </div>

      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-md border px-3 py-1.5 text-[10px] tracking-[0.2em] transition-colors ${
                filter === value
                  ? 'border-accent/50 text-accent'
                  : 'border-white/10 text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>

        {notice && (
          <p className="rounded-md border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            {notice}
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}

        {loading ? (
          <p className="text-xs text-zinc-600">Loading…</p>
        ) : teams.length === 0 ? (
          <p className="text-xs text-zinc-600">No {filter} teams.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {teams.map((team) => {
              const review = reviewChip(team.review_status)
              const working = workingId === team.userId
              return (
                <li key={team.userId} className="py-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {team.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={team.avatar}
                        alt={team.display_name}
                        className="h-10 w-10 rounded-md border border-zinc-800 object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-md border border-zinc-800 bg-zinc-900" />
                    )}
                    <div className="min-w-0">
                      <Link
                        href={`/admin/users/${team.userId}`}
                        className="text-sm text-zinc-100 hover:underline"
                      >
                        {team.display_name}
                      </Link>
                      <div className="text-xs text-zinc-500 truncate">
                        @{team.username ?? '—'} · #{team.userId}
                        {team.username && (
                          <Link
                            href={`/u/${encodeURIComponent(team.username)}`}
                            className="ml-2 text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200 transition-colors"
                          >
                            PUBLIC →
                          </Link>
                        )}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <span className={`${chipCls} border-zinc-600/40 text-zinc-400`}>
                        {team.tier}
                      </span>
                      <span className={`${chipCls} ${review.className}`}>{review.label}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Fact
                      label="PROVIDER"
                      value={`${providerLabel(team.provider_hint)} · id ${team.provider_user_id ?? '—'}`}
                    />
                    <Fact
                      label="ACCOUNT AGE"
                      value={`${accountAge(team.created_at)} · ${formatDate(team.created_at)}`}
                    />
                    <Fact
                      label="WEBSITE"
                      value={
                        team.website ? (
                          <a
                            href={team.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="break-all text-sky-300 hover:underline"
                          >
                            {team.website}
                          </a>
                        ) : (
                          'none claimed'
                        )
                      }
                    />
                    <Fact
                      label="SEATS"
                      value={team.seats === null ? '—' : `${team.seats}/10`}
                    />
                    <Fact label="LAST LOGIN" value={formatDate(team.last_login)} />
                    <Fact label="TEAM SINCE" value={formatDate(team.team_since)} />
                    {team.review_status === 'approved' && (
                      <Fact label="APPROVED" value={formatDate(team.team_approved_at)} />
                    )}
                    {team.account_status !== 'active' && (
                      <Fact
                        label="ACCOUNT"
                        value={
                          <span className="text-red-400">
                            {team.account_status.toUpperCase()}
                          </span>
                        }
                      />
                    )}
                  </div>

                  {isOwner && (
                    <div className="flex flex-wrap items-center gap-2">
                      {team.review_status !== 'approved' && (
                        <button
                          disabled={working}
                          onClick={() => approve(team)}
                          className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-[10px] tracking-[0.2em] text-emerald-300 transition-colors hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {working ? 'WORKING…' : 'APPROVE'}
                        </button>
                      )}
                      {team.review_status !== 'rejected' && (
                        <button
                          disabled={working}
                          onClick={() => setRejecting(team)}
                          className="rounded-md border border-red-500/40 px-3 py-1.5 text-[10px] tracking-[0.2em] text-red-300 transition-colors hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          REJECT
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {rejecting && (
        <ReasonDialog
          title={`REJECT TEAM — @${rejecting.username ?? rejecting.userId}`}
          description="Marks the review as rejected and reverts the tier to FREE. Billing is untouched: cancel and refund the Polar subscription manually."
          confirmLabel="REJECT TEAM"
          danger
          onConfirm={(reason) => reject(rejecting, reason)}
          onClose={() => setRejecting(null)}
        />
      )}
    </>
  )
}

export default function AdminTeamsPage() {
  return <AdminShell section="TEAMS">{(me) => <TeamQueue me={me} />}</AdminShell>
}
