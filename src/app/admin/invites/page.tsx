'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminList,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  ReasonDialog,
  type AdminChipTone
} from '@/components/admin'
import { TextField } from '@/components/settings/Field'

// Invite codes for the private beta. The frame (src/app/admin/layout.tsx)
// gates staff; the invites API itself is owner-only — a moderator reaching
// this page gets 403 from the list fetch and sees the owner-access notice
// instead of the console's full-screen gate.

interface Redemption {
  user_id: number | null
  redeemed_at: string
  users: { twitter_username: string | null } | null
}

interface Invite {
  id: number
  code: string
  note: string | null
  max_uses: number
  use_count: number
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  invite_redemptions: Redemption[]
}

type LoadState = 'loading' | 'ready' | 'forbidden'

function inviteStatusMeta(invite: Invite): { label: string; tone: AdminChipTone } {
  if (invite.revoked_at) {
    return { label: 'REVOKED', tone: 'danger' }
  }
  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
    return { label: 'EXPIRED', tone: 'neutral' }
  }
  if (invite.use_count >= invite.max_uses) {
    return { label: 'USED', tone: 'warn' }
  }
  return { label: 'ACTIVE', tone: 'good' }
}

const ICON_COPY = (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
  </svg>
)

const ICON_CHECK = (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m3.25 8.5 3 3 6.5-6.5" />
  </svg>
)

export default function AdminInvitesPage() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [invites, setInvites] = useState<Invite[]>([])
  const [maxUses, setMaxUses] = useState(1)
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<Invite | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchInvites = useCallback(async () => {
    const res = await fetch('/api/admin/invites', { credentials: 'include' })
    if (res.status === 403) {
      setLoadState('forbidden')
      return
    }
    if (!res.ok) {
      setError('Failed to load invites.')
      setLoadState('ready')
      return
    }
    const data = await res.json()
    setInvites(data.invites ?? [])
    setLoadState('ready')
  }, [])

  useEffect(() => {
    fetchInvites()
  }, [fetchInvites])

  const createInvite = async () => {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxUses,
          expiresInDays: expiresInDays === '' ? undefined : expiresInDays,
          note: note.trim() || undefined
        })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Failed to create invite.')
        return
      }
      setNote('')
      await fetchInvites()
    } finally {
      setCreating(false)
    }
  }

  const revokeInvite = async (id: number, reason: string): Promise<string | null> => {
    setError(null)
    const res = await fetch(`/api/admin/invites/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      return data?.error ?? 'Failed to revoke invite.'
    }
    await fetchInvites()
    return null
  }

  const copyCode = async (invite: Invite) => {
    await navigator.clipboard.writeText(invite.code)
    setCopiedId(invite.id)
    setTimeout(() => setCopiedId((current) => (current === invite.id ? null : current)), 1500)
  }

  if (loadState === 'forbidden') {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Invites"
          description="Generate codes to let people sign up with GitHub during the private beta."
        />
        <AdminNotice tone="info">
          Owner access required — the invites API only answers the owner, so there is nothing to
          show here.
        </AdminNotice>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Invites"
        description="Generate codes to let people sign up with GitHub during the private beta."
      />

      {error && (
        <AdminNotice tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <AdminButton variant="ghost" onClick={() => void fetchInvites()}>
              Retry
            </AdminButton>
          </div>
        </AdminNotice>
      )}

      <AdminSection title="Generate a code">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField
            label="Max uses"
            type="number"
            min={1}
            max={1000}
            value={maxUses}
            onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))}
          />
          <TextField
            label="Expires in days"
            description="Blank = never expires."
            type="number"
            min={1}
            max={365}
            value={expiresInDays}
            onChange={(e) =>
              setExpiresInDays(e.target.value === '' ? '' : Math.max(1, Number(e.target.value) || 1))
            }
          />
          <TextField
            label="Recipient / reason"
            description="Required — 10 characters minimum."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who is this for, and why?"
          />
        </div>
        <div className="mt-4">
          <AdminButton
            variant="primary"
            pending={creating}
            disabled={note.trim().length < 10}
            onClick={createInvite}
          >
            Generate invite code
          </AdminButton>
        </div>
      </AdminSection>

      <AdminSection
        title="Codes"
        count={loadState === 'ready' ? invites.length : undefined}
        flush
      >
        {loadState === 'loading' ? (
          <AdminSkeletonList rows={4} />
        ) : invites.length === 0 ? (
          <AdminEmpty
            title="No invite codes yet"
            hint="Generate one above to let someone into the beta."
          />
        ) : (
          <AdminList>
            {invites.map((invite) => {
              const status = inviteStatusMeta(invite)
              const copied = copiedId === invite.id
              return (
                <li key={invite.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <button
                      type="button"
                      onClick={() => copyCode(invite)}
                      title="Copy code"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color:var(--st-border-strong)] px-2.5 font-data text-[13px] tracking-[0.06em] text-[color:var(--st-text)] transition-colors duration-150 hover:bg-[color:var(--st-panel-hover)]"
                    >
                      <span
                        className={copied ? 'text-emerald-600' : 'text-[color:var(--st-text-faint)]'}
                      >
                        {copied ? ICON_CHECK : ICON_COPY}
                      </span>
                      {copied ? 'Copied' : invite.code}
                    </button>
                    <AdminChip tone={status.tone}>{status.label}</AdminChip>
                    <span className="text-[12.5px] tabular-nums text-[color:var(--st-text-muted)]">
                      {invite.use_count}/{invite.max_uses} used
                    </span>
                    {invite.expires_at && (
                      <span className="text-[12.5px] text-[color:var(--st-text-faint)]">
                        expires{' '}
                        <span className="font-data text-[12px]">
                          {new Date(invite.expires_at).toLocaleDateString()}
                        </span>
                      </span>
                    )}
                    {!invite.revoked_at && (
                      <div className="ml-auto">
                        <AdminButton variant="danger" onClick={() => setRevokeTarget(invite)}>
                          Revoke
                        </AdminButton>
                      </div>
                    )}
                  </div>
                  {invite.note && (
                    <p className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                      {invite.note}
                    </p>
                  )}
                  {invite.invite_redemptions.length > 0 && (
                    <p className="text-[12.5px] leading-5 text-[color:var(--st-text-faint)]">
                      Redeemed by{' '}
                      {invite.invite_redemptions
                        .map((r) => r.users?.twitter_username ?? `user #${r.user_id ?? '?'}`)
                        .join(', ')}
                    </p>
                  )}
                </li>
              )
            })}
          </AdminList>
        )}
      </AdminSection>

      {revokeTarget && (
        <ReasonDialog
          title={`Revoke ${revokeTarget.code}`}
          description="The code stops working immediately. Existing redemptions remain in the audit history."
          confirmLabel="Revoke invite"
          danger
          onConfirm={(reason) => revokeInvite(revokeTarget.id, reason)}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  )
}
