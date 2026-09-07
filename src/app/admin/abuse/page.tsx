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
  type AdminChipMeta,
  type AdminChipTone,
  type AdminFact
} from '@/components/admin'
import { SegmentedControl } from '@/components/settings/SegmentedControl'

// Fraud review queue: the detection sweep raises a flag per (user, category)
// when an account trips leaderboard/token abuse signals, and staff triage them
// here. abuse.review sits at the moderator floor, so moderators work this queue
// too. Confirming can optionally suspend the account (hiding it from the
// board) in the same click; dismissing marks a false positive. Both decisions
// demand a written reason and land in the audit log.

interface FraudSignalView {
  code: string
  category: string
  severity: 'low' | 'medium' | 'high'
  score: number
  message: string
  details: Record<string, unknown>
}

interface FlagRow {
  id: number
  userId: number
  username: string | null
  display_name: string
  avatar: string | null
  account_status: string
  category: 'activity' | 'token' | string
  risk_score: number
  level: 'low' | 'medium' | 'high' | 'critical' | string
  signals: FraudSignalView[]
  status: string
  detection_count: number
  first_detected_at: string | null
  last_detected_at: string | null
  resolved_at: string | null
  resolution_reason: string | null
}

interface Counts {
  open: number
  confirmed: number
  dismissed: number
}

const FILTER_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'dismissed', label: 'Dismissed' }
] as const
type ReviewFilter = (typeof FILTER_OPTIONS)[number]['value']

type PendingAction = {
  flag: FlagRow
  action: 'confirm' | 'dismiss'
  suspend: boolean
}

function levelChipMeta(level: string): AdminChipMeta {
  if (level === 'critical' || level === 'high') return { label: level.toUpperCase(), tone: 'danger' }
  if (level === 'medium') return { label: 'MEDIUM', tone: 'warn' }
  return { label: level.toUpperCase() || 'LOW', tone: 'neutral' }
}

function categoryChipMeta(category: string): AdminChipMeta {
  if (category === 'activity') return { label: 'ACTIVITY', tone: 'info' }
  if (category === 'token') return { label: 'TOKENS', tone: 'warn' }
  return { label: category.toUpperCase(), tone: 'neutral' }
}

function severityTone(severity: FraudSignalView['severity']): AdminChipTone {
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warn'
  return 'neutral'
}

function SignalList({ signals }: { signals: FraudSignalView[] }) {
  if (signals.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {signals.map((signal, index) => (
        <li key={`${signal.code}-${index}`} className="flex items-start gap-2">
          <AdminChip tone={severityTone(signal.severity)} title={`score ${signal.score}`}>
            {signal.severity}
          </AdminChip>
          <span className="text-[12.5px] leading-5 text-[color:var(--st-text)]">
            <span className="font-data text-[12px] text-[color:var(--st-text-muted)]">
              {signal.code}
            </span>{' '}
            — {signal.message}
          </span>
        </li>
      ))}
    </ul>
  )
}

