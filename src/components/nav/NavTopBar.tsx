'use client'

// Sticky top bar — the horizontal variant of the nav shell, and the
// fallback chrome on mobile (where the rail would be impractical). Keeps
// the terminal chip language of the original dashboard header; gains a
// scroll-aware glass edge so it reads as a surface once content slides
// underneath.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatRelative } from '@/components/dashboard-v2/format'
import { AccountMenu } from '@/components/dashboard-v3/AccountMenu'
import { NotificationBell } from '@/components/dashboard-v3/NotificationBell'
import { LiquidMark } from '@/components/brand/LiquidMark'
import { NavIcon } from './NavIcon'
import { connectionMeta, useNavStatus } from './NavStatusContext'
import { isNavItemActive, visibleNavItems } from './navItems'
import { NavDrawer } from './NavDrawer'
import { UserSearch, isUserSearchRoute } from './UserSearch'
import type { NavUserState } from './useNavUser'

const CHIP_BASE =
  'text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500'
const CHIP_IDLE =
  'border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:bg-white/[0.04] hover:text-zinc-100 active:bg-white/[0.07]'
const CHIP_ACTIVE = 'border-zinc-500 bg-white/[0.06] text-zinc-50'

export function NavTopBar({
  navUser,
  className = ''
}: {
  navUser: NavUserState
  className?: string
}) {
  const pathname = usePathname()
  const status = useNavStatus()
  const [scrolled, setScrolled] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the drawer whenever navigation lands somewhere new.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const meta = status ? connectionMeta(status.connection) : null

  return (
    <>
      <header
        data-scrolled={scrolled || undefined}
        className={`app-nav-topbar app-nav-enter-top fixed inset-x-0 top-0 z-40 ${className}`}
      >
        {/* max-width/padding pre-scaled by 0.9 to align with the page-zoom-out content */}
        <div className="mx-auto flex h-14 w-full max-w-[64.8rem] items-center gap-2 px-[1.35rem]">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="md:hidden -ml-1 flex h-8 w-8 items-center justify-center rounded border border-zinc-800 text-zinc-300 transition-[color,background-color,border-color,transform] duration-150 hover:border-zinc-600 hover:bg-white/[0.04] hover:text-zinc-100 active:scale-[0.98] active:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
          >
            <NavIcon name="menu" className="h-4 w-4" />
          </button>

          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-[0.4em] text-zinc-100 transition-opacity hover:opacity-80"
          >
            <LiquidMark size={20} />
            <span>
              CRIBBLE<span className="text-accent">.</span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <nav className="hidden items-center gap-2 md:flex" aria-label="Primary navigation">
              {visibleNavItems(navUser.user)
                .filter((item) => item.topBar)
                .map((item) => {
                  const active = isNavItemActive(item, pathname)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`${CHIP_BASE} ${active ? CHIP_ACTIVE : CHIP_IDLE}`}
                    >
                      {item.label}
                    </Link>
                  )
                })}
            </nav>

            {/* One sync control instead of a status pill + button pair: the
                connection dot rides inside the button, details in the title. */}
            {status && meta && (
              <button
                type="button"
                onClick={status.onSync}
                disabled={status.syncing}
                title={`${meta.label} · last sync ${formatRelative(status.lastSync)}`}
                className={`${CHIP_BASE} ${CHIP_IDLE} hidden items-center gap-2 sm:flex disabled:opacity-50`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                {status.syncing ? 'SYNCING…' : 'SYNC'}
              </button>
            )}

            {/* user search — an icon chip, and only where finding people is
                the page's job (profiles + leaderboard); everywhere else the
                bar stays clean */}
            {isUserSearchRoute(pathname) && <UserSearch variant="chip" />}

            <NotificationBell />

            {!navUser.loaded ? (
              /* mirrors the account pill footprint (avatar + chevron halves) */
              <span className="h-[42px] w-[77px] animate-pulse rounded-full border border-zinc-800 bg-zinc-900" />
            ) : navUser.user ? (
              <AccountMenu
                user={navUser.user}
                activeDevice={navUser.activeDevice}
                onLogout={navUser.logout}
              />
            ) : (
              <Link href="/login" className={`${CHIP_BASE} ${CHIP_IDLE} text-accent`}>
                SIGN IN
              </Link>
            )}
          </div>
        </div>
      </header>

      <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} navUser={navUser} />
    </>
  )
}
