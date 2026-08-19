'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AdminAvatar,
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminFactGrid,
  AdminList,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  ReasonDialog,
  formatDate,
  statusChipMeta,
  tierChipMeta,
  useAdmin,
  type AdminChipMeta,
  type AdminFact
} from '@/components/admin'
import { SegmentedControl } from '@/components/settings/SegmentedControl'

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

const FILTER_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }
] as const
type ReviewFilter = (typeof FILTER_OPTIONS)[number]['value']

/** Review status → chip (review_status arrives as a plain string). */
function reviewChipMeta(status: string): AdminChipMeta {
  if (status === 'approved') return { label: 'APPROVED', tone: 'good' }
  if (status === 'rejected') return { label: 'REJECTED', tone: 'danger' }
  return { label: 'PENDING', tone: 'warn' }
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
  switch (hint) {
    case 'github':
      return 'GitHub'
    case 'x':
      return 'X'
    case 'unknown':
      return 'Unknown'
    default: {
      const exhaustive: never = hint
      return exhaustive
    }
  }
}

function TeamListRow({
  team,
  isOwner,
  working,
  onApprove,
  onReject
}: {
  team: TeamRow
  isOwner: boolean
  working: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const review = reviewChipMeta(team.review_status)
  const tier = tierChipMeta(team.tier)

  const facts: AdminFact[] = [
    {
      label: 'Provider',
      value: (
        <>
          {providerLabel(team.provider_hint)} ·{' '}
          <span className="font-data text-[12px]">id {team.provider_user_id ?? '—'}</span>
        </>
      )
    },
    {
      label: 'Account age',
      value: (
        <span className="font-data text-[12px]">
          {accountAge(team.created_at)} · {formatDate(team.created_at)}
        </span>
      )
    },
    {
      label: 'Website',
      value: team.website ? (
        <a
          href={team.website}
          target="_blank"
          rel="noopener noreferrer"
          title={team.website}
          className="font-data text-[12px] text-sky-600 hover:underline"
        >
          {team.website}
        </a>
      ) : (
        'None claimed'
      )
    },
    {
      label: 'Seats',
      value: (
        <span className="font-data text-[12px]">
          {team.seats === null ? '—' : `${team.seats}/10`}
        </span>
      )
    },
    {
      label: 'Last login',
      value: <span className="font-data text-[12px]">{formatDate(team.last_login)}</span>
    },
    {
      label: 'Team since',
      value: <span className="font-data text-[12px]">{formatDate(team.team_since)}</span>
    }
  ]
  if (team.review_status === 'approved') {
    facts.push({
      label: 'Approved',
      value: <span className="font-data text-[12px]">{formatDate(team.team_approved_at)}</span>
    })
  }
  if (team.account_status !== 'active') {
    const account = statusChipMeta(team.account_status)
    facts.push({
      label: 'Account',
      value: <AdminChip tone={account.tone}>{account.label}</AdminChip>
    })
  }

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <AdminAvatar src={team.avatar} alt={team.display_name} size={40} />
        <div className="min-w-0">
          <Link
            href={`/admin/users/${team.userId}`}
            className="text-[13.5px] font-medium leading-5 text-[color:var(--st-text)] hover:underline"
          >
            {team.display_name}
          </Link>
          <div className="flex flex-wrap items-center gap-x-2 text-[12px] leading-4 text-[color:var(--st-text-muted)]">
            <span className="truncate font-data">
              @{team.username ?? '—'} · #{team.userId}
            </span>
            {team.username && (
              <Link
                href={`/u/${encodeURIComponent(team.username)}`}
                className="shrink-0 transition-colors duration-150 hover:text-[color:var(--st-text)]"
              >
                Public profile ↗
              </Link>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <AdminChip tone={tier.tone}>{tier.label}</AdminChip>
          <AdminChip tone={review.tone}>{review.label}</AdminChip>
        </div>
      </div>

      <AdminFactGrid facts={facts} columns={4} />

      {isOwner && (
        <div className="flex flex-wrap items-center gap-2">
          {team.review_status !== 'approved' && (
            <AdminButton variant="good" pending={working} onClick={onApprove}>
              Approve
            </AdminButton>
          )}
          {team.review_status !== 'rejected' && (
            <AdminButton variant="danger" disabled={working} onClick={onReject}>
              Reject
            </AdminButton>
          )}
        </div>
      )}
    </li>
  )
}

export default function AdminTeamsPage() {
  const me = useAdmin()
  const [filter, setFilter] = useState<ReviewFilter>('pending')
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'warning' } | null>(null)
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
    void load(filter)
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
      setNotice({
        text: `@${team.username ?? team.userId} approved — gold badge is live.`,
        tone: 'info'
      })
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
    setNotice({
      text: `@${team.username ?? team.userId} rejected. ${data?.refundReminder ?? ''}`.trim(),
      tone: 'warning'
    })
    await load(filter)
    return null
  }

  const isOwner = me.role === 'owner'

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Team review"
        description="Pay-first anti-impersonation gate: badges and affiliate seats stay off until an account is approved here. Rejections revert the tier — refunds are manual in Polar."
      />

      <SegmentedControl
        options={FILTER_OPTIONS}
        value={filter}
        onChange={setFilter}
        aria-label="Filter teams by review status"
      />

      {notice && <AdminNotice tone={notice.tone}>{notice.text}</AdminNotice>}

      {error && (
        <AdminNotice tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <AdminButton variant="danger" onClick={() => void load(filter)}>
              Retry
            </AdminButton>
          </div>
        </AdminNotice>
      )}

      <AdminSection flush>
        {loading ? (
          <AdminSkeletonList rows={3} />
        ) : teams.length === 0 ? (
          <AdminEmpty
            title={`No ${filter} teams.`}
            hint={
              filter === 'pending'
                ? 'New team-plan purchases wait here for review.'
                : `Teams appear here once ${filter}.`
            }
          />
        ) : (
          <AdminList>
            {teams.map((team) => (
              <TeamListRow
                key={team.userId}
                team={team}
                isOwner={isOwner}
                working={workingId === team.userId}
                onApprove={() => void approve(team)}
                onReject={() => setRejecting(team)}
              />
            ))}
          </AdminList>
        )}
      </AdminSection>

      {rejecting && (
        <ReasonDialog
          title={`Reject team — @${rejecting.username ?? rejecting.userId}`}
          description="Marks the review as rejected and reverts the tier to FREE. Billing is untouched: cancel and refund the Polar subscription manually."
          confirmLabel="Reject team"
          danger
          onConfirm={(reason) => reject(rejecting, reason)}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  )
}