function FlagListRow({
  flag,
  working,
  onConfirm,
  onConfirmSuspend,
  onDismiss
}: {
  flag: FlagRow
  working: boolean
  onConfirm: () => void
  onConfirmSuspend: () => void
  onDismiss: () => void
}) {
  const level = levelChipMeta(flag.level)
  const category = categoryChipMeta(flag.category)

  const facts: AdminFact[] = [
    {
      label: 'Risk score',
      value: <span className="font-data text-[12px]">{flag.risk_score}/100</span>
    },
    {
      label: 'Detections',
      value: <span className="font-data text-[12px]">{flag.detection_count}</span>
    },
    {
      label: 'First seen',
      value: <span className="font-data text-[12px]">{formatDate(flag.first_detected_at)}</span>
    },
    {
      label: 'Last seen',
      value: <span className="font-data text-[12px]">{formatDate(flag.last_detected_at)}</span>
    }
  ]
  if (flag.status !== 'open') {
    facts.push({
      label: 'Resolved',
      value: <span className="font-data text-[12px]">{formatDate(flag.resolved_at)}</span>
    })
    if (flag.resolution_reason) {
      facts.push({ label: 'Reason', value: flag.resolution_reason })
    }
  }

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <AdminAvatar src={flag.avatar} alt={flag.display_name} size={40} />
        <div className="min-w-0">
          <Link
            href={`/admin/users/${flag.userId}`}
            className="text-[13.5px] font-medium leading-5 text-[color:var(--st-text)] hover:underline"
          >
            {flag.display_name}
          </Link>
          <div className="flex flex-wrap items-center gap-x-2 text-[12px] leading-4 text-[color:var(--st-text-muted)]">
            <span className="truncate font-data">
              @{flag.username ?? '—'} · #{flag.userId}
            </span>
            {flag.username && (
              <Link
                href={`/u/${encodeURIComponent(flag.username)}`}
                className="shrink-0 transition-colors duration-150 hover:text-[color:var(--st-text)]"
              >
                Public profile ↗
              </Link>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {flag.account_status !== 'active' && (
            <AdminChip tone={statusChipMeta(flag.account_status).tone}>
              {statusChipMeta(flag.account_status).label}
            </AdminChip>
          )}
          <AdminChip tone={category.tone}>{category.label}</AdminChip>
          <AdminChip tone={level.tone}>{level.label}</AdminChip>
        </div>
      </div>

      <AdminFactGrid facts={facts} columns={4} />

      <SignalList signals={flag.signals} />

      {flag.status === 'open' && (
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton variant="danger" disabled={working} onClick={onConfirmSuspend}>
            Confirm &amp; suspend
          </AdminButton>
          <AdminButton variant="primary" disabled={working} onClick={onConfirm}>
            Confirm
          </AdminButton>
          <AdminButton variant="ghost" disabled={working} onClick={onDismiss}>
            Dismiss
          </AdminButton>
        </div>
      )}
    </li>
  )
}

export default function AdminAbusePage() {
  const [filter, setFilter] = useState<ReviewFilter>('open')
  const [flags, setFlags] = useState<FlagRow[]>([])
  const [counts, setCounts] = useState<Counts>({ open: 0, confirmed: 0, dismissed: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'warning' } | null>(null)
  const [workingId, setWorkingId] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)

  const load = useCallback(async (status: ReviewFilter) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/abuse?status=${status}`, {
        credentials: 'include',
        cache: 'no-store'
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data?.flags)) {
        throw new Error(data?.error ?? 'Failed to load fraud flags.')
      }
      setFlags(data.flags as FlagRow[])
      if (data.counts) setCounts(data.counts as Counts)
    } catch (err) {
      setFlags([])
      setError(err instanceof Error ? err.message : 'Failed to load fraud flags.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(filter)
  }, [filter, load])

  /** Runs inside ReasonDialog: an error string keeps the dialog open. */
  const resolve = async (request: PendingAction, reason: string): Promise<string | null> => {
    setWorkingId(request.flag.id)
    try {
      const res = await fetch(`/api/admin/abuse/${request.flag.id}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: request.action, reason, suspend: request.suspend })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        return data?.error ?? 'Failed to apply decision.'
      }
      const who = `@${request.flag.username ?? request.flag.userId}`
      setNotice(
        request.action === 'confirm'
          ? {
              text: data?.suspended
                ? `${who} flag confirmed and account suspended.`
                : `${who} flag confirmed.`,
              tone: 'warning'
            }
          : { text: `${who} flag dismissed as a false positive.`, tone: 'info' }
      )
      await load(filter)
      return null
    } finally {
      setWorkingId(null)
    }
  }

  const dialogCopy = (request: PendingAction): { title: string; description: string; confirmLabel: string } => {
    const who = `@${request.flag.username ?? request.flag.userId}`
    if (request.action === 'dismiss') {
      return {
        title: `Dismiss flag — ${who}`,
        description:
          'Marks this flag as a false positive. The signal snapshot is kept for the audit trail and the account is left untouched.',
        confirmLabel: 'Dismiss flag'
      }
    }
    if (request.suspend) {
      return {
        title: `Confirm & suspend — ${who}`,
        description:
          'Confirms the abuse and suspends the account: it is hidden from the leaderboard and user search but can be restored later. This is reversible from the user dossier.',
        confirmLabel: 'Confirm & suspend'
      }
    }
    return {
      title: `Confirm flag — ${who}`,
      description:
        'Marks the abuse as confirmed for the record without changing the account status. Use the user dossier to ban or suspend separately if needed.',
      confirmLabel: 'Confirm flag'
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Fraud review"
        description="Accounts that tripped leaderboard or token abuse signals land here. Confirm (optionally suspending the account) or dismiss as a false positive — every decision needs a reason and is logged."
      />

      <SegmentedControl
        options={FILTER_OPTIONS.map((option) => ({
          ...option,
          label: `${option.label} (${counts[option.value]})`
        }))}
        value={filter}
        onChange={setFilter}
        aria-label="Filter fraud flags by status"
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
        ) : flags.length === 0 ? (
          <AdminEmpty
            title={`No ${filter} flags.`}
            hint={
              filter === 'open'
                ? 'The detection sweep raises flags here when an account trips abuse signals.'
                : `Flags appear here once ${filter}.`
            }
          />
        ) : (
          <AdminList>
            {flags.map((flag) => (
              <FlagListRow
                key={flag.id}
                flag={flag}
                working={workingId === flag.id}
                onConfirm={() => setPending({ flag, action: 'confirm', suspend: false })}
                onConfirmSuspend={() => setPending({ flag, action: 'confirm', suspend: true })}
                onDismiss={() => setPending({ flag, action: 'dismiss', suspend: false })}
              />
            ))}
          </AdminList>
        )}
      </AdminSection>

      {pending && (
        <ReasonDialog
          {...dialogCopy(pending)}
          danger={pending.action === 'confirm' && pending.suspend}
          onConfirm={(reason) => resolve(pending, reason)}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
