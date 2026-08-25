'use client'

// Header notification bell + feed panel. Persistent notifications
// (rank buckets, milestones, season updates, future social events) live
// here; ephemeral sync confirmations stay in the toast stack.
//
// The panel is a solid ink surface (.notif-panel), not floating glass: it
// opens over arbitrary page content and needs to read as its own surface.
// Styling follows the quiet zinc chrome of AccountMenu — monochrome rows,
// caps titles with modest tracking, hairline separators; the accent
// appears only as a small unread dot beside the timestamp. Entries are
// grouped by day (TODAY / YESTERDAY / …) with compact right-aligned
// timestamps.
//
// Read model: opening the panel snapshots which items are unread (so their
// "new" styling survives the mark-read call), then marks everything read —
// the badge clears on open, social-media style.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import { Avatar } from '@/components/leaderboard/Avatar'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { useNotifications } from '@/hooks/useNotifications'
import { ACHIEVEMENTS_BY_ID } from '@/lib/achievements'
import { followActor, teamActor } from '@/types/notifications'
import type { AppNotification, NotificationType } from '@/types/notifications'

// Mirrors FEED_LIMIT in /api/user/notifications — at cap a footer notes
// only the most recent items are shown instead of implying this is
// everything.
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
    'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2 M15 18H9 M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14 M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  chevronDown: 'm6 9 6 6 6-6',
  // Same gear as AccountMenu, so the two menus' chrome stays one family.
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'
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
    case 'team_invite':
    case 'team_invite_accepted':
      // Team-affiliation flow wears the TEAM tier's gold.
      return { icon: ICON_PATHS.users, cls: 'text-yellow-300' }
    case 'team_removed':
      return { icon: ICON_PATHS.users, cls: 'text-zinc-400' }
    case 'system':
      return { icon: ICON_PATHS.info, cls: 'text-zinc-400' }
    default: {
      const exhaustive: never = type
      return exhaustive
    }
  }
}

