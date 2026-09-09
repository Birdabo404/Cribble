'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AdminAvatar,
  AdminChip,
  AdminEmpty,
  AdminList,
  AdminListRow,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  formatDate,
  staffChipMeta,
  statusChipMeta,
  tierChipMeta,
  useAdmin
} from '@/components/admin'
import { Skeleton } from '@/components/settings/Skeleton'

// Console home: find a member (the entry point for every moderation
// action), see which queues need a staff decision, who currently holds
// staff access, and the latest audit activity. All data comes from the
// /api/admin/* routes — this page renders nothing a non-staff session
// could fetch. Moderators get search + recent activity only; the
// owner-only sections are cosmetic gates (the APIs still 403).

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

const QUIET_LINK =
  'text-[color:var(--st-text-muted)] transition-colors duration-150 hover:text-[color:var(--st-text)]'

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

  // Stale results stay on screen while a refined query is in flight, so
  // the list only swaps to skeletons on the first search.
  let body: ReactNode = null
  if (results.length > 0) {
    body = (
      <AdminList className="border-t border-[color:var(--st-border)]">
        {results.map((user) => {
          const staff = staffChipMeta(user.staff_role)
          const tier = tierChipMeta(user.tier)
          const status = statusChipMeta(user.status)
          return (
            <AdminListRow key={user.userId} href={`/admin/users/${user.userId}`}>
              <AdminAvatar src={user.profile_image} alt={user.display_name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium leading-5 text-[color:var(--st-text)]">
                  {user.display_name}
                </p>
                <p className="truncate font-data text-[11.5px] leading-4 text-[color:var(--st-text-muted)]">
                  @{user.username ?? '—'} · #{user.userId}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {staff && <AdminChip tone={staff.tone}>{staff.label}</AdminChip>}
                <AdminChip tone={tier.tone}>{tier.label}</AdminChip>
                <AdminChip tone={status.tone}>{status.label}</AdminChip>
              </div>
            </AdminListRow>
          )
        })}
      </AdminList>
    )
  } else if (searching) {
    body = (
      <div className="border-t border-[color:var(--st-border)]">
        <AdminSkeletonList rows={3} />
      </div>
    )
  } else if (query.trim()) {
    body = (
      <div className="border-t border-[color:var(--st-border)]">
        <AdminEmpty
          title="No one matches."
          hint="Try a handle without the @, a display name, or an exact user id."
        />
      </div>
    )
  }

  return (
    <AdminSection
      title="Find a member"
      description="Results open the member's dossier — the entry point for every staff action."
      flush
    >
      <div className="p-4 sm:p-5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Handle, display name or user id"
          aria-label="Find a member"
          className="st-input block w-full rounded-lg px-3.5 py-2.5 text-[16px] leading-6 md:text-[15px]"
        />
      </div>
      {body}
    </AdminSection>
  )
}

// The queues that need a staff decision. Each link opens the queue page,
// where the counts live.
function NeedsAttentionSection() {
  return (
    <AdminSection title="Needs attention" flush>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[12.5px] leading-5 sm:px-5">
        <span className="text-[color:var(--st-text-faint)]">Open queues</span>
        <Link href="/admin/feedback" className={QUIET_LINK}>
          Feedback
        </Link>
        <Link href="/admin/teams" className={QUIET_LINK}>
          Teams
        </Link>
        <Link href="/admin/waitlist" className={QUIET_LINK}>
          Waitlist
        </Link>
      </div>
    </AdminSection>
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
    <AdminSection
      title="Staff"
      count={loaded ? staff.length : undefined}
      description="Promote or demote from a user's page."
      flush
    >
      {!loaded ? (
        <AdminSkeletonList rows={3} />
      ) : staff.length === 0 ? (
        <AdminEmpty
          title="No staff yet."
          hint="Find a member above and promote them from their page."
        />
      ) : (
        <AdminList>
          {staff.map((member) => {
            const chip = staffChipMeta(member.staff_role)
            return (
              <AdminListRow key={member.userId} href={`/admin/users/${member.userId}`}>
                <AdminAvatar src={member.profile_image} alt={member.display_name} size={28} />
                <div className="min-w-0 flex-1 truncate">
                  <span className="text-[13.5px] font-medium leading-5 text-[color:var(--st-text)]">
                    {member.display_name}
                  </span>
                  <span className="ml-2 font-data text-[11.5px] text-[color:var(--st-text-muted)]">
                    @{member.username ?? '—'}
                  </span>
                </div>
                {chip && <AdminChip tone={chip.tone}>{chip.label}</AdminChip>}
              </AdminListRow>
            )
          })}
        </AdminList>
      )}
    </AdminSection>
  )
}

/** Audit rows carry no avatar, so the queue skeleton would misrepresent
 *  the layout — this one is two text lines per row instead. */
function ActivitySkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden className="divide-y divide-[color:var(--st-border)]">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="px-4 py-3">
          <Skeleton className="h-3.5 w-72 max-w-[85%]" />
          <Skeleton className="mt-2 h-3 w-48 max-w-[60%]" />
        </div>
      ))}
    </div>
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
    <AdminSection
      title="Recent activity"
      description="The last eight staff actions across the console."
      action={
        <Link href="/admin/audit" className={QUIET_LINK}>
          View full log
        </Link>
      }
      flush
    >
      {!loaded ? (
        <ActivitySkeleton />
      ) : entries.length === 0 ? (
        <AdminEmpty
          title="No staff actions recorded yet."
          hint="Reason-gated actions land here as they happen."
        />
      ) : (
        <AdminList>
          {entries.map((entry) => (
            <AdminListRow key={entry.id}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] leading-5">
                  <span className="shrink-0 font-data text-[11px] text-[color:var(--st-text-faint)]">
                    {formatDate(entry.created_at)}
                  </span>
                  <span className="text-[color:var(--st-text-muted)]">
                    @{entry.admin_username ?? `#${entry.admin_user_id ?? '?'}`}
                  </span>
                  <span className="font-data text-[12px] font-medium text-[color:var(--st-text)]">
                    {entry.action}
                  </span>
                  {entry.target_user_id !== null && (
                    <Link
                      href={`/admin/users/${entry.target_user_id}`}
                      className="text-[color:var(--st-text)] underline-offset-2 hover:underline"
                    >
                      @{entry.target_username ?? `#${entry.target_user_id}`}
                    </Link>
                  )}
                </p>
                {entry.reason && (
                  <p className="mt-0.5 truncate text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                    {entry.reason}
                  </p>
                )}
              </div>
            </AdminListRow>
          ))}
        </AdminList>
      )}
    </AdminSection>
  )
}

export default function AdminHomePage() {
  const me = useAdmin()
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Overview"
        description="Every action is reason-gated and written to the audit log."
      />
      <UserSearchSection />
      <NeedsAttentionSection />
      {me.role === 'owner' && <StaffSection />}
      <RecentActivitySection />
    </div>
  )
}
