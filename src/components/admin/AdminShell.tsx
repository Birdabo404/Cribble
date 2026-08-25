'use client'

// Staff console frame + access gate, mounted once by src/app/admin/layout.tsx.
// The layout survives client-side navigation between /admin pages, so
// /api/admin/me is fetched a single time: 401 bounces to /login, 403 or any
// failure renders the calm "Staff only" screen, success paints the chrome —
// desktop 220px sticky rail with grouped nav, mobile top bar + scrollable
// pills — and hands the staff identity to pages through context (useAdmin).
// While the gate resolves, the frame first-paints the rail chrome plus a
// skeleton main, never a centered loading string.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Skeleton } from '@/components/settings/Skeleton'
import { AdminChip, staffChipMeta } from './AdminChip'
import { AdminSkeletonList } from './AdminSkeletonList'

export interface StaffMe {
  userId: number
  username: string | null
  role: 'owner' | 'moderator'
}

type LoadState = 'loading' | 'ready' | 'forbidden'

const AdminMeContext = createContext<StaffMe | null>(null)

/**
 * Resolved staff identity for the current session. Safe in any component
 * rendered under /admin: AdminFrame only mounts page content after the
 * gate succeeds, so the value is always present there.
 */
export function useAdmin(): StaffMe {
  const me = useContext(AdminMeContext)
  if (!me) {
    throw new Error('useAdmin must be rendered inside AdminFrame (src/app/admin/layout.tsx)')
  }
  return me
}

/* ----------------------------------------------------------------------------
   Nav model — grouped rail items. ownerOnly hiding is cosmetic; the APIs
   behind those routes still 403 moderators.
---------------------------------------------------------------------------- */

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

const ICON_OVERVIEW = (
  <IconBase>
    <rect x="1.75" y="1.75" width="5.25" height="5.25" rx="1.1" />
    <rect x="9" y="1.75" width="5.25" height="5.25" rx="1.1" />
    <rect x="1.75" y="9" width="5.25" height="5.25" rx="1.1" />
    <rect x="9" y="9" width="5.25" height="5.25" rx="1.1" />
  </IconBase>
)

const ICON_FEEDBACK = (
  <IconBase>
    <path d="M8 2.25c3.45 0 6.25 2.35 6.25 5.25S11.45 12.75 8 12.75c-.6 0-1.18-.07-1.72-.2L3.2 13.9l.7-2.55C2.6 10.4 1.75 9.03 1.75 7.5c0-2.9 2.8-5.25 6.25-5.25Z" />
  </IconBase>
)

const ICON_TEAMS = (
  <IconBase>
    <circle cx="5.6" cy="5.4" r="2.15" />
    <path d="M1.9 13.25a3.7 3.7 0 0 1 7.4 0" />
    <path d="M10.3 3.5a2.15 2.15 0 0 1 0 3.8" />
    <path d="M11.6 9.7a3.7 3.7 0 0 1 2.5 3.55" />
  </IconBase>
)

const ICON_AUDIT = (
  <IconBase>
    <rect x="2.75" y="1.75" width="10.5" height="12.5" rx="1.5" />
    <path d="M5.25 5h5.5M5.25 8h5.5M5.25 11h3" />
  </IconBase>
)

const ICON_INVITES = (
  <IconBase>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
    <path d="m2.5 4.5 5.5 4.25L13.5 4.5" />
  </IconBase>
)

const ICON_WAITLIST = (
  <IconBase>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.75V8l2.25 1.5" />
  </IconBase>
)

const ICON_SPONSORSHIP = (
  <IconBase>
    <path d="M13.25 2.75 5.75 5.35H3.4c-.91 0-1.65.74-1.65 1.65v1.7c0 .91.74 1.65 1.65 1.65h2.35l7.5 2.6Z" />
    <path d="m6.5 10.6.55 2.65" />
  </IconBase>
)

const ICON_ANNOUNCEMENTS = (
  <IconBase>
    <circle cx="8" cy="8" r="1.4" />
    <path d="M10.6 5.4a4 4 0 0 1 0 5.2M5.4 10.6a4 4 0 0 1 0-5.2" />
    <path d="M12.75 3.25a7 7 0 0 1 0 9.5M3.25 12.75a7 7 0 0 1 0-9.5" />
  </IconBase>
)

const ICON_SEASONS = (
  <IconBase>
    <rect x="1.75" y="3.25" width="12.5" height="11" rx="1.5" />
    <path d="M1.75 6.75h12.5M5.25 1.75v3M10.75 1.75v3" />
  </IconBase>
)

