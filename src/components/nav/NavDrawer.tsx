'use client'

// Mobile slide-over navigation. Always mounted (the shell layout persists
// across route changes) so open/close both run as CSS transitions; items
// cascade in with per-row transition delays once the panel is open.

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatRelative } from '@/components/dashboard-v2/format'
import { LiquidMark } from '@/components/brand/LiquidMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { NavIcon } from './NavIcon'
import { connectionMeta, useNavStatus } from './NavStatusContext'
import { NAV_ITEMS, isNavItemActive } from './navItems'
import type { NavUserState } from './useNavUser'

export function NavDrawer({
  open,
  onClose,
  navUser
}: {
  open: boolean
  onClose: () => void
  navUser: NavUserState
}) {
  const pathname = usePathname()
  const status = useNavStatus()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  // Delay staggers the entrance only — background/color hover transitions
  // stay at 0ms delay so rows respond instantly once the drawer is open.
  const itemState = (i: number) => {
    const delay = open ? `${100 + i * 40}ms` : '0ms'
    return {
      className: open ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0',
      delay: `${delay}, ${delay}, 0ms, 0ms`
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 md:hidden ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        aria-hidden
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={`glass-pop absolute inset-y-0 left-0 flex w-[280px] flex-col transition-transform duration-[440ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-4">
          <span className="flex items-center gap-2.5 text-sm font-semibold tracking-[0.4em] text-zinc-100">
            <LiquidMark size={20} />
            <span>
              CRIBBLE<span className="text-accent">.</span>
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex h-8 w-8 items-center justify-center rounded text-zinc-500 transition-colors duration-150 hover:bg-white/[0.05] hover:text-zinc-100 active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
          >
            <NavIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {NAV_ITEMS.map((item, i) => {
            const active = isNavItemActive(item, pathname)
            const state = itemState(i)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                style={{ transitionDelay: state.delay }}
                className={`relative mx-2 mb-1 flex h-11 items-center rounded-lg transition-[opacity,transform,background-color,color] duration-[300ms,300ms,150ms,150ms] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${state.className} ${
                  active
                    ? 'bg-white/[0.06] text-zinc-50'
                    : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100 active:bg-white/[0.08]'
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-accent" />
                )}
                <span className="flex w-12 shrink-0 items-center justify-center">
                  <NavIcon name={item.icon} className="h-[17px] w-[17px]" />
                </span>
                <span className="text-[10px] tracking-[0.3em]">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="shrink-0 space-y-3 border-t border-white/[0.08] p-4">
          {status && (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[9px] tracking-[0.25em] text-zinc-500">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${connectionMeta(status.connection).dotClass}`}
                />
                {connectionMeta(status.connection).label} · {formatRelative(status.lastSync)}
              </span>
              <button
                type="button"
                onClick={status.onSync}
                disabled={status.syncing}
                className="rounded border border-zinc-800 px-2.5 py-1 text-[9px] tracking-[0.3em] text-zinc-300 transition-[color,background-color,border-color,transform] duration-150 hover:border-zinc-600 hover:bg-white/[0.04] hover:text-zinc-100 active:scale-[0.98] active:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 disabled:opacity-50"
              >
                {status.syncing ? 'SYNCING…' : 'SYNC'}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <ThemeToggle />
            {navUser.loaded && navUser.user && (
              <button
                type="button"
                onClick={navUser.logout}
                className="text-[9px] tracking-[0.3em] text-rose-300 transition-colors hover:text-rose-200"
              >
                SIGN OUT
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
