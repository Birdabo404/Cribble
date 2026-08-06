'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AdminShell,
  formatDate,
  staffChip,
  statusChip,
  type StaffMe
} from '@/components/admin/AdminShell'

// Panel home: find a user (the entry point for every moderation action),
// see who currently holds staff access, and glance at the latest audit
// activity. All data comes from the /api/admin/* routes — this page
// renders nothing a non-staff session could fetch.

interface SearchResult {
  userId: number
  username: string | null
  display_name: string
  profile_image: string | null
  status: string
  tier: string
  staff_role: string | null
  created_at: string | null
  last_login: string | null
}

interface StaffRow {
  userId: number
  username: string | null
  display_name: string
  profile_image: string | null
  staff_role: string | null
  status: string
}

interface AuditRow {
  id: number
  admin_username: string | null
  admin_user_id: number | null
  target_username: string | null
  target_user_id: number | null
  action: string
  reason: string | null
  created_at: string
}

function Avatar({ src, alt, size = 'h-8 w-8' }: { src: string | null; alt: string; size?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={`${size} rounded-full border border-zinc-800 object-cover`} />
  ) : (
    <div className={`${size} rounded-full border border-zinc-800 bg-zinc-900`} />
  )
}

function UserSearchSection() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`, {
          credentials: 'include'
        })
        const data = await res.json().catch(() => null)
        setResults(res.ok && Array.isArray(data?.users) ? data.users : [])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  return (
    <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
      <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">FIND_USER</h2>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="handle, display name or user id…"
        className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:border-accent/50 focus:outline-none"
      />
      {searching && <p className="text-xs text-zinc-600">Searching…</p>}
      {!searching && query.trim() && results.length === 0 && (
        <p className="text-xs text-zinc-600">No users found.</p>
      )}
      {results.length > 0 && (
        <ul className="divide-y divide-white/5">
          {results.map((user) => {
            const status = statusChip(user.status)
            const staff = staffChip(user.staff_role)
            return (
              <li key={user.userId}>
                <Link
                  href={`/admin/users/${user.userId}`}
                  className="flex flex-wrap items-center gap-3 px-1 py-2.5 transition-colors hover:bg-white/[0.03]"
                >
                  <Avatar src={user.profile_image} alt={user.display_name} />
                  <div className="min-w-0">
                    <div className="text-sm text-zinc-100 truncate">{user.display_name}</div>
                    <div className="text-xs text-zinc-500 truncate">
                      @{user.username ?? '—'} · #{user.userId}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {staff && (
                      <span className={`rounded border px-2 py-0.5 text-[10px] tracking-[0.2em] ${staff.className}`}>
                        {staff.label}
                      </span>
                    )}
                    <span className="rounded border border-zinc-600/40 px-2 py-0.5 text-[10px] tracking-[0.2em] text-zinc-400">
                      {user.tier}
                    </span>
                    <span className={`rounded border px-2 py-0.5 text-[10px] tracking-[0.2em] ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function StaffSection() {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/admin/staff', { credentials: 'include' })
      const data = await res.json().catch(() => null)
      setStaff(res.ok && Array.isArray(data?.staff) ? data.staff : [])
      setLoaded(true)
    }
    load()
  }, [])

  return (
    <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">STAFF ({staff.length})</h2>
        <p className="text-[10px] text-zinc-600">
          Promote or demote from a user&apos;s page.
        </p>
      </div>
      {!loaded ? (
        <p className="text-xs text-zinc-600">Loading…</p>
      ) : staff.length === 0 ? (
        <p className="text-xs text-zinc-600">No staff yet.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {staff.map((member) => {
            const chip = staffChip(member.staff_role)
            return (
              <li key={member.userId}>
                <Link
                  href={`/admin/users/${member.userId}`}
                  className="flex items-center gap-3 px-1 py-2.5 transition-colors hover:bg-white/[0.03]"
                >
                  <Avatar src={member.profile_image} alt={member.display_name} size="h-7 w-7" />
                  <div className="min-w-0">
                    <span className="text-sm text-zinc-100">{member.display_name}</span>
                    <span className="ml-2 text-xs text-zinc-500">@{member.username ?? '—'}</span>
                  </div>
                  {chip && (
                    <span className={`ml-auto rounded border px-2 py-0.5 text-[10px] tracking-[0.2em] ${chip.className}`}>
                      {chip.label}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function BillboardSection() {
  const [counts, setCounts] = useState<{
    queue: number
    awaiting: number
    live: number
    maxLive: number
  } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/admin/billboard', { credentials: 'include' })
      const data = await res.json().catch(() => null)
      setCounts(
        res.ok && Array.isArray(data?.queue)
          ? {
              queue: data.queue.length,
              awaiting: Array.isArray(data.awaiting) ? data.awaiting.length : 0,
              live: Number(data.liveCount) || 0,
              maxLive: Number(data.maxLive) || 0
            }
          : null
      )
      setLoaded(true)
    }
    load()
  }, [])

  return (
    <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">BILLBOARD</h2>
        <Link
          href="/admin/billboard"
          className="text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          REVIEW QUEUE →
        </Link>
      </div>
      {!loaded ? (
        <p className="text-xs text-zinc-600">Loading…</p>
      ) : !counts ? (
        <p className="text-xs text-zinc-600">Billboard stats unavailable.</p>
      ) : (
        <p className="text-xs text-zinc-400">
          <span className={counts.queue > 0 ? 'text-amber-300' : undefined}>
            {counts.queue} awaiting review
          </span>
          {' · '}
          {counts.awaiting} awaiting payment
          {' · '}
          {counts.live}/{counts.maxLive} live
        </p>
      )}
    </section>
  )
}

function RecentActivitySection() {
  const [entries, setEntries] = useState<AuditRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/admin/audit', { credentials: 'include' })
      const data = await res.json().catch(() => null)
      setEntries(res.ok && Array.isArray(data?.entries) ? data.entries.slice(0, 8) : [])
      setLoaded(true)
    }
    load()
  }, [])

  return (
    <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">RECENT_ACTIVITY</h2>
        <Link
          href="/admin/audit"
          className="text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          FULL LOG →
        </Link>
      </div>
      {!loaded ? (
        <p className="text-xs text-zinc-600">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-zinc-600">No staff actions recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="text-xs text-zinc-400">
              <span className="text-zinc-600">{formatDate(entry.created_at)}</span>{' '}
              <span className="text-zinc-200">
                @{entry.admin_username ?? `#${entry.admin_user_id ?? '?'}`}
              </span>{' '}
              <span className="text-accent">{entry.action}</span>
              {entry.target_user_id !== null && (
                <>
                  {' → '}
                  <Link
                    href={`/admin/users/${entry.target_user_id}`}
                    className="text-zinc-200 hover:underline"
                  >
                    @{entry.target_username ?? `#${entry.target_user_id}`}
                  </Link>
                </>
              )}
              {entry.reason && <span className="text-zinc-600"> — {entry.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AdminHome({ me }: { me: StaffMe }) {
  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Staff panel</h1>
        <p className="text-sm text-gray-400">
          Every action here requires a reason and is permanently recorded in the audit log,
          visible to all staff.
        </p>
      </div>
      <UserSearchSection />
      {me.role === 'owner' && <StaffSection />}
      {/* Billboard review is owner-gated like team review — hiding the
          card for moderators is cosmetic; the API still 403s. */}
      {me.role === 'owner' && <BillboardSection />}
      <RecentActivitySection />
    </>
  )
}

export default function AdminHomePage() {
  return <AdminShell section="PANEL">{(me) => <AdminHome me={me} />}</AdminShell>
}
