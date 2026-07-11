'use client'

// Header notification bell + glass dropdown feed. Persistent notifications
// (rank buckets, milestones, season updates, future social events) live
// here; ephemeral sync confirmations stay in the toast stack.
//
// Read model: opening the panel snapshots which items are unread (so their
// "new" styling survives the mark-read call), then marks everything read —
// the badge clears on open, social-media style.

import { useEffect, useRef, useState } from 'react'
import { formatRelative } from '@/components/dashboard-v2/format'
import { useNotifications } from '@/hooks/useNotifications'
import type { NotificationType } from '@/types/notifications'

const ICON_PATHS = {
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
  trendingUp: 'M22 7 13.5 15.5 8.5 10.5 2 17 M16 7h6v6',
  trophy:
    'M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22 M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22 M18 2H6v7a6 6 0 0 0 12 0V2z',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7',
  users:
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  info: 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z M12 16v-4 M12 8h.01',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3'
}

interface TypeMeta {
  icon: string
  cls: string
}

function typeMeta(type: NotificationType): TypeMeta {
  switch (type) {
    case 'rank':
      return { icon: ICON_PATHS.trendingUp, cls: 'text-accent' }
    case 'milestone':
      return { icon: ICON_PATHS.trophy, cls: 'text-amber-300' }
    case 'season':
      return { icon: ICON_PATHS.flag, cls: 'text-accent' }
    case 'social':
      return { icon: ICON_PATHS.users, cls: 'text-cyan-300' }
    case 'system':
      return { icon: ICON_PATHS.info, cls: 'text-zinc-400' }
    default: {
      const exhaustive: never = type
      return exhaustive
    }
  }
}

function StrokeIcon({ d, className = 'h-3.5 w-3.5' }: { d: string; className?: string }) {
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

export function NotificationBell() {
  const { notifications, unreadCount, loading, refresh, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set())
  const rootRef = useRef<HTMLDivElement>(null)

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

  const toggle = () => {
    setOpen((wasOpen) => {
      const next = !wasOpen
      if (next) {
        setFreshIds(new Set(notifications.filter((n) => !n.read_at).map((n) => n.id)))
        if (unreadCount > 0) {
          void markAllRead().then(() => refresh())
        } else {
          void refresh()
        }
      }
      return next
    })
  }

  const isNew = (id: number, readAt: string | null) => freshIds.has(id) || !readAt

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={toggle}
        className={`relative flex items-center justify-center px-2.5 py-[5px] rounded border transition-colors ${
          open
            ? 'border-accent/50 text-zinc-100'
            : 'border-zinc-800 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100'
        }`}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
        }
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <StrokeIcon d={ICON_PATHS.bell} className="h-3.5 w-3.5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-[3px] text-[8px] font-bold leading-none text-black shadow-[0_0_10px_rgb(var(--accent-rgb)/0.6)]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-[min(88vw,340px)] origin-top-right overflow-hidden rounded-xl glass-pop"
          style={{ animation: 'glass-pop-in 180ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
        >
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]" />
              <span className="text-[10px] tracking-[0.4em] text-zinc-300">
                NOTIFICATIONS
              </span>
            </div>
            {freshIds.size > 0 && (
              <span className="text-[9px] tracking-[0.25em] text-accent/80">
                {freshIds.size} NEW
              </span>
            )}
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-[10px] tracking-[0.3em] text-zinc-500">
                LOADING…
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full liquid-glass-inset text-accent/70">
                  <StrokeIcon d={ICON_PATHS.check} className="h-4 w-4" />
                </span>
                <div className="mt-3 text-[10px] tracking-[0.3em] text-zinc-300">
                  ALL CLEAR
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                  Rank changes and season milestones will land here.
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                const meta = typeMeta(n.type)
                const fresh = isNew(n.id, n.read_at)
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 border-b border-white/[0.04] px-4 py-3 last:border-b-0 ${
                      fresh ? 'bg-accent/[0.04]' : ''
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg liquid-glass-inset ${meta.cls}`}
                    >
                      <StrokeIcon d={meta.icon} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[10px] tracking-[0.25em] text-zinc-100">
                          {n.title}
                        </span>
                        {fresh && (
                          <span className="h-1 w-1 shrink-0 rounded-full bg-accent shadow-[0_0_6px_rgb(var(--accent-rgb)/0.7)]" />
                        )}
                      </div>
                      {n.body && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                          {n.body}
                        </p>
                      )}
                      <div className="mt-1 text-[9px] tracking-[0.2em] text-zinc-600">
                        {formatRelative(n.created_at).toUpperCase()}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
