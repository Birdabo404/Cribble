import { useEffect } from 'react'
import { formatNumber, formatRelative, tierAccent, ACCENT, accentA } from './format'
import type { ActiveDevice, MeUser, RankInfo } from '@/types/dashboard'

const ROLE_LABELS: Record<string, string> = {
  student: 'Student',
  researcher: 'Researcher',
  developer: 'Developer',
  designer: 'Designer',
  founder: 'Founder',
  product: 'Product',
  writer: 'Writer',
  other: 'Curious Mind'
}

const GOAL_LABELS: Record<string, string> = {
  learn: 'learn a new skill',
  build: 'ship a product',
  research: 'do research',
  work: 'work faster',
  hobby: 'stay curious',
  other: 'find their path'
}

export function AccountModal({
  open,
  onClose,
  user,
  totalScore,
  activeDevice,
  rank,
  onLogout,
  streak,
  role,
  goal
}: {
  open: boolean
  onClose: () => void
  user: MeUser
  totalScore: number
  activeDevice: ActiveDevice | null
  rank: RankInfo | null
  onLogout: () => void
  streak: number
  role: string | null
  goal: string | null
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    : '—'

  const lastSeen = user.last_login ? formatRelative(user.last_login) : '—'
  const roleLabel = role && ROLE_LABELS[role] ? ROLE_LABELS[role] : null
  const goalLabel = goal && GOAL_LABELS[goal] ? GOAL_LABELS[goal] : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800/80 bg-[var(--panel)] shadow-2xl overflow-hidden">
        {/* HEADER */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-900">
          <div className="flex items-center gap-2.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: ACCENT,
                boxShadow: `0 0 8px ${accentA(0.67)}`
              }}
            />
            <span className="text-[10px] tracking-[0.4em] text-zinc-300">
              ACCOUNT
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              className="h-4 w-4"
            >
              <path
                fill="currentColor"
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>

        {/* IDENTITY */}
        <div className="px-5 pt-5 pb-4 flex items-center gap-4">
          {user.twitter_profile_image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.twitter_profile_image}
              alt={user.twitter_username}
              className="h-14 w-14 rounded-full border border-zinc-800 object-cover"
            />
          ) : (
            <div className="h-14 w-14 rounded-full border border-zinc-800 bg-zinc-900" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-base text-zinc-50 truncate">
              {user.twitter_name || user.twitter_username || 'User'}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              @{user.twitter_username || 'user'}
            </div>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span
                className={`text-[9px] tracking-[0.3em] px-1.5 py-0.5 rounded border ${tierAccent(user.subscription_tier)}`}
              >
                {(user.subscription_tier || 'FREE').toUpperCase()}
              </span>
              {roleLabel && (
                <span
                  className="text-[9px] tracking-[0.3em] px-1.5 py-0.5 rounded border"
                  style={{
                    color: ACCENT,
                    borderColor: `${accentA(0.33)}`,
                    background: `${accentA(0.05)}`
                  }}
                >
                  {roleLabel.toUpperCase()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* MISSION */}
        {goalLabel && (
          <div className="px-5 pb-4">
            <div className="rounded-lg border border-zinc-900 bg-black/40 px-3 py-2.5">
              <div className="text-[9px] tracking-[0.3em] text-zinc-600">
                <span style={{ color: `${accentA(0.6)}` }}>{'// '}</span>
                MISSION
              </div>
              <div className="mt-0.5 text-xs text-zinc-300">
                here to{' '}
                <span className="text-zinc-100">{goalLabel}</span>
              </div>
            </div>
          </div>
        )}

        {/* STATS TRIPLET */}
        <div className="px-5 pb-4">
          <div className="grid grid-cols-3 rounded-lg border border-zinc-900 bg-black/30 overflow-hidden">
            <StatCell
              label="RANK"
              value={rank ? `#${rank.position}` : '—'}
              hint={rank ? `of ${rank.total}` : 'unranked'}
            />
            <StatCell
              label="SCORE"
              value={formatNumber(Math.round(totalScore))}
              hint="total"
              divider
            />
            <StatCell
              label="STREAK"
              value={`${streak}d`}
              hint="active"
              divider
            />
          </div>
        </div>

        {/* DETAILS */}
        <dl className="px-5 pb-4 space-y-2 text-xs">
          <Row label="JOINED" value={joined} />
          <Row label="LAST LOGIN" value={lastSeen} />
          <Row
            label="DEVICE"
            value={
              activeDevice
                ? activeDevice.device_uuid.slice(0, 8) + '…'
                : 'Not linked'
            }
          />
          {activeDevice?.last_sync_at && (
            <Row
              label="LAST SYNC"
              value={formatRelative(activeDevice.last_sync_at)}
            />
          )}
        </dl>

        {/* ACTIONS */}
        <div className="border-t border-zinc-900 px-5 py-3 flex items-center justify-between">
          <a
            href="/leaderboard"
            className="text-[10px] tracking-[0.3em] text-zinc-400 hover:text-accent transition-colors"
          >
            LEADERBOARD →
          </a>
          <button
            onClick={onLogout}
            className="text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 hover:border-rose-400/50 transition-colors"
          >
            SIGN OUT
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCell({
  label,
  value,
  hint,
  divider
}: {
  label: string
  value: string
  hint?: string
  divider?: boolean
}) {
  return (
    <div className={`px-3 py-2.5 ${divider ? 'border-l border-zinc-900' : ''}`}>
      <div className="text-[9px] tracking-[0.3em] text-zinc-600">{label}</div>
      <div className="mt-0.5 text-base font-semibold tracking-tight text-zinc-50 tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="text-[9px] tracking-wide text-zinc-600 truncate">
          {hint}
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[10px] tracking-[0.3em] text-zinc-500">{label}</dt>
      <dd className="text-zinc-200 truncate">{value}</dd>
    </div>
  )
}
