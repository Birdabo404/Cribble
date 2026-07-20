'use client'

// Animated player profile card. Opens from any leaderboard row with a
// zoom-in spring, then behaves like a holographic trading card: pointer
// tilt, a light sheen that follows the cursor, and medal theming for the
// podium ranks. Identity/tools render instantly from the standings row;
// badges and consistency stats hydrate from /api/leaderboard/profile.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AnimatedCounter from '@/components/AnimatedCounter'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import { FollowButton, FollowsYouChip, type FollowChange } from '@/components/profile/FollowButton'
import {
  formatDuration,
  formatNumber,
  formatRelative,
  formatScore,
  tierAccent
} from '@/components/dashboard-v2/format'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { ACHIEVEMENTS } from '@/lib/achievements'
import { isProTier } from '@/lib/entitlements'
import { prefersReducedMotion } from '@/lib/motion'
import type { Tier } from '@/types/dashboard'
import { Avatar, SafeBannerImg } from './Avatar'
import { ROLE_ICONS } from '@/components/roleIcons'
import {
  IconClose,
  IconCrown,
  IconLock,
  IconTarget,
  MoveGlyph,
  SocialIcon,
  SOCIAL_LABEL,
  socialHref,
  ToolIcon,
  type SocialKind
} from './icons'
import {
  medalA,
  medalFor,
  PLATE_DOWN,
  PLATE_UP,
  ROLE_META,
  type LeaderRow,
  type PlayerProfile
} from './types'

const SOCIAL_KINDS: SocialKind[] = ['x', 'github', 'youtube', 'linkedin']

const rarityColor = (rarity: string) => `rgb(var(--r-${rarity}))`
const rarityColorA = (rarity: string, alpha: number) =>
  `rgb(var(--r-${rarity}) / ${alpha})`

const monthYear = (iso: string | null | undefined) => {
  if (!iso) return '—'
  return new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase()
}

export interface ChaseInfo {
  gap: number
  username: string
}

const CLOSE_MS = 220