/** Compact age for row timestamps: now → 5m → 2h → 3d → 2w. */
function shortTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`
  return `${Math.floor(diff / (7 * 86_400_000))}w`
}

/** One renderable feed entry: a plain notification, or an X-style stack
 *  of 2+ follow events collapsed into a single row. */
type FeedItem =
  | { kind: 'single'; notification: AppNotification }
  | { kind: 'followStack'; items: AppNotification[] }

interface FeedGroup {
  label: string
  items: FeedItem[]
}

/** Day buckets for the feed. Input arrives newest-first, so consecutive
 *  runs of the same label fold into one group. Within a bucket, 2+ follow
 *  events collapse into one stacked entry at the newest follow's position
 *  — one feed line instead of N. A lone follow stays a normal row. */
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

  const buckets: { label: string; items: AppNotification[] }[] = []
  for (const n of items) {
    const label = labelFor(n.created_at)
    const last = buckets[buckets.length - 1]
    if (last && last.label === label) last.items.push(n)
    else buckets.push({ label, items: [n] })
  }

  return buckets.map((bucket) => {
    const follows = bucket.items.filter((n) => followActor(n) !== null)
    if (follows.length < 2) {
      return {
        label: bucket.label,
        items: bucket.items.map(
          (n): FeedItem => ({ kind: 'single', notification: n })
        )
      }
    }
    const feedItems: FeedItem[] = []
    for (const n of bucket.items) {
      if (followActor(n) === null) {
        feedItems.push({ kind: 'single', notification: n })
      } else if (n === follows[0]) {
        feedItems.push({ kind: 'followStack', items: follows })
      }
      // Remaining follows fold into the stack row.
    }
    return { label: bucket.label, items: feedItems }
  })
}

/** "@a, @b and 3 others started following you." */
function stackBody(items: AppNotification[]): string {
  const names: string[] = []
  for (const n of items) {
    const username = followActor(n)?.username
    if (username) names.push(`@${username}`)
  }
  const count = items.length
  if (names.length === 0) return `${count} players started following you.`
  const shown = names.slice(0, 2)
  const others = count - shown.length
  if (others <= 0) return `${shown.join(' and ')} started following you.`
  return `${shown.join(', ')} and ${others} other${others === 1 ? '' : 's'} started following you.`
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
 * Feed glyph. Follow events show the follower's face (with monogram
 * fallback) — a person, not a category, is the signal. Achievement
 * unlocks render their own self-colored pixel trophy (matching the
 * achievements page) and premium grants render the pixel blue check;
 * every other type keeps its stroke icon — graph for rank, trophy for
 * milestones, flag for season updates. Read rows dim their tile so
 * fresh signals carry the column.
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

  const actor = followActor(notification)
  if (actor && (actor.avatarUrl || actor.username)) {
    return (
      <span className={`${tileCls} overflow-hidden`}>
        <Avatar
          src={actor.avatarUrl}
          char={(actor.username?.[0] ?? '?').toUpperCase()}
          imgClassName="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center font-display text-[11px] text-cyan-300"
        />
      </span>
    )
  }

  // Team-flow rows show the counterparty's face; a missing avatar falls
  // back to a gold monogram (teams are the gold tier).
  const team = teamActor(notification)
  if (team && (team.avatarUrl || team.username)) {
    return (
      <span className={`${tileCls} overflow-hidden`}>
        <Avatar
          src={team.avatarUrl}
          char={(team.username?.[0] ?? '?').toUpperCase()}
          imgClassName="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center font-display text-[11px] text-yellow-300"
        />
      </span>
    )
  }

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
        <span className={tileCls}>
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

/** One plain feed row. Social events deep-link to the actor's profile so
 *  a "started following you" lands one click from FOLLOW BACK; team
 *  invites land on the accept/decline page, an accepted invite or an
 *  identity-review update takes the team straight to its console, and a
 *  sponsorship review update lands on /sponsorship (its data.kind stays
 *  'billboard_review' — a frozen internal contract, not part of the
 *  rename). */
function SingleFeedRow({
  notification: n,
  fresh,
  delay
}: {
  notification: AppNotification
  fresh: boolean
  delay: string
}) {
  const actorUsername =
    n.type === 'social' && typeof n.data?.username === 'string' ? n.data.username : null
  // Follow rows written before the copy change still carry the legacy
  // "NEW WINGMAN" title in the DB; normalize to follower terminology here.
  const title = followActor(n) ? 'NEW FOLLOWER' : n.title
  const href =
    n.type === 'team_invite'
      ? '/team/invites'
      : n.type === 'team_invite_accepted' || n.data?.kind === 'team_review'
        ? '/team'
        : n.data?.kind === 'billboard_review'
          ? '/sponsorship'
          : actorUsername
            ? `/u/${encodeURIComponent(actorUsername)}`
            : null
  const rowCls = `notif-row-in flex items-start gap-3 border-b border-white/[0.045] px-4 py-3 last:border-b-0 ${
    fresh ? 'bg-white/[0.03]' : ''
  }`
  const content = (
    <>
      <NotificationGlyph notification={n} dimmed={!fresh} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span
            className={`truncate text-[11px] tracking-[0.12em] ${
              fresh ? 'text-zinc-50' : 'text-zinc-400'
            }`}
          >
            {title}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span
              className={`text-[10px] tabular-nums ${fresh ? 'text-zinc-500' : 'text-zinc-600'}`}
            >
              {shortTime(n.created_at)}
            </span>
            {/* unread dot */}
            {fresh && <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />}
          </span>
        </div>
        {n.body && (
          <p
            className={`mt-1 text-[11px] leading-relaxed ${
              fresh ? 'text-zinc-400' : 'text-zinc-500'
            }`}
          >
            {n.body}
          </p>
        )}
      </div>
    </>
  )
  return href ? (
    <Link
      href={href}
      style={{ animationDelay: delay }}
      className={`${rowCls} transition-colors hover:bg-white/[0.04]`}
    >
      {content}
    </Link>
  ) : (
    <div style={{ animationDelay: delay }} className={rowCls}>
      {content}
    </div>
  )
}

/** Facepile circle: avatar ringed in panel ink so overlaps read as a
 *  deck of faces, X-style. */
function StackFace({
  username,
  avatarUrl,
  overlap,
  z
}: {
  username: string | null
  avatarUrl: string | null
  overlap: boolean
  z: number
}) {
  return (
    <span
      className={`relative inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 ${
        overlap ? '-ml-2' : ''
      }`}
      style={{ borderColor: 'var(--panel-ink)', zIndex: z }}
    >
      <Avatar
        src={avatarUrl}
        char={(username?.[0] ?? '?').toUpperCase()}
        imgClassName="h-full w-full object-cover"
        fallbackClassName="flex h-full w-full items-center justify-center glass-inset-lite font-display text-[9px] text-cyan-300"
      />
    </span>
  )
}

/**
 * X-style follow burst: N follows in one day bucket collapse into a single
 * row — facepile of the newest faces plus "@a, @b and 3 others started
 * following you." Clicking toggles the individual follows inline as
 * compact deep-linked rows, so the feed never grows N rows tall from one
 * popular day.
 */
function FollowStackRow({
  items,
  isNew,
  delay
}: {
  items: AppNotification[]
  isNew: (id: number, readAt: string | null) => boolean
  delay: string
}) {
  const [expanded, setExpanded] = useState(false)
  const fresh = items.some((n) => isNew(n.id, n.read_at))
  const faces = items.slice(0, 3).map((n) => ({ id: n.id, actor: followActor(n) }))
  const overflow = items.length - faces.length

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${items.length} new followers — ${expanded ? 'collapse' : 'expand'}`}
        style={{ animationDelay: delay }}
        className={`notif-row-in flex w-full items-start gap-3 border-b border-white/[0.045] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-500 ${
          fresh ? 'bg-white/[0.03]' : ''
        }`}
      >
        <span className={`mt-0.5 flex shrink-0 items-center ${fresh ? '' : 'opacity-70'}`}>
          {faces.map((face, i) => (
            <StackFace
              key={face.id}
              username={face.actor?.username ?? null}
              avatarUrl={face.actor?.avatarUrl ?? null}
              overlap={i > 0}
              z={faces.length - i}
            />
          ))}
          {overflow > 0 && (
            <span
              className="relative z-0 -ml-2 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 glass-inset-lite text-[8px] font-bold tabular-nums text-zinc-300"
              style={{ borderColor: 'var(--panel-ink)' }}
            >
              +{overflow}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <span
              className={`truncate text-[11px] tracking-[0.12em] ${
                fresh ? 'text-zinc-50' : 'text-zinc-400'
              }`}
            >
              NEW FOLLOWERS
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <span
                className={`text-[10px] tabular-nums ${fresh ? 'text-zinc-500' : 'text-zinc-600'}`}
              >
                {shortTime(items[0].created_at)}
              </span>
              {/* unread dot */}
              {fresh && (
                <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
              )}
            </span>
          </div>
          <p
            className={`mt-1 text-[11px] leading-relaxed ${
              fresh ? 'text-zinc-400' : 'text-zinc-500'
            }`}
          >
            {stackBody(items)}
          </p>
        </div>
        <span
          className={`mt-1 shrink-0 text-zinc-500 transition-transform duration-150 ${
            expanded ? 'rotate-180' : ''
          }`}
          aria-hidden
        >
          <StrokeIcon d={ICON_PATHS.chevronDown} className="h-3 w-3" />
        </span>
      </button>
      {expanded &&
        items.map((n) => {
          const actor = followActor(n)
          const username = actor?.username ?? null
          const rowFresh = isNew(n.id, n.read_at)
          const memberCls = `notif-row-in flex items-center gap-3 border-b border-white/[0.045] py-2 pl-8 pr-4 transition-colors last:border-b-0 hover:bg-white/[0.04] ${
            rowFresh ? 'bg-white/[0.03]' : ''
          }`
          const inner = (
            <>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full glass-inset-lite">
                <Avatar
                  src={actor?.avatarUrl}
                  char={(username?.[0] ?? '?').toUpperCase()}
                  imgClassName="h-full w-full object-cover"
                  fallbackClassName="flex h-full w-full items-center justify-center font-display text-[9px] text-cyan-300"
                />
              </span>
              <span
                className={`truncate text-[11px] ${rowFresh ? 'text-zinc-200' : 'text-zinc-400'}`}
              >
                {username ? `@${username}` : 'A player'}{' '}
                <span className="text-zinc-500">started following you</span>
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <span
                  className={`text-[10px] tabular-nums ${
                    rowFresh ? 'text-zinc-500' : 'text-zinc-600'
                  }`}
                >
                  {shortTime(n.created_at)}
                </span>
                {/* unread dot */}
                {rowFresh && (
                  <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
                )}
              </span>
            </>
          )
          return username ? (
            <Link key={n.id} href={`/u/${encodeURIComponent(username)}`} className={memberCls}>
              {inner}
            </Link>
          ) : (
            <div key={n.id} className={memberCls}>
              {inner}
            </div>
          )
        })}
    </>
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

/** Inbox zero: a muted bell tile and a note on what will land here. */
function EmptyFeed() {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl glass-inset-lite text-zinc-500">
        <StrokeIcon d={ICON_PATHS.bell} className="h-5 w-5" />
      </div>
      <div className="mt-4 text-xs text-zinc-300">No notifications yet</div>
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
    /* shrink-0: as a top-bar flex child the bell must never compress when
       the row runs tight — overflow eats the wordmark instead (see
       NavTopBar). */
    <div ref={rootRef} className="relative shrink-0">
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
          className={`${panelPlacementCls} notif-panel flex flex-col overflow-hidden rounded-2xl`}
          style={{ animation: panelAnimation }}
        >
          {/* header — title, quiet fresh count, settings shortcut */}
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <span className="text-[10px] tracking-[0.2em] text-zinc-200">NOTIFICATIONS</span>
            <div className="flex items-center gap-3">
              {freshCount > 0 && (
                <span className="text-[10px] text-zinc-400">{freshCount} new</span>
              )}
              <Link
                href="/settings/notifications"
                aria-label="Notification settings"
                className="rounded text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
              >
                <StrokeIcon d={ICON_PATHS.settings} className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <div className="notif-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                    style={{ background: 'var(--panel-ink)' }}
                  >
                    <span className="text-[9px] tracking-[0.2em] text-zinc-600">
                      {group.label}
                    </span>
                    <span className="h-px flex-1 bg-white/[0.06]" aria-hidden />
                  </div>

                  {group.items.map((item) => {
                    const delay = `${Math.min(rowIndex++, 8) * 26}ms`
                    switch (item.kind) {
                      case 'single':
                        return (
                          <SingleFeedRow
                            key={item.notification.id}
                            notification={item.notification}
                            fresh={isNew(item.notification.id, item.notification.read_at)}
                            delay={delay}
                          />
                        )
                      case 'followStack':
                        return (
                          <FollowStackRow
                            key={`stack-${item.items[0].id}`}
                            items={item.items}
                            isNew={isNew}
                            delay={delay}
                          />
                        )
                      default: {
                        const exhaustive: never = item
                        return exhaustive
                      }
                    }
                  })}
                </section>
              ))
            )}
          </div>

          {notifications.length >= FEED_CAP && (
            <div className="shrink-0 border-t border-white/[0.07] px-4 py-2 text-center text-[10px] text-zinc-600">
              Showing the last {FEED_CAP}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