const ICON_TRENDS = (
  <IconBase>
    <path d="M1.75 13.25h12.5" />
    <path d="m2.75 10.5 3.1-3.6 2.5 2 3.9-4.9" />
  </IconBase>
)

const ICON_BACK_TO_APP = (
  <IconBase>
    <path d="M9.75 2.75h2.15c.75 0 1.35.6 1.35 1.35v7.8c0 .75-.6 1.35-1.35 1.35H9.75" />
    <path d="M5.75 5.25 3 8l2.75 2.75M3 8h6.75" />
  </IconBase>
)

interface AdminNavItem {
  href: string
  label: string
  icon: ReactNode
  /** Cosmetic — the APIs behind these routes still 403 moderators. */
  ownerOnly?: boolean
}

interface AdminNavGroup {
  label: string
  items: readonly AdminNavItem[]
}

const NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    label: 'Review',
    items: [
      { href: '/admin', label: 'Overview', icon: ICON_OVERVIEW },
      { href: '/admin/feedback', label: 'Feedback', icon: ICON_FEEDBACK },
      { href: '/admin/teams', label: 'Teams', icon: ICON_TEAMS }
    ]
  },
  {
    label: 'People',
    items: [
      { href: '/admin/audit', label: 'Audit', icon: ICON_AUDIT },
      { href: '/admin/invites', label: 'Invites', icon: ICON_INVITES, ownerOnly: true },
      { href: '/admin/waitlist', label: 'Waitlist', icon: ICON_WAITLIST, ownerOnly: true }
    ]
  },
  {
    label: 'Product',
    items: [
      { href: '/admin/sponsorship', label: 'Sponsorship', icon: ICON_SPONSORSHIP },
      {
        href: '/admin/announcements',
        label: 'Announcements',
        icon: ICON_ANNOUNCEMENTS,
        ownerOnly: true
      },
      { href: '/admin/seasons', label: 'Seasons', icon: ICON_SEASONS, ownerOnly: true },
      { href: '/admin/trends', label: 'Trends', icon: ICON_TRENDS }
    ]
  }
]

function isNavActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Section title for the mobile top bar, derived from the pathname. The
 *  user dossier is not a rail item, so it gets a special case. */
function sectionLabel(pathname: string): string {
  if (pathname.startsWith('/admin/users')) return 'User'
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (isNavActive(pathname, item.href)) return item.label
    }
  }
  return 'Staff'
}

function visibleGroups(role: StaffMe['role']): AdminNavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.ownerOnly || role === 'owner')
  })).filter((group) => group.items.length > 0)
}

/* ----------------------------------------------------------------------------
   Chrome pieces
---------------------------------------------------------------------------- */

function BrandLockup() {
  return (
    <div className="flex items-center gap-2">
      <Link href="/admin" className="flex items-baseline gap-2 rounded-md">
        <span className="font-display text-[16px] font-semibold leading-6 tracking-tight text-[color:var(--st-text)]">
          Cribble<span className="text-accent">.</span>
        </span>
        <span className="font-data text-[10px] font-medium uppercase tracking-[0.16em] text-[color:var(--st-text-muted)]">
          Staff
        </span>
      </Link>
      {/* Live pulse — the one place the brand accent glows in the console. */}
      <span
        aria-hidden
        className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.5)]"
      />
    </div>
  )
}

function RoleChip({ role }: { role: StaffMe['role'] }) {
  const meta = staffChipMeta(role)
  if (!meta) return null
  return <AdminChip tone={meta.tone}>{meta.label}</AdminChip>
}

function RailNavLink({ item, active }: { item: AdminNavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] leading-5 transition-colors duration-150 ${
        active
          ? 'bg-[color:var(--st-panel-hover)] font-medium text-[color:var(--st-text)]'
          : 'text-[color:var(--st-text-muted)] hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)]'
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute bottom-1 left-0 top-1 w-0.5 rounded-full bg-[color:var(--st-text)]"
        />
      )}
      <span className="shrink-0">{item.icon}</span>
      {item.label}
    </Link>
  )
}

/** Desktop rail. While the gate resolves (me = null) it paints the brand
 *  lockup plus skeleton nav rows so first paint is chrome, not a spinner. */