export function PlayerCard({
  row,
  isYou,
  chase,
  onClose
}: {
  row: LeaderRow
  isYou: boolean
  chase: ChaseInfo | null
  onClose: () => void
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [profileFailed, setProfileFailed] = useState(false)
  const [closing, setClosing] = useState(false)
  const tiltRef = useRef<HTMLDivElement>(null)

  // Latest onClose without re-wiring listeners when the parent re-renders.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const medal = medalFor(row.rank)
  const edgeRgb = medal ? medal.rgb : 'var(--lb-panel-edge)'

  // ---- graceful close: play the exit animation, then unmount ---------
  const requestClose = useCallback(() => {
    if (prefersReducedMotion()) {
      onCloseRef.current()
      return
    }
    setClosing(true)
  }, [])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => onCloseRef.current(), CLOSE_MS)
    return () => clearTimeout(t)
  }, [closing])

  // ---- extended profile hydration ----------------------------------
  // Hydrates from the profile endpoint: same payload as the leaderboard
  // profile plus follow counts and the viewer relationship, so the card
  // can offer FOLLOW right at the point of discovery.
  const loadProfile = useCallback(async (isCancelled?: () => boolean) => {
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(row.username)}`, {
        cache: 'no-store',
        credentials: 'include'
      })
      if (!res.ok) throw new Error('profile fetch failed')
      const data = await res.json()
      if (isCancelled?.()) return
      if (data.success && data.profile) setProfile(data.profile as PlayerProfile)
      else setProfileFailed(true)
    } catch {
      if (!isCancelled?.()) setProfileFailed(true)
    }
  }, [row.username])

  useEffect(() => {
    let cancelled = false
    void loadProfile(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [loadProfile])

  // ---- escape / scroll lock -----------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [requestClose])

  // ---- holographic tilt + pointer glow -------------------------------
  // Writes are coalesced to one per frame (pointermove can fire at 240Hz on
  // gaming mice), and the glow is a transform-positioned element rather
  // than a repainting gradient — the whole effect stays on the compositor.
  const pointerPos = useRef<{ x: number; y: number } | null>(null)
  const tiltRaf = useRef(0)

  const onTiltMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    pointerPos.current = { x: e.clientX, y: e.clientY }
    if (tiltRaf.current) return
    tiltRaf.current = requestAnimationFrame(() => {
      tiltRaf.current = 0
      const el = tiltRef.current
      const p = pointerPos.current
      if (!el || !p || prefersReducedMotion()) return
      const r = el.getBoundingClientRect()
      const x = (p.x - r.left) / r.width
      const y = (p.y - r.top) / r.height
      el.style.setProperty('--rx', `${((0.5 - y) * 5).toFixed(2)}deg`)
      el.style.setProperty('--ry', `${((x - 0.5) * 7).toFixed(2)}deg`)
      el.style.setProperty('--gx', `${(p.x - r.left).toFixed(1)}px`)
      el.style.setProperty('--gy', `${(p.y - r.top).toFixed(1)}px`)
      el.style.setProperty('--go', '1')
    })
  }, [])

  const onTiltLeave = useCallback(() => {
    if (tiltRaf.current) {
      cancelAnimationFrame(tiltRaf.current)
      tiltRaf.current = 0
    }
    const el = tiltRef.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
    el.style.setProperty('--go', '0')
  }, [])

  useEffect(
    () => () => {
      if (tiltRaf.current) cancelAnimationFrame(tiltRaf.current)
    },
    []
  )

  // ---- merged data (row renders instantly, profile enriches) --------
  const tools = profile?.topTools?.length ? profile.topTools : row.topTools || []
  const todayScore = profile?.todayScore ?? row.todayScore
  const weekScore = profile?.weekScore ?? row.weekScore
  const badges = profile?.badges ?? null
  const socials = profile?.socials ?? row.socials ?? {}
  const socialEntries = SOCIAL_KINDS.map((kind) => ({
    kind,
    value: socials[kind]
  })).filter((e): e is { kind: SocialKind; value: string } => Boolean(e.value))

  const roleKey = (profile?.role ?? row.role) || null
  const RoleIcon = roleKey ? ROLE_ICONS[roleKey] : undefined
  const roleLabel = roleKey ? ROLE_META[roleKey] : null

  // ---- follow context (arrives with the profile hydration) ----------
  const viewer = profile?.viewer ?? null
  const followerCount = profile?.followers ?? null

  const isPrivateAccount = profile?.isPrivate === true

  const handleFollowChange = useCallback(
    (change: FollowChange) => {
      setProfile((p) => {
        if (!p || !p.viewer) return p
        const wasFollowing = p.viewer.isFollowing
        const base = p.followers ?? 0
        const followers =
          change.followers !== null
            ? change.followers
            : base + (change.following === wasFollowing ? 0 : change.following ? 1 : -1)
        return {
          ...p,
          followers: Math.max(0, followers),
          viewer: { ...p.viewer, isFollowing: change.following }
        }
      })
      // Following a private pilot unlocks their tools/badges — refetch
      // once the server confirms so the card fills in live.
      if (isPrivateAccount && change.followers !== null) {
        void loadProfile()
      }
    },
    [isPrivateAccount, loadProfile]
  )

  const statCells: { label: string; value: string | null }[] = [
    {
      label: 'ACTIVE DAYS',
      value: profile ? formatNumber(profile.activeDays) : null
    },
    {
      label: 'BEST STREAK',
      value: profile ? `${formatNumber(profile.longestStreak)}d` : null
    },
    {
      label: 'FOCUS TIME',
      value: profile ? formatDuration(profile.totalActiveMs) : null
    }
  ]

  return createPortal(
    <div
      className="pc-root fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label={`Player profile — @${row.username}`}
      data-closing={closing ? '' : undefined}
    >
      <div className="pc-backdrop absolute inset-0" onClick={requestClose} aria-hidden />

      <div className="pc-card relative w-full max-w-[420px]">
        <div
          ref={tiltRef}
          className="pc-tilt relative max-h-[calc(100vh-3rem)] overflow-y-auto overscroll-contain rounded-3xl"
          onPointerMove={onTiltMove}
          onPointerLeave={onTiltLeave}
          style={{
            background: `linear-gradient(180deg, rgb(255 255 255 / 0.04), transparent 30%), rgb(var(--lb-panel-bg))`,
            border: `1px solid ${medal ? medalA(medal.rgb, 0.45) : 'rgb(var(--lb-panel-edge) / 0.14)'}`,
            boxShadow: medal
              ? `0 30px 90px -30px ${medalA(medal.rgb, 0.4)}, 0 24px 60px -28px rgb(0 0 0 / 0.9)`
              : '0 30px 80px -30px rgb(0 0 0 / 0.95)'
          }}
        >
          {/* holo glow — pinned to the scrollport, moved purely by transform
              so following the pointer never repaints a gradient */}
          <div aria-hidden className="pointer-events-none sticky top-0 z-30 h-0">
            <span
              className="pc-glow"
              style={{
                background: `radial-gradient(closest-side, ${
                  medal ? medalA(medal.rgb, 0.1) : 'rgb(var(--lb-panel-edge) / 0.07)'
                }, transparent 70%)`
              }}
            />
          </div>

          {/* ---------- banner ---------- */}
          <div className="relative h-28 overflow-hidden">
            {/* default banner always paints; a live banner_image covers it */}
            <div aria-hidden className="absolute inset-0">
              <div
                className="absolute inset-0"
                style={{
                  background: [
                    `radial-gradient(120% 130% at 20% -10%, ${medalA(edgeRgb, 0.28)}, transparent 55%)`,
                    `radial-gradient(90% 120% at 95% 10%, ${medalA(edgeRgb, 0.14)}, transparent 60%)`,
                    `repeating-linear-gradient(90deg, rgb(var(--lb-panel-edge) / 0.05) 0 1px, transparent 1px 22px)`,
                    `repeating-linear-gradient(0deg, rgb(var(--lb-panel-edge) / 0.05) 0 1px, transparent 1px 22px)`
                  ].join(', ')
                }}
              />
              <span
                className="absolute -bottom-2 right-3 select-none text-[46px] leading-none opacity-[0.13] [font-family:var(--font-pixel)]"
                style={{ color: medal ? medal.fg : 'rgb(var(--lb-panel-edge))' }}
              >
                #{row.rank}
              </span>
            </div>
            {row.banner_image && (
              <SafeBannerImg
                src={row.banner_image}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {/* fade into the card body */}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-14"
              style={{
                background: 'linear-gradient(180deg, transparent, rgb(var(--lb-panel-bg)))'
              }}
            />

            {/* rank plate — bright literals: the pill scrim stays dark in both themes */}
            <div className="absolute left-3 top-3 flex items-center gap-2">
              <span
                className="rounded-lg px-2.5 py-1.5 text-[13px] leading-none [font-family:var(--font-pixel)]"
                style={{
                  color: medal ? `rgb(${medal.plate})` : 'rgb(244 244 245)',
                  background: 'rgb(0 0 0 / 0.55)',
                  border: `1px solid ${medal ? `rgb(${medal.plate} / 0.5)` : 'rgb(255 255 255 / 0.14)'}`,
                  textShadow: medal ? `0 0 14px rgb(${medal.plate} / 0.6)` : undefined
                }}
              >
                #{row.rank}
              </span>
              {row.rankDelta !== 0 && (
                <span
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold tabular-nums"
                  style={{
                    color: row.rankDelta > 0 ? `rgb(${PLATE_UP})` : `rgb(${PLATE_DOWN})`,
                    background: 'rgb(0 0 0 / 0.55)',
                    border: '1px solid rgb(255 255 255 / 0.1)'
                  }}
                >
                  <MoveGlyph dir={row.rankDelta > 0 ? 'up' : 'down'} size={7} />
                  {Math.abs(row.rankDelta)}
                </span>
              )}
              {row.isNew && row.rankDelta === 0 && (
                <span
                  className="rounded-md px-1.5 py-1 text-[9px] font-semibold tracking-[0.2em]"
                  style={{
                    color: 'rgb(255 214 68)',
                    background: 'rgb(0 0 0 / 0.55)',
                    border: '1px solid rgb(255 214 68 / 0.4)'
                  }}
                >
                  NEW
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={requestClose}
              autoFocus
              aria-label="Close profile"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-white"
              style={{
                background: 'rgb(0 0 0 / 0.55)',
                border: '1px solid rgb(255 255 255 / 0.14)'
              }}
            >
              <IconClose size={14} />
            </button>
          </div>

          {/* ---------- identity ---------- */}
          <div className="relative -mt-11 flex flex-col items-center px-6">
            <div className="relative">
              {row.rank === 1 && (
                <span aria-hidden className="pc-crown absolute -top-7 left-1/2 -translate-x-1/2 text-[rgb(var(--lb-gold))]">
                  <IconCrown size={20} />
                </span>
              )}
              {/* spinning conic ring for the champion, static ring otherwise */}
              <div className="relative h-[84px] w-[84px]">
                {medal && row.rank === 1 ? (
                  <span
                    aria-hidden
                    className="pc-ring-spin absolute -inset-[3px] rounded-full"
                    style={{
                      background: `conic-gradient(from 0deg, transparent 0deg, ${medalA(medal.rgb, 0.9)} 80deg, rgb(var(--lb-gold-hi)) 120deg, transparent 200deg, ${medalA(medal.rgb, 0.55)} 300deg, transparent 360deg)`,
                      filter: `drop-shadow(0 0 10px ${medalA(medal.rgb, 0.55)})`
                    }}
                  />
                ) : (
                  <span
                    aria-hidden
                    className="absolute -inset-[3px] rounded-full"
                    style={{
                      background: medal
                        ? `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.9)}, ${medalA(medal.rgb, 0.25)}, ${medalA(medal.rgb, 0.9)})`
                        : 'rgb(var(--lb-panel-edge) / 0.2)',
                      boxShadow: medal ? `0 0 18px ${medalA(medal.rgb, 0.3)}` : undefined
                    }}
                  />
                )}
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{ boxShadow: `inset 0 0 0 3px rgb(var(--lb-panel-bg))` }}
                />
                <Avatar
                  src={row.profile_image}
                  char={row.username[0]?.toUpperCase() ?? '?'}
                  imgClassName="absolute inset-[3px] h-[78px] w-[78px] rounded-full object-cover"
                  fallbackClassName="absolute inset-[3px] flex items-center justify-center rounded-full bg-zinc-900 text-2xl text-zinc-300 font-display"
                />
                {row.isActive && (
                  <span
                    className="absolute bottom-1 right-1 h-3 w-3 rounded-full"
                    style={{
                      background: 'rgb(var(--lb-up))',
                      boxShadow: '0 0 8px rgb(var(--lb-up) / 0.8), inset 0 0 0 2px rgb(var(--lb-panel-bg))'
                    }}
                    title="Online"
                  />
                )}
              </div>
            </div>

            <div className="mt-3 flex max-w-full items-center gap-2">
              <span className="truncate font-display text-lg font-semibold tracking-tight text-zinc-50">
                {row.display_name || `@${row.username}`}
              </span>
              {isProTier(row.tier) && <VerifiedBadge size={15} />}
              {isYou && (
                <span className="shrink-0 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[8px] tracking-[0.25em] text-accent">
                  YOU
                </span>
              )}
            </div>
            <span className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
              @{row.username}
              {(profile?.isPrivate ?? row.isPrivate) && (
                <span className="text-zinc-600" title="Private account">
                  <IconLock size={10} />
                </span>
              )}
              {viewer?.followsYou && !isYou && <FollowsYouChip />}
            </span>

            {/* follow at the point of discovery — the whole reason the card exists */}
            {!isYou && viewer && !viewer.isYou && (
              <div className="mt-3 flex items-center gap-3">
                <FollowButton
                  targetUserId={row.userId}
                  following={viewer.isFollowing}
                  followsYou={viewer.followsYou}
                  signedIn
                  size="sm"
                  onChange={handleFollowChange}
                />
                {followerCount !== null && (
                  <span className="text-[9px] tracking-[0.25em] text-zinc-500">
                    <span className="tabular-nums text-zinc-300 [font-family:var(--font-pixel)]">
                      {formatNumber(followerCount)}
                    </span>{' '}
                    {followerCount === 1 ? 'FOLLOWER' : 'FOLLOWERS'}
                  </span>
                )}
              </div>
            )}

            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
              {medal && (
                <span
                  className="flex items-center gap-1.5 rounded border px-2 py-0.5 text-[9px] tracking-[0.25em]"
                  style={{
                    color: medal.fg,
                    borderColor: medalA(medal.rgb, 0.45),
                    background: medalA(medal.rgb, 0.08)
                  }}
                >
                  {medal.label}
                </span>
              )}
              {roleLabel && (
                <span className="flex items-center gap-1.5 rounded border border-zinc-700/70 bg-white/[0.03] px-2 py-0.5 text-[9px] tracking-[0.25em] text-zinc-400">
                  {RoleIcon && <RoleIcon size={10} />}
                  {roleLabel}
                </span>
              )}
              <span
                className={`rounded border px-2 py-0.5 text-[9px] tracking-[0.25em] ${tierAccent(row.tier as Tier)}`}
              >
                {row.tier}
              </span>
            </div>
          </div>

          {/* ---------- score hero ---------- */}
          <div className="mt-5 flex flex-col items-center px-6">
            <span className="text-[9px] tracking-[0.4em] text-zinc-500">LIFETIME SCORE</span>
            <span
              title={`${formatNumber(row.score)} pts`}
              className="mt-2 text-[26px] leading-none tabular-nums [font-family:var(--font-pixel)]"
              style={{
                color: 'rgb(var(--lb-score))',
                textShadow: medal
                  ? '0 0 18px rgb(var(--lb-score) / 0.55), 0 0 44px rgb(var(--lb-score) / 0.22)'
                  : '0 0 18px rgb(var(--lb-score) / 0.28)'
              }}
            >
              <AnimatedCounter
                value={row.score}
                duration={900}
                formatter={(v) => formatScore(Math.round(v))}
              />
            </span>
            <div className="mt-2.5 flex items-center gap-3 text-[10px] tabular-nums">
              <span style={{ color: todayScore > 0 ? 'rgb(var(--lb-up))' : 'rgb(var(--z600))' }}>
                +{formatNumber(todayScore)} today
              </span>
              <span className="text-zinc-700">·</span>
              <span className="text-zinc-500">+{formatNumber(weekScore)} this week</span>
            </div>

            {(chase || row.rank === 1) && (
              <div
                className="mt-3 flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] tracking-[0.12em]"
                style={{
                  border: `1px solid ${medal ? medalA(medal.rgb, 0.3) : 'rgb(var(--lb-panel-edge) / 0.12)'}`,
                  background: medal ? medalA(medal.rgb, 0.05) : 'rgb(var(--lb-panel-edge) / 0.03)'
                }}
              >
                {row.rank === 1 ? (
                  <>
                    <IconCrown size={11} className="text-[rgb(var(--lb-gold))]" />
                    <span className="text-zinc-300">
                      HOLDING THE THRONE
                      {chase && (
                        <span className="text-zinc-500"> · {formatNumber(chase.gap)} PTS AHEAD</span>
                      )}
                    </span>
                  </>
                ) : (
                  chase && (
                    <>
                      <IconTarget size={11} className="text-zinc-500" />
                      <span className="text-zinc-400">
                        <span className="text-zinc-100">{formatNumber(chase.gap)} PTS</span> TO
                        OVERTAKE <span className="text-zinc-200">@{chase.username}</span>
                      </span>
                    </>
                  )
                )}
              </div>
            )}
          </div>

          {/* ---------- consistency stats ---------- */}
          <div className="mt-5 grid grid-cols-3 gap-2 px-6">
            {statCells.map((cell) => (
              <div
                key={cell.label}
                className="rounded-xl px-2 py-2.5 text-center"
                style={{
                  background: 'rgb(var(--lb-panel-edge) / 0.035)',
                  border: '1px solid rgb(var(--lb-panel-edge) / 0.08)'
                }}
              >
                <div className="text-[8px] tracking-[0.3em] text-zinc-600">{cell.label}</div>
                {cell.value !== null ? (
                  <div className="mt-1.5 font-display text-sm font-semibold tabular-nums text-zinc-100">
                    {cell.value}
                  </div>
                ) : (
                  <div className="mx-auto mt-2 h-3.5 w-10 animate-pulse rounded bg-white/[0.07]" />
                )}
              </div>
            ))}
          </div>

          {/* ---------- top tools ---------- */}
          <div className="mt-5 px-6">
            <div className="flex items-center justify-between text-[9px] tracking-[0.35em] text-zinc-500">
              <span>TOP TOOLS</span>
              <span className="text-zinc-700">SHARE OF SCORE</span>
            </div>
            <div className="mt-2.5 space-y-2">
              {tools.length === 0 &&
                (profile?.restricted ? (
                  <div className="flex items-center justify-center gap-1.5 py-2 text-[10px] tracking-[0.2em] text-zinc-600">
                    <IconLock size={10} />
                    FOLLOWERS ONLY
                  </div>
                ) : (
                  <div className="py-2 text-center text-[10px] tracking-[0.2em] text-zinc-600">
                    NO FIELD DATA YET
                  </div>
                ))}
              {tools.slice(0, 3).map((tool, i) => (
                <div key={tool.name} className="flex items-center gap-3">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      color: i === 0 && medal ? medal.fg : 'rgb(var(--z300))',
                      background: 'rgb(var(--lb-panel-edge) / 0.045)',
                      border: '1px solid rgb(var(--lb-panel-edge) / 0.1)'
                    }}
                  >
                    <ToolIcon name={tool.name} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-display text-xs font-medium text-zinc-200">
                        {tool.name}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                        {tool.percent}%
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="pc-bar h-full rounded-full"
                        style={{
                          width: `${Math.max(3, tool.percent)}%`,
                          background:
                            i === 0 && medal
                              ? `linear-gradient(90deg, ${medalA(medal.rgb, 0.55)}, ${medal.fg})`
                              : 'linear-gradient(90deg, rgb(var(--z600)), rgb(var(--z400)))',
                          animationDelay: `${180 + i * 110}ms`
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ---------- badges ---------- */}
          <div className="mt-5 px-6">
            <div className="flex items-center justify-between text-[9px] tracking-[0.35em] text-zinc-500">
              <span>BADGES</span>
              {profile?.restricted ? (
                <span className="flex items-center gap-1 text-zinc-600">
                  <IconLock size={9} />
                  PRIVATE
                </span>
              ) : (
                badges !== null && (
                  <span className="tabular-nums text-zinc-600">
                    {badges.length}
                    <span className="text-zinc-700">/{ACHIEVEMENTS.length}</span>
                  </span>
                )
              )}
            </div>
            <div className="mt-2.5">
              {badges === null && !profileFailed && (
                <div className="grid grid-cols-8 gap-1.5">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/[0.05]" />
                  ))}
                </div>
              )}
              {badges === null && profileFailed && (
                <div className="py-2 text-center text-[10px] tracking-[0.2em] text-zinc-600">
                  RECORD UNAVAILABLE
                </div>
              )}
              {badges !== null &&
                badges.length === 0 &&
                (profile?.restricted ? (
                  <div className="flex items-center justify-center gap-1.5 py-2 text-[10px] tracking-[0.2em] text-zinc-600">
                    <IconLock size={10} />
                    FOLLOWERS ONLY
                  </div>
                ) : (
                  <div className="py-2 text-center text-[10px] tracking-[0.2em] text-zinc-600">
                    NO DECORATIONS YET
                  </div>
                ))}
              {badges !== null && badges.length > 0 && (
                <div className="grid grid-cols-8 gap-1.5">
                  {badges.slice(0, 15).map((badge) => (
                    <div
                      key={badge.id}
                      title={`${badge.name} — ${badge.description}`}
                      className="flex aspect-square items-center justify-center rounded-lg"
                      style={{
                        color: rarityColor(badge.rarity),
                        background: rarityColorA(badge.rarity, 0.07),
                        border: `1px solid ${rarityColorA(badge.rarity, 0.3)}`
                      }}
                    >
                      <PixelIcon
                        name={badge.icon}
                        size={20}
                        className="[filter:drop-shadow(0_0_4px_currentColor)]"
                      />
                    </div>
                  ))}
                  {badges.length > 15 && (
                    <div
                      className="flex aspect-square items-center justify-center rounded-lg text-[9px] tabular-nums text-zinc-400"
                      style={{
                        background: 'rgb(var(--lb-panel-edge) / 0.04)',
                        border: '1px solid rgb(var(--lb-panel-edge) / 0.1)'
                      }}
                      title={`${badges.length - 15} more badges`}
                    >
                      +{badges.length - 15}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ---------- full profile link ---------- */}
          <div className="mt-5 px-6">
            <a
              href={`/u/${encodeURIComponent(row.username)}`}
              className="flex items-center justify-center gap-2 rounded-lg py-2 text-[9px] tracking-[0.35em] text-zinc-400 transition-colors hover:text-zinc-100"
              style={{
                border: '1px solid rgb(var(--lb-panel-edge) / 0.12)',
                background: 'rgb(var(--lb-panel-edge) / 0.03)'
              }}
            >
              OPEN FULL PROFILE
              <span aria-hidden>→</span>
            </a>
          </div>

          {/* ---------- socials + footer ---------- */}
          <div className="mt-5 border-t px-6 pb-5 pt-4" style={{ borderColor: 'rgb(var(--lb-panel-edge) / 0.08)' }}>
            {socialEntries.length > 0 && (
              <div className="flex items-center justify-center gap-1.5 pb-3">
                {socialEntries.map(({ kind, value }) => (
                  <a
                    key={kind}
                    href={socialHref(kind, value)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`@${row.username} on ${SOCIAL_LABEL[kind]}`}
                    title={SOCIAL_LABEL[kind]}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-all hover:-translate-y-0.5 hover:text-zinc-100"
                    style={{
                      background: 'rgb(var(--lb-panel-edge) / 0.04)',
                      border: '1px solid rgb(var(--lb-panel-edge) / 0.1)'
                    }}
                  >
                    <SocialIcon kind={kind} size={14} />
                  </a>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between text-[9px] tracking-[0.25em] text-zinc-600 tabular-nums">
              <span>JOINED SINCE {monthYear(profile?.memberSince ?? row.memberSince)}</span>
              {!row.isActive && (
                <span>SEEN {formatRelative(row.lastSeen).toUpperCase()}</span>
              )}
            </div>
          </div>

        </div>
      </div>

      <style jsx global>{`
        .pc-backdrop {
          background: rgb(0 0 0 / 0.78);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: pc-backdrop-in 260ms ease backwards;
        }
        html.light .pc-backdrop {
          /* paper veil — matches the dossier canvas instead of cooling it */
          background: rgb(246 244 238 / 0.72);
        }
        @keyframes pc-backdrop-in {
          from {
            opacity: 0;
          }
        }

        /* zoom-in spring — the card grows out of the row you clicked */
        .pc-card {
          animation: pc-card-in 440ms cubic-bezier(0.26, 1.35, 0.45, 1) backwards;
        }
        @keyframes pc-card-in {
          from {
            opacity: 0;
            transform: scale(0.82) translateY(30px);
          }
        }

        /* graceful exit — mirrors the entrance, slightly faster */
        .pc-root[data-closing] {
          pointer-events: none;
        }
        .pc-root[data-closing] .pc-backdrop {
          animation: pc-backdrop-out ${CLOSE_MS}ms ease forwards;
        }
        .pc-root[data-closing] .pc-card {
          animation: pc-card-out ${CLOSE_MS}ms cubic-bezier(0.5, 0, 0.75, 0.4) forwards;
        }
        @keyframes pc-backdrop-out {
          to {
            opacity: 0;
          }
        }
        @keyframes pc-card-out {
          to {
            opacity: 0;
            transform: scale(0.92) translateY(16px);
          }
        }

        .pc-tilt {
          transform: perspective(1100px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
          transition: transform 220ms ease-out;
          will-change: transform;
          scrollbar-width: none;
        }
        .pc-tilt::-webkit-scrollbar {
          display: none;
        }

        .pc-glow {
          position: absolute;
          left: 0;
          top: 0;
          width: 340px;
          height: 340px;
          border-radius: 9999px;
          transform: translate3d(var(--gx, 50%), var(--gy, 40px), 0) translate(-50%, -50%);
          opacity: var(--go, 0);
          transition: opacity 320ms ease;
          will-change: transform;
        }

        .pc-crown {
          animation: pc-crown-bob 2.6s ease-in-out infinite;
          filter: drop-shadow(0 0 8px rgb(var(--lb-gold) / 0.7));
        }
        @keyframes pc-crown-bob {
          0%,
          100% {
            transform: translate(-50%, 0);
          }
          50% {
            transform: translate(-50%, -3px);
          }
        }

        .pc-ring-spin {
          animation: pc-ring-rotate 3.2s linear infinite;
        }
        @keyframes pc-ring-rotate {
          to {
            transform: rotate(360deg);
          }
        }

        .pc-bar {
          transform-origin: left center;
          animation: pc-bar-grow 700ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes pc-bar-grow {
          from {
            transform: scaleX(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pc-backdrop,
          .pc-card,
          .pc-crown,
          .pc-ring-spin,
          .pc-bar {
            animation: none;
          }
          .pc-tilt {
            transform: none;
            transition: none;
            will-change: auto;
          }
          .pc-glow {
            display: none;
          }
        }
      `}</style>
    </div>,
    document.body
  )
}
