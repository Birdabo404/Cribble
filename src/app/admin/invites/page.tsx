'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

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

function inviteStatus(invite: Invite): { label: string; className: string } {
  if (invite.revoked_at) {
    return { label: 'REVOKED', className: 'text-red-400 border-red-500/30' }
  }
  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
    return { label: 'EXPIRED', className: 'text-zinc-500 border-zinc-600/40' }
  }
  if (invite.use_count >= invite.max_uses) {
    return { label: 'USED', className: 'text-amber-400 border-amber-500/30' }
  }
  return { label: 'ACTIVE', className: 'text-emerald-400 border-emerald-500/30' }
}

export default function AdminInvitesPage() {
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [invites, setInvites] = useState<Invite[]>([])
  const [maxUses, setMaxUses] = useState(1)
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchInvites = useCallback(async () => {
    const res = await fetch('/api/admin/invites', { credentials: 'include' })
    if (res.status === 401) {
      router.push('/login')
      return
    }
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
  }, [router])

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

  const revokeInvite = async (id: number) => {
    setError(null)
    const res = await fetch(`/api/admin/invites/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Failed to revoke invite.')
      return
    }
    await fetchInvites()
  }

  const copyCode = async (invite: Invite) => {
    await navigator.clipboard.writeText(invite.code)
    setCopiedId(invite.id)
    setTimeout(() => setCopiedId((current) => (current === invite.id ? null : current)), 1500)
  }

  if (loadState === 'loading') {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
        <p className="text-sm text-zinc-500 tracking-[0.2em]">LOADING…</p>
      </main>
    )
  }

  if (loadState === 'forbidden') {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
        <div className="text-center space-y-2">
          <p className="text-lg text-red-400">403 — admin only</p>
          <p className="text-sm text-zinc-500">Your account does not have invite access.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white px-4 py-10 font-mono">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-md border border-accent/25 px-3 py-1 text-[10px] tracking-[0.22em] text-gray-400">
            <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.5)]" />
            ADMIN / INVITES
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Invite codes</h1>
          <p className="text-sm text-gray-400">
            Generate codes to let people sign up with GitHub during the private beta.
          </p>
        </header>

        <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
          <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">GENERATE_CODE</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs text-zinc-400">
              <span>Max uses</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={maxUses}
                onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))}
                className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white focus:border-accent/50 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs text-zinc-400">
              <span>Expires in (days, blank = never)</span>
              <input
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(e) =>
                  setExpiresInDays(e.target.value === '' ? '' : Math.max(1, Number(e.target.value) || 1))
                }
                className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white focus:border-accent/50 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs text-zinc-400">
              <span>Note (optional)</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="who is this for?"
                className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:border-accent/50 focus:outline-none"
              />
            </label>
          </div>
          <button
            onClick={createInvite}
            disabled={creating}
            className="rounded-md bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Generating…' : 'Generate invite code'}
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </section>

        <section className="space-y-3">
          <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">
            CODES ({invites.length})
          </h2>
          {invites.length === 0 ? (
            <p className="text-sm text-zinc-600">No invite codes yet.</p>
          ) : (
            <ul className="space-y-2">
              {invites.map((invite) => {
                const status = inviteStatus(invite)
                return (
                  <li
                    key={invite.id}
                    className="rounded-md border border-white/10 bg-zinc-950/80 p-4 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => copyCode(invite)}
                        title="Copy code"
                        className="rounded bg-black/60 px-3 py-1.5 text-sm tracking-[0.15em] text-accent transition-colors hover:bg-black"
                      >
                        {copiedId === invite.id ? 'COPIED' : invite.code}
                      </button>
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] tracking-[0.2em] ${status.className}`}
                      >
                        {status.label}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {invite.use_count}/{invite.max_uses} used
                      </span>
                      {invite.expires_at && (
                        <span className="text-xs text-zinc-600">
                          expires {new Date(invite.expires_at).toLocaleDateString()}
                        </span>
                      )}
                      {!invite.revoked_at && (
                        <button
                          onClick={() => revokeInvite(invite.id)}
                          className="ml-auto rounded border border-red-500/30 px-2 py-1 text-[10px] tracking-[0.15em] text-red-400 transition-colors hover:bg-red-950/40"
                        >
                          REVOKE
                        </button>
                      )}
                    </div>
                    {invite.note && (
                      <p className="text-xs text-zinc-500">{invite.note}</p>
                    )}
                    {invite.invite_redemptions.length > 0 && (
                      <p className="text-xs text-zinc-600">
                        redeemed by{' '}
                        {invite.invite_redemptions
                          .map((r) => r.users?.twitter_username ?? `user #${r.user_id ?? '?'}`)
                          .join(', ')}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
