'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Chrome + access gate shared by every /admin page. Fetches /api/admin/me
// once: 401 bounces to /login, 403 renders the forbidden screen, success
// hands the resolved staff identity to the page via render prop so
// owner-only sections can hide themselves.

export interface StaffMe {
  userId: number
  username: string | null
  role: 'owner' | 'moderator'
}

type LoadState = 'loading' | 'ready' | 'forbidden'

export function AdminShell({
  section,
  children
}: {
  section: string
  children: (me: StaffMe) => ReactNode
}) {
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [me, setMe] = useState<StaffMe | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const res = await fetch('/api/admin/me', { credentials: 'include' })
      if (cancelled) return
      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (!res.ok) {
        setLoadState('forbidden')
        return
      }
      const data = await res.json().catch(() => null)
      if (cancelled) return
      if (!data?.staff) {
        setLoadState('forbidden')
        return
      }
      setMe(data.staff as StaffMe)
      setLoadState('ready')
    }
    load()
    return () => {
      cancelled = true
    }
  }, [router])

  if (loadState === 'loading') {
    return (
      <main className="dossier-canvas min-h-screen bg-black text-white flex items-center justify-center font-mono">
        <p className="text-sm text-zinc-500 tracking-[0.2em]">LOADING…</p>
      </main>
    )
  }

  if (loadState === 'forbidden' || !me) {
    return (
      <main className="dossier-canvas min-h-screen bg-black text-white flex items-center justify-center font-mono">
        <div className="text-center space-y-2">
          <p className="text-lg text-red-400">403 — staff only</p>
          <p className="text-sm text-zinc-500">Your account does not have panel access.</p>
        </div>
      </main>
    )
  }

  const navLink = 'text-[10px] tracking-[0.22em] text-zinc-500 hover:text-zinc-200 transition-colors'

  return (
    <main className="dossier-canvas min-h-screen bg-black text-white px-4 py-10 font-mono">
      <div className="mx-auto w-full max-w-4xl space-y-8">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-md border border-accent/25 px-3 py-1 text-[10px] tracking-[0.22em] text-gray-400">
              <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.5)]" />
              ADMIN / {section}
            </div>
            <span
              className={`rounded border px-2 py-0.5 text-[10px] tracking-[0.2em] ${
                me.role === 'owner'
                  ? 'text-amber-300 border-amber-400/30'
                  : 'text-sky-300 border-sky-400/30'
              }`}
            >
              {me.role.toUpperCase()}
            </span>
            <nav className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              <Link href="/admin" className={navLink}>
                PANEL
              </Link>
              <Link href="/admin/audit" className={navLink}>
                AUDIT LOG
              </Link>
              <Link href="/admin/feedback" className={navLink}>
                FEEDBACK
              </Link>
              <Link href="/admin/trends" className={navLink}>
                TRENDS
              </Link>
              {/* Invites create accounts, seasons control everyone's
                  scores and team review hands out gold badges — owner-only,
                  matching the API gates. Hiding them for moderators is
                  cosmetic; the routes still 403. */}
              {me.role === 'owner' && (
                <>
                  <Link href="/admin/teams" className={navLink}>
                    TEAMS
                  </Link>
                  <Link href="/admin/invites" className={navLink}>
                    INVITES
                  </Link>
                  <Link href="/admin/seasons" className={navLink}>
                    SEASONS
                  </Link>
                </>
              )}
              <Link href="/dashboard" className={navLink}>
                EXIT
              </Link>
            </nav>
          </div>
        </header>

        {children(me)}
      </div>
    </main>
  )
}

/** Status chip styling shared by the panel pages. */
export function statusChip(status: string): { label: string; className: string } {
  if (status === 'banned') {
    return { label: 'BANNED', className: 'text-red-400 border-red-500/30' }
  }
  if (status === 'suspended') {
    return { label: 'SUSPENDED', className: 'text-amber-400 border-amber-500/30' }
  }
  return { label: 'ACTIVE', className: 'text-emerald-400 border-emerald-500/30' }
}

export function staffChip(role: string | null): { label: string; className: string } | null {
  if (role === 'owner') return { label: 'OWNER', className: 'text-amber-300 border-amber-400/30' }
  if (role === 'moderator') {
    return { label: 'MODERATOR', className: 'text-sky-300 border-sky-400/30' }
  }
  return null
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
