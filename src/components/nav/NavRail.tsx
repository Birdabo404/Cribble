'use client'

// Command rail — the left-hand navigation dock. Collapsed it is a 64px
// icon strip; expanded it grows to 232px with labels sliding in. The width
// lives in a CSS variable flipped by data-nav-exp on <html>, so the rail
// and the page inset animate from the same source and can never drift.
//
// Every row shares one skeleton: a constant 48px icon column plus a
// clipped label area (.nav-label-clip). Icons never move during the
// expand/collapse; labels fade/slide inside the clip. Collapsed rows grow
// a glass tooltip flyout (hidden via CSS while expanded).

import { useEffect, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatRelative } from '@/components/dashboard-v2/format'
import { AccountMenu } from '@/components/dashboard-v3/AccountMenu'
import { NotificationBell } from '@/components/dashboard-v3/NotificationBell'
import { LiquidMark } from '@/components/brand/LiquidMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { FeedbackIcon } from '@/components/feedback/FeedbackLauncher'
import { useFeedback } from '@/components/feedback/FeedbackContext'
import { animDelay } from '@/components/dashboard-v3/anim'
import { NavIcon } from './NavIcon'
import { connectionMeta, useNavStatus, type NavStatus } from './NavStatusContext'
import { useNavPrefs } from './NavPrefsContext'
import { isNavItemActive, visibleNavItems, type NavItemDef } from './navItems'
import { UserSearch } from './UserSearch'
import type { NavUserState } from './useNavUser'

const ROW_BASE =
  'nav-row relative mx-2 flex h-10 shrink-0 items-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500'
const ROW_IDLE =
  'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] active:bg-white/[0.08]'
const ROW_ACTIVE = 'text-zinc-50 bg-white/[0.06]'

function RowTip({ children }: { children: React.ReactNode }) {
  return (
    <span className="nav-tip glass-pop rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.3em] text-zinc-200">
      {children}
    </span>
  )
}

function SyncRow({ status }: { status: NavStatus }) {
  const meta = connectionMeta(status.connection)
  const live = status.connection === 'online'
  return (
    <button
      type="button"
      onClick={status.onSync}
      disabled={status.syncing}
      className={`${ROW_BASE} ${ROW_IDLE} w-[calc(100%-16px)] disabled:opacity-60`}
      aria-label={`Sync now (${meta.label.toLowerCase()})`}
    >
      <span className="relative flex w-12 shrink-0 items-center justify-center">
        <NavIcon
          name="sync"
          className={`h-[17px] w-[17px] ${status.syncing ? 'animate-spin' : ''}`}
        />
        {/* dot only while the extension link is live — an always-on status
            dot reads as an unexplained alert */}
        {live && (
          <span className="absolute right-2.5 top-2 h-1.5 w-1.5 rounded-full bg-accent" />
        )}
      </span>
      <span className="nav-label-clip">
        <span className="nav-label text-[10px] tracking-[0.25em]">
          {status.syncing ? 'SYNCING…' : 'SYNC'}
          <span className="ml-auto pr-4 text-[9px] tracking-[0.1em] text-zinc-500">
            {formatRelative(status.lastSync)}
          </span>
        </span>
      </span>
      <RowTip>
        SYNC · {meta.label}
      </RowTip>
    </button>
  )
}

function FeedbackRow() {
  const { openFeedback } = useFeedback()
  return (
    <button
      type="button"
      onClick={openFeedback}
      aria-haspopup="dialog"
      aria-label="Send feedback"
      className={`${ROW_BASE} ${ROW_IDLE} w-[calc(100%-16px)]`}
    >
      <span className="flex w-12 shrink-0 items-center justify-center text-accent/80">
        <FeedbackIcon className="h-[17px] w-[17px]" />
      </span>
      <span className="nav-label-clip">
        <span className="nav-label text-[10px] tracking-[0.25em]">FEEDBACK</span>
      </span>
      <RowTip>FEEDBACK</RowTip>
    </button>
  )
}