function AdminRail({ me, pathname }: { me: StaffMe | null; pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[var(--ad-rail-w)] shrink-0 flex-col border-r border-[color:var(--st-border)] md:flex">
      <div className="px-4 pb-3 pt-5">
        <BrandLockup />
        <div className="mt-3">
          {me ? <RoleChip role={me.role} /> : <Skeleton className="h-[18px] w-16 rounded" />}
        </div>
      </div>

      <nav aria-label="Staff sections" className="flex-1 space-y-5 overflow-y-auto px-2.5 py-2">
        {me ? (
          visibleGroups(me.role).map((group) => (
            <div key={group.label}>
              <p className="px-2.5 pb-1 font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <RailNavLink key={item.href} item={item} active={isNavActive(pathname, item.href)} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col gap-1.5 px-2.5 pt-1" aria-hidden>
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-7 rounded-md" />
            ))}
          </div>
        )}
      </nav>

      <div className="border-t border-[color:var(--st-border)] px-2.5 py-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] leading-5 text-[color:var(--st-text-muted)] transition-colors duration-150 hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)]"
        >
          <span className="shrink-0">{ICON_BACK_TO_APP}</span>
          Back to app
        </Link>
      </div>
    </aside>
  )
}

/** Mobile (< md) top bar: mark + section title + role chip, then the
 *  horizontally scrollable nav pills (same pattern as settings tabs). */
function AdminMobileHeader({ me, pathname }: { me: StaffMe | null; pathname: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--st-border)] bg-[color:var(--st-canvas)] md:hidden">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <Link
          href="/admin"
          className="shrink-0 rounded-md font-display text-[15px] font-semibold leading-6 tracking-tight text-[color:var(--st-text)]"
        >
          Cribble<span className="text-accent">.</span>
        </Link>
        <span aria-hidden className="text-[13px] text-[color:var(--st-text-faint)]">
          /
        </span>
        <span className="truncate text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
          {sectionLabel(pathname)}
        </span>
        <div className="ml-auto shrink-0">
          {me ? <RoleChip role={me.role} /> : <Skeleton className="h-[18px] w-16 rounded" />}
        </div>
      </div>

      <nav
        aria-label="Staff sections"
        className="st-no-scrollbar flex snap-x gap-2 overflow-x-auto px-4 pb-3"
      >
        {me
          ? visibleGroups(me.role)
              .flatMap((group) => group.items)
              .map((item) => {
                const active = isNavActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex min-h-11 snap-start items-center whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium leading-5 transition-colors duration-150 ${
                      active
                        ? 'border-transparent bg-[color:var(--st-accent)] text-[color:var(--st-accent-contrast)]'
                        : 'border-[color:var(--st-border)] text-[color:var(--st-text-muted)] hover:text-[color:var(--st-text)]'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })
          : Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-24 shrink-0 rounded-full" />
            ))}
      </nav>
    </header>
  )
}

/** Main-column placeholder while the gate resolves: page-header lines plus
 *  a queue-shaped panel, matching the layout pages will paint. */
function FrameSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <div>
        <Skeleton className="h-6 w-44 max-w-full" />
        <Skeleton className="mt-2.5 h-3.5 w-80 max-w-full" />
      </div>
      <div className="overflow-hidden rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] shadow-[var(--st-panel-shadow)]">
        <AdminSkeletonList rows={6} />
      </div>
    </div>
  )
}

/** Calm centered 403 — same copy for every non-staff session. */
function ForbiddenScreen() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[17px] font-semibold leading-6 text-[color:var(--st-text)]">
        Staff only
      </h1>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-5 text-[color:var(--st-text-muted)]">
        Your account does not have access to the staff console.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 inline-flex h-8 items-center rounded-lg border border-[color:var(--st-border-strong)] px-3 text-[13px] font-medium leading-none text-[color:var(--st-text)] transition-colors duration-150 hover:bg-[color:var(--st-panel-hover)]"
      >
        Back to dashboard
      </Link>
    </main>
  )
}

/* ----------------------------------------------------------------------------
   Frame
---------------------------------------------------------------------------- */

export function AdminFrame({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [me, setMe] = useState<StaffMe | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
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
      } catch {
        if (!cancelled) setLoadState('forbidden')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [router])

  if (loadState === 'forbidden') {
    return <ForbiddenScreen />
  }

  return (
    <div className="flex min-h-screen">
      <AdminRail me={me} pathname={pathname} />
      <div className="min-w-0 flex-1">
        <AdminMobileHeader me={me} pathname={pathname} />
        {/* Pages own their root spacing. Queues need width — hence max-w-6xl. */}
        <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 md:px-8 md:pt-8">
          {loadState === 'ready' && me ? (
            <AdminMeContext.Provider value={me}>{children}</AdminMeContext.Provider>
          ) : (
            <FrameSkeleton />
          )}
        </main>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------------------
   Shared date formatting
---------------------------------------------------------------------------- */

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
