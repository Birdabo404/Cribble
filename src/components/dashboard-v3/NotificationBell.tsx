'use client'

// Header notification bell + comms-console feed. Persistent notifications
// (rank buckets, milestones, season updates, future social events) live
// here; ephemeral sync confirmations stay in the toast stack.
//
// The panel is styled as a solid instrument (.comms-console), not floating
// glass: it opens over arbitrary page content and needs to read as its own
// surface. Entries are grouped by day (TODAY / YESTERDAY / …) with compact
// right-aligned timestamps, log-style.
//
// Read model: opening the panel snapshots which items are unread (so their
// "new" styling survives the mark-read call), then marks everything read —
// the badge clears on open, social-media style.

import { useEffect, useRef, useState } from 'react'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { useNotifications } from '@/hooks/useNotifications'
import { ACHIEVEMENTS_BY_ID } from '@/lib/achievements'
import type { AppNotification, NotificationType } from '@/types/notifications'

// Mirrors FEED_LIMIT in /api/user/notifications — at cap the footer says
// the log is truncated instead of implying this is everything.
const FEED_CAP = 30

const ICON_PATHS = {
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
  trendingUp: 'M22 7 13.5 15.5 8.5 10.5 2 17 M16 7h6v6',
  trendingDown: 'M22 17 13.5 8.5 8.5 13.5 2 7 M16 17h6v-6',
  trophy:
    'M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22 M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22 M18 2H6v7a6 6 0 0 0 12 0V2z',
  award:
    'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M8.21 13.89 7 23l5-3 5 3-1.21-9.12',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7',
  users:
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  info: 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z M12 16v-4 M12 8h.01',
  crown: 'M2 20h20 M4 20 2 7l5.5 4L12 4l4.5 7L22 7l-2 13z',
  truck:
    'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2 M15 18H9 M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14 M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'
}

interface TypeMeta {
  icon: string
  cls: string
}

function typeMeta(type: NotificationType, data: Record<string, unknown>): TypeMeta {
  switch (type) {
    case 'rank':
      // Rank covers both directions; demotions flip to a red down-arrow.
      return data.kind === 'demotion'
        ? { icon: ICON_PATHS.trendingDown, cls: 'text-red-400' }
        : { icon: ICON_PATHS.trendingUp, cls: 'text-accent' }
    case 'milestone':
      return { icon: ICON_PATHS.trophy, cls: 'text-amber-300' }
    case 'achievement':
      return { icon: ICON_PATHS.award, cls: 'text-accent' }
    case 'season':
      return { icon: ICON_PATHS.flag, cls: 'text-accent' }
    case 'social':
      // Referral rewards are points events — accent, not follow-cyan.
      return data.kind === 'referral'
        ? { icon: ICON_PATHS.users, cls: 'text-accent' }
        : { icon: ICON_PATHS.users, cls: 'text-cyan-300' }
    case 'premium':
      // Unreachable in practice — NotificationGlyph intercepts 'premium'
      // and renders the pixel blue check. Kept so the switch stays
      // exhaustive; the crown is the nominal fallback.
      return { icon: ICON_PATHS.crown, cls: 'text-amber-300' }
    case 'shop':
      // Purchase ack + delivered both ride the red delivery truck.
      return { icon: ICON_PATHS.truck, cls: 'text-red-400' }
    case 'system':
      return { icon: ICON_PATHS.info, cls: 'text-zinc-400' }
    default: {
      const exhaustive: never = type
      return exhaustive
    }
  }
}