export function NavRail({
  navUser,
  markStill = false
}: {
  navUser: NavUserState
  /** True while the rail is CSS-hidden (below md) — the wordmark renders
      its static image instead of holding a live WebGL shader offscreen. */
  markStill?: boolean
}) {
  const prefs = useNavPrefs()
  const pathname = usePathname()
  const status = useNavStatus()
  const expanded = prefs?.expanded ?? false

  // "[" toggles the rail, Linear/Slack style. Ignored while typing.
  useEffect(() => {
    if (!prefs) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      prefs.toggleExpanded()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prefs])

  // Any click on rail chrome that isn't a link/button toggles the width —
  // the whole surface is the expand/collapse affordance.
  const onRailClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('a, button')) return
    prefs?.toggleExpanded()
  }

  // Tier-gated set: TEAM-only rows appear once the session user loads
  // with the TEAM tier and never for anyone else.
  const navItems = visibleNavItems(navUser.user)

  const renderItem = (item: NavItemDef, i: number) => {
    const active = isNavItemActive(item, pathname)
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`${ROW_BASE} anim-rise ${active ? ROW_ACTIVE : ROW_IDLE}`}
        style={animDelay(80 + i * 50)}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-accent" />
        )}
        <span className="flex w-12 shrink-0 items-center justify-center">
          <NavIcon name={item.icon} className="h-[17px] w-[17px]" />
        </span>
        <span className="nav-label-clip">
          <span className="nav-label text-[10px] tracking-[0.25em]">{item.label}</span>
        </span>
        <RowTip>{item.label}</RowTip>
      </Link>
    )
  }

  return (
    <aside
      onClick={onRailClick}
      className="app-nav-rail app-nav-glass-rail app-nav-enter-left fixed inset-y-0 left-0 z-40 hidden md:flex cursor-pointer flex-col"
      aria-label="Primary navigation"
    >
      {/* wordmark — doubles as the expand/collapse toggle. The liquid-metal
          hive mark holds the icon column in both widths; the "CRIBBLE."
          label slides in beside it when expanded. */}
      <div className="relative h-14 shrink-0 overflow-hidden border-b border-white/[0.06]">
        <button
          type="button"
          onClick={() => prefs?.toggleExpanded()}
          aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
          aria-expanded={expanded}
          title="Toggle nav · ["
          className="absolute inset-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-500"
        >
          <span className="absolute left-0 top-0 flex h-full w-16 items-center justify-center">
            <LiquidMark size={24} title="Cribble" still={markStill} />
          </span>
          <span className="nav-wordmark-full absolute left-14 top-0 flex h-full items-center whitespace-nowrap text-sm font-semibold tracking-[0.4em] text-zinc-100">
            CRIBBLE<span className="text-accent">.</span>
          </span>
        </button>
      </div>

      {/* one stack: account · profile · notifications · dashboard ·
          leaderboard · achievements — no divider, it's all one group */}
      <nav className="app-nav-rail-body flex min-h-0 flex-1 flex-col gap-1 py-3">
        {!navUser.loaded ? (
          <div className={`${ROW_BASE} pointer-events-none`}>
            <span className="flex w-12 shrink-0 items-center justify-center">
              <span className="h-7 w-7 animate-pulse rounded-full border border-zinc-800 bg-zinc-900" />
            </span>
          </div>
        ) : navUser.user ? (
          <AccountMenu
            user={navUser.user}
            activeDevice={navUser.activeDevice}
            onLogout={navUser.logout}
            variant="rail"
          />
        ) : (
          <Link href="/login" className={`${ROW_BASE} ${ROW_IDLE}`}>
            <span className="flex w-12 shrink-0 items-center justify-center text-accent/80">
              <NavIcon name="signIn" className="h-[17px] w-[17px]" />
            </span>
            <span className="nav-label-clip">
              <span className="nav-label text-[10px] tracking-[0.25em]">SIGN IN</span>
            </span>
            <RowTip>SIGN IN</RowTip>
          </Link>
        )}
        {renderItem(navItems[0], 1)}
        <UserSearch variant="rail" />
        <NotificationBell variant="rail" placement="side" />
        {navItems.slice(1).map((item, i) => renderItem(item, i + 3))}
      </nav>

      {/* utility cluster */}
      <div className="shrink-0 space-y-1 border-t border-white/[0.06] py-2">
        {status && <SyncRow status={status} />}
        <FeedbackRow />
        <ThemeToggle variant="rail" />
      </div>
    </aside>
  )
}
