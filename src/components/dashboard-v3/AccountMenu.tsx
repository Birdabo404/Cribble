'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { tierAccent } from '@/components/dashboard-v2/format'
import type { ActiveDevice, MeUser } from '@/types/dashboard'

/* ---------- icons (14px, stroke) ---------- */

function Icon({ d, className = 'h-3.5 w-3.5' }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  profile: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  award:
    'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M8.21 13.89 7 23l5-3 5 3-1.21-9.12',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  crown: 'M2 20h20 M4 20 2 7l5.5 4L12 4l4.5 7L22 7l-2 13z',
  team: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  privacy:
    'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M12 8v4 M12 15h.01',
  signout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9'
}

/* ---------- dropdown ---------- */

export function AccountMenu({
  user,
  onLogout,
  variant = 'pill'
}: {
  user: MeUser
  /** Accepted for nav-shell API compatibility; the device panel now lives
   *  at /settings/account. */
  activeDevice: ActiveDevice | null
  onLogout: () => void
  /** 'pill' = avatar pill for the top bar; 'rail' = command-rail row with a
   *  menu flying out to the right. */
  variant?: 'pill' | 'rail'
}) {
  const [open, setOpen] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const staffCheckedRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Staff check is lazy (first menu open only) and self-scoped: the
  // endpoint 403s for regular users and only ever reveals the caller's
  // own role, so nothing about other admins leaks to the client.
  useEffect(() => {
    if (!open || staffCheckedRef.current) return
    staffCheckedRef.current = true
    fetch('/api/admin/me', { credentials: 'include' })
      .then((res) => setIsStaff(res.ok))
      .catch(() => setIsStaff(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const itemCls =
    'group w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-[11px] tracking-[0.2em] text-zinc-300 hover:text-zinc-50 hover:bg-white/[0.05] transition-colors'
  // Icons sit quiet in zinc and only take the accent on their own row's
  // hover — a wall of accent-tinted glyphs read as noise.
  const iconCls = 'text-zinc-500 transition-colors group-hover:text-accent'
  const arrowCls = 'ml-auto text-zinc-600 transition-colors group-hover:text-zinc-300'

  const avatar = (sizeCls: string) =>
    user.twitter_profile_image ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.twitter_profile_image}
        alt={user.twitter_username}
        className={`${sizeCls} rounded-full border border-zinc-800 object-cover`}
      />
    ) : (
      <div className={`${sizeCls} rounded-full border border-zinc-800 bg-zinc-900`} />
    )

  const menuPlacementCls =
    variant === 'rail'
      ? 'absolute top-0 left-full ml-3 w-64 origin-top-left'
      : 'absolute right-0 top-full mt-2 w-64 origin-top-right'
  const menuAnimation =
    variant === 'rail'
      ? 'glass-pop-in-side 180ms cubic-bezier(0.22, 1, 0.36, 1) backwards'
      : 'glass-pop-in 180ms cubic-bezier(0.22, 1, 0.36, 1) backwards'

  return (
    <div ref={rootRef} className="relative">
      {variant === 'rail' ? (
        <button
          onClick={() => setOpen((v) => !v)}
          className={`nav-row relative mx-2 flex h-10 w-[calc(100%-16px)] shrink-0 items-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${
            open
              ? 'bg-white/[0.06] text-zinc-100'
              : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100 active:bg-white/[0.08]'
          }`}
          aria-label="Open account menu"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className="flex w-12 shrink-0 items-center justify-center">
            {avatar('h-6 w-6')}
          </span>
          <span className="nav-label-clip">
            <span className="nav-label">
              <span className="truncate text-[10px] tracking-[0.25em] text-zinc-200">
                @{user.twitter_username || 'user'}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                className={`ml-auto mr-4 h-3 w-3 shrink-0 text-zinc-500 transition-transform duration-200 ${
                  open ? 'rotate-180' : ''
                }`}
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
                />
              </svg>
            </span>
          </span>
          <span className="nav-tip glass-pop rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.3em] text-zinc-200">
            @{user.twitter_username || 'user'}
          </span>
        </button>
      ) : (
        /* Split pill: the identity half is a straight link to the profile,
           only the chevron half opens the menu. */
        <div
          className={`flex items-stretch overflow-hidden rounded-full border bg-zinc-950/70 transition-colors duration-150 ${
            open ? 'border-zinc-500' : 'border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            title="View profile"
            aria-label="View profile"
            className="flex items-center py-1 pl-1 pr-1.5 transition-colors duration-150 hover:bg-zinc-900/80 active:bg-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-500"
          >
            {avatar('h-8 w-8')}
          </Link>
          <span className="my-2 w-px shrink-0 bg-zinc-800" aria-hidden />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Open account menu"
            aria-expanded={open}
            aria-haspopup="menu"
            className={`flex items-center pl-2 pr-2.5 transition-colors duration-150 hover:bg-zinc-900/80 active:bg-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-500 ${
              open ? 'bg-zinc-900/80 text-zinc-300' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              aria-hidden
            >
              <path
                fill="currentColor"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
              />
            </svg>
          </button>
        </div>
      )}

      {open && (
        <div
          role="menu"
          className={`${menuPlacementCls} rounded-xl glass-pop overflow-hidden z-50`}
          style={{ animation: menuAnimation }}
        >
          {/* identity strip */}
          <div className="flex items-center gap-3 px-3.5 py-3 border-b border-white/[0.08]">
            {user.twitter_profile_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.twitter_profile_image}
                alt={user.twitter_username}
                className="h-9 w-9 rounded-full border border-zinc-800 object-cover"
              />
            ) : (
              <div className="h-9 w-9 rounded-full border border-zinc-800 bg-zinc-900" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs text-zinc-50 truncate">
                {user.twitter_name || user.twitter_username || 'User'}
              </div>
              <div className="text-[10px] text-zinc-500 truncate">
                @{user.twitter_username || 'user'}
              </div>
            </div>
            <span
              className={`text-[8px] tracking-[0.25em] px-1.5 py-0.5 rounded border shrink-0 ${tierAccent(user.subscription_tier)}`}
            >
              {(user.subscription_tier || 'FREE').toUpperCase()}
            </span>
          </div>

          <div className="py-1.5">
            <Link
              href={
                user.twitter_username
                  ? `/u/${encodeURIComponent(user.twitter_username)}`
                  : '/profile'
              }
              onClick={() => setOpen(false)}
              role="menuitem"
              className={itemCls}
            >
              <span className={iconCls}>
                <Icon d={ICONS.profile} />
              </span>
              PROFILE
              <span className={arrowCls}>→</span>
            </Link>
            <Link
              href="/dashboard/achievements"
              onClick={() => setOpen(false)}
              role="menuitem"
              className={itemCls}
            >
              <span className={iconCls}>
                <Icon d={ICONS.award} />
              </span>
              ACHIEVEMENTS
              <span className={arrowCls}>→</span>
            </Link>
            {/* Company accounts get their roster console; the row is
                invisible to every other tier (same gating as the nav). */}
            {user.subscription_tier === 'TEAM' && (
              <Link
                href="/team"
                onClick={() => setOpen(false)}
                role="menuitem"
                className="group w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-[11px] tracking-[0.2em] text-zinc-300 hover:text-zinc-50 hover:bg-yellow-300/[0.06] transition-colors"
              >
                <span className="text-zinc-500 transition-colors group-hover:text-yellow-300">
                  <Icon d={ICONS.team} />
                </span>
                TEAM CONSOLE
                <span className={arrowCls}>→</span>
              </Link>
            )}
            <Link
              href="/settings/account"
              onClick={() => setOpen(false)}
              role="menuitem"
              className={itemCls}
            >
              <span className={iconCls}>
                <Icon d={ICONS.settings} />
              </span>
              SETTINGS
              <span className={arrowCls}>→</span>
            </Link>
            <Link
              href="/settings/billing"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="group w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-[11px] tracking-[0.2em] text-zinc-300 hover:text-zinc-50 hover:bg-amber-300/[0.06] transition-colors"
            >
              <span className="text-zinc-500 transition-colors group-hover:text-amber-300">
                <Icon d={ICONS.crown} />
              </span>
              CRIBBLE PREMIUM
              <span className={arrowCls}>→</span>
            </Link>
            <Link
              href="/settings/privacy"
              onClick={() => setOpen(false)}
              role="menuitem"
              className={itemCls}
            >
              <span className={iconCls}>
                <Icon d={ICONS.privacy} />
              </span>
              PRIVACY & SECURITY
              <span className={arrowCls}>→</span>
            </Link>
            {isStaff && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                role="menuitem"
                className={itemCls}
              >
                <span className={iconCls}>
                  <Icon d={ICONS.shield} />
                </span>
                ADMIN PANEL
                <span className={arrowCls}>→</span>
              </Link>
            )}
          </div>

          <div className="border-t border-white/[0.08] py-1.5">
            <button
              role="menuitem"
              onClick={onLogout}
              className="group w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-[11px] tracking-[0.2em] text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 transition-colors"
            >
              <span className="text-rose-400/60 transition-colors group-hover:text-rose-300">
                <Icon d={ICONS.signout} />
              </span>
              SIGN OUT
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