/** Log-style compact age: NOW → 5M → 2H → 3D → 2W. */
function shortTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'NOW'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}M`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}H`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}D`
  return `${Math.floor(diff / (7 * 86_400_000))}W`
}

interface FeedGroup {
  label: string
  items: AppNotification[]
}

/** Day buckets for the log. Input arrives newest-first, so consecutive
 *  runs of the same label fold into one group. */
function groupFeed(items: AppNotification[]): FeedGroup[] {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const startOfToday = midnight.getTime()
  const DAY = 86_400_000

  const labelFor = (iso: string): string => {
    const t = new Date(iso).getTime()
    if (t >= startOfToday) return 'TODAY'
    if (t >= startOfToday - DAY) return 'YESTERDAY'
    if (t >= startOfToday - 6 * DAY) return 'THIS WEEK'
    return 'EARLIER'
  }

  const groups: FeedGroup[] = []
  for (const n of items) {
    const label = labelFor(n.created_at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(n)
    else groups.push({ label, items: [n] })
  }
  return groups
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

/**
 * Feed glyph. Achievement unlocks render their own pixel badge in the
 * rarity hue (matching the achievements page) and premium grants render
 * the pixel blue check; every other type keeps its stroke icon — graph
 * for rank, trophy for milestones, flag for season updates. Read rows
 * dim their tile so fresh signals carry the column.
 */
function NotificationGlyph({
  notification,
  dimmed
}: {
  notification: AppNotification
  dimmed: boolean
}) {
  const tileCls = `mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] glass-inset-lite ${
    dimmed ? 'opacity-70' : ''
  }`

  if (notification.type === 'premium') {
    return (
      <span className={tileCls}>
        <VerifiedBadge size={16} />
      </span>
    )
  }

  if (notification.type === 'achievement') {
    const def = ACHIEVEMENTS_BY_ID.get(String(notification.data?.achievementId ?? ''))
    if (def) {
      return (
        <span className={tileCls} style={{ color: `rgb(var(--r-${def.rarity}))` }}>
          <PixelIcon name={def.icon} size={18} />
        </span>
      )
    }
  }

  const meta = typeMeta(notification.type, notification.data)
  return (
    <span className={`${tileCls} ${meta.cls}`}>
      <StrokeIcon d={meta.icon} className="h-4 w-4" />
    </span>
  )
}

/** Shimmer placeholder while the first fetch is in flight. */
function FeedSkeleton() {
  return (
    <div className="px-4 py-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse items-start gap-3 py-3">
          <span className="h-8 w-8 shrink-0 rounded-[9px] bg-white/[0.05]" />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="h-2.5 w-1/2 rounded bg-white/[0.07]" />
            <div className="mt-2 h-2 w-11/12 rounded bg-white/[0.04]" />
            <div className="mt-1.5 h-2 w-3/5 rounded bg-white/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Inbox-zero radar: slow accent sweep inside hairline rings. */
function EmptyFeed() {
  return (
    <div className="px-6 py-12 text-center">
      <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-white/[0.07]" aria-hidden />
        <span className="absolute inset-[15px] rounded-full border border-white/[0.09]" aria-hidden />
        <span
          className="comms-radar-sweep absolute inset-[1px] rounded-full opacity-60"
          aria-hidden
        />
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full glass-inset-lite text-accent">
          <StrokeIcon d={ICON_PATHS.bell} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-4 text-[10px] tracking-[0.35em] text-zinc-200">ALL CLEAR</div>
      <p className="mx-auto mt-2 max-w-[240px] text-[11px] leading-relaxed text-zinc-500">
        Rank changes, achievements, and season milestones will land here.
      </p>
    </div>
  )
}

export function NotificationBell({
  variant = 'chip',
  placement = 'bottom'
}: {
  /** 'chip' = standalone bordered button (top bar); 'rail' = command-rail row. */
  variant?: 'chip' | 'rail'
  /** Panel anchor: below the trigger, or flying out to its right (rail). */
  placement?: 'bottom' | 'side'
}) {
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

  const ariaLabel =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'

  // Bottom placement: dropdown on sm+, near-full-width sheet under the top
  // bar on phones (an anchored 340px dropdown was cramped and clipped).
  // The top bar's backdrop-filter makes it the containing block for the
  // fixed sheet, but since the bar spans the viewport the inset works out.
  const panelPlacementCls =
    placement === 'side'
      ? 'absolute top-0 left-full z-50 ml-3 w-[400px] origin-top-left max-h-[min(560px,calc(100vh-260px))]'
      : 'fixed inset-x-3 top-[4.25rem] z-50 origin-top-right max-h-[calc(100dvh-9rem)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[min(92vw,400px)] sm:max-h-[min(640px,calc(100vh-6.5rem))]'
  const panelAnimation =
    placement === 'side'
      ? 'glass-pop-in-side 200ms cubic-bezier(0.22, 1, 0.36, 1) backwards'
      : 'glass-pop-in 200ms cubic-bezier(0.22, 1, 0.36, 1) backwards'

  const groups = groupFeed(notifications)
  const freshCount = freshIds.size
  // Stagger index across all groups, capped so deep feeds don't crawl in.
  let rowIndex = 0

  return (
    <div ref={rootRef} className="relative">
      {variant === 'rail' ? (
        <button
          onClick={toggle}
          className={`nav-row relative mx-2 flex h-10 w-[calc(100%-16px)] shrink-0 items-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${
            open
              ? 'bg-white/[0.06] text-zinc-100'
              : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100 active:bg-white/[0.08]'
          }`}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span className="relative flex w-12 shrink-0 items-center justify-center">
            <StrokeIcon d={ICON_PATHS.bell} className="h-[17px] w-[17px]" />
            {unreadCount > 0 && (
              <span className="absolute right-2 top-1 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-accent px-[3px] text-[8px] font-bold leading-none text-black">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </span>
          <span className="nav-label-clip">
            <span className="nav-label text-[10px] tracking-[0.25em]">
              NOTIFICATIONS
              {unreadCount > 0 && (
                <span className="ml-auto pr-4 text-[9px] tracking-[0.1em] text-accent/80">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </span>
          </span>
          <span className="nav-tip glass-pop rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.3em] text-zinc-200">
            NOTIFICATIONS{unreadCount > 0 ? ` · ${unreadCount > 9 ? '9+' : unreadCount}` : ''}
          </span>
        </button>
      ) : (
        <button
          onClick={toggle}
          className={`relative flex items-center justify-center px-2.5 py-[5px] rounded border transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${
            open
              ? 'border-zinc-500 bg-white/[0.06] text-zinc-100'
              : 'border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:bg-white/[0.04] hover:text-zinc-100 active:bg-white/[0.07]'
          }`}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <StrokeIcon d={ICON_PATHS.bell} className="h-3.5 w-3.5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-[3px] text-[8px] font-bold leading-none text-black">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={`${panelPlacementCls} comms-console flex flex-col overflow-hidden rounded-2xl`}
          style={{ animation: panelAnimation }}
        >
          {/* status strip — scanline band, live dot, fresh counter */}
          <div className="comms-scanlines flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]" />
              <span className="text-[10px] tracking-[0.4em] text-zinc-200">NOTIFICATIONS</span>
            </div>
            {freshCount > 0 ? (
              <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-[3px] text-[8px] leading-none tracking-[0.25em] text-accent">
                {freshCount} NEW
              </span>
            ) : (
              <span className="text-[8px] tracking-[0.3em] text-zinc-600">
                {loading && notifications.length === 0
                  ? 'SYNCING'
                  : notifications.length > 0
                    ? `${notifications.length} LOGGED`
                    : 'STANDBY'}
              </span>
            )}
          </div>

          <div className="comms-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading && notifications.length === 0 ? (
              <FeedSkeleton />
            ) : notifications.length === 0 ? (
              <EmptyFeed />
            ) : (
              groups.map((group) => (
                <section key={group.label}>
                  {/* sticky day marker — solid ink so rows slide beneath it */}
                  <div
                    className="sticky top-0 z-10 flex items-center gap-3 px-4 pb-1.5 pt-3"
                    style={{ background: 'var(--console-ink)' }}
                  >
                    <span className="text-[8px] tracking-[0.35em] text-zinc-500">
                      {group.label}
                    </span>
                    <span className="h-px flex-1 bg-white/[0.06]" aria-hidden />
                  </div>

                  {group.items.map((n) => {
                    const fresh = isNew(n.id, n.read_at)
                    const delay = `${Math.min(rowIndex++, 8) * 26}ms`
                    // Social events deep-link to the actor's profile so a
                    // "started following you" lands one click from FOLLOW BACK.
                    const actorUsername =
                      n.type === 'social' && typeof n.data?.username === 'string'
                        ? n.data.username
                        : null
                    const rowCls = `comms-row-in relative flex items-start gap-3 border-b border-white/[0.045] px-4 py-3 last:border-b-0 ${
                      fresh ? 'bg-accent/[0.045]' : ''
                    }`
                    const content = (
                      <>
                        {/* unread signal bar */}
                        {fresh && (
                          <span
                            className="absolute inset-y-1.5 left-0 w-[2px] rounded-r-full bg-accent shadow-[0_0_10px_rgb(var(--accent-rgb)/0.55)]"
                            aria-hidden
                          />
                        )}
                        <NotificationGlyph notification={n} dimmed={!fresh} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-3">
                            <span
                              className={`truncate text-[10px] tracking-[0.22em] ${
                                fresh ? 'text-zinc-50' : 'text-zinc-300'
                              }`}
                            >
                              {n.title}
                            </span>
                            <span
                              className={`ml-auto shrink-0 text-[8px] tabular-nums tracking-[0.2em] ${
                                fresh ? 'text-accent/80' : 'text-zinc-600'
                              }`}
                            >
                              {shortTime(n.created_at)}
                            </span>
                          </div>
                          {n.body && (
                            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                              {n.body}
                            </p>
                          )}
                        </div>
                      </>
                    )
                    return actorUsername ? (
                      <a
                        key={n.id}
                        href={`/u/${encodeURIComponent(actorUsername)}`}
                        style={{ animationDelay: delay }}
                        className={`${rowCls} transition-colors ${
                          fresh ? 'hover:bg-accent/[0.08]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        {content}
                      </a>
                    ) : (
                      <div key={n.id} style={{ animationDelay: delay }} className={rowCls}>
                        {content}
                      </div>
                    )
                  })}
                </section>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <div className="shrink-0 border-t border-white/[0.07] px-4 py-2 text-center text-[8px] tracking-[0.4em] text-zinc-600">
              {notifications.length >= FEED_CAP ? `LAST ${FEED_CAP} SHOWN` : 'END OF FEED'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
