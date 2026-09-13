'use client'

// Player profile card, laid out as a pilot license: a 640px landscape
// card whose zones (chrome / identity / telemetry / MRZ footer) sit on a
// 1px hairline grid and read in one glance. Every control row is 20px —
// tags, the follow control, share bars, the chase line — so the card has
// one rhythm. GSAP choreographs the reveal (playerCardMotion.ts) and the
// holographic tilt. Identity and tools render from the standings row;
// badges, agentic mix, hangar and the follow context hydrate from
// /api/profile into slots reserved at mount, so nothing shifts.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import AnimatedCounter from '@/components/AnimatedCounter'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import { FollowButton, type FollowChange } from '@/components/profile/FollowButton'
import { formatNumber, formatRelative, formatScore } from '@/components/dashboard-v2/format'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { TeamMiniLogo } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { ACHIEVEMENTS } from '@/lib/achievements'
import { isProTier } from '@/lib/entitlements'
import { useSfx } from '@/components/sfx/SfxProvider'
import { tokenAgentLabel } from '@/lib/tokenLeaderboard'
import { Avatar, SafeBannerImg } from './Avatar'
import { SocialLinkRow } from './SocialLinkRow'
import { TokenAgentIcon } from './TokenAgentIcon'
import { ROLE_ICONS } from '@/components/roleIcons'
import {
  IconClose,
  IconCrown,
  IconExpand,
  IconLock,
  IconShare,
  IconTarget,
  MoveGlyph,
  ToolIcon
} from './icons'
import type { ShareCardData } from './share/ShareCard'
import { ShareRow } from './playerCard/ShareRow'
import { buildMrz, mrzPlainText, type MrzInput } from './playerCard/mrz'
import { bindTilt, enterCard, exitCard, hydrateIn } from './playerCard/playerCardMotion'
import {
  medalA,
  medalFor,
  PLATE_DOWN,
  PLATE_UP,
  ROLE_META,
  type LeaderRow,
  type PlayerProfile
} from './types'

gsap.registerPlugin(useGSAP)

const rarityColorA = (rarity: string, alpha: number) => `rgb(var(--r-${rarity}) / ${alpha})`

// Type ramp: five sizes plus the rank plate. Colour rides separately.
const LABEL = 'text-[9px] tracking-[0.32em] uppercase'
const DATA = 'text-[10.5px] tabular-nums tracking-[0.04em]'
const BODY = 'font-display text-[12px] font-medium'
const NAME = 'font-display text-[17px] font-semibold leading-none tracking-[-0.01em] text-zinc-50'
const MACRO = '[font-family:var(--font-pixel)] text-[24px] leading-none tabular-nums sm:text-[28px]'
const PLATE = '[font-family:var(--font-pixel)] text-[12px]'

/** The one control height: every tag, chip and row in the identity zone. */
const ROW = 'flex h-5 items-center'
const TAG = `${ROW} gap-1 rounded-[6px] border px-2 ${LABEL}`
const CHIP = {
  className: `${ROW} w-5 shrink-0 justify-center rounded-[6px]`,
  style: {
    background: 'rgb(var(--lb-panel-edge) / 0.045)',
    border: '1px solid rgb(var(--lb-panel-edge) / 0.1)'
  }
} as const

// Banner controls: the scrim stays dark in both themes, so the glyph
// colour is a literal too (.pc-ctl) — Tailwind's zinc scale re-pins under
// html.light and text-zinc-300 would land dark-on-dark.
const SCRIM = {
  background: 'rgb(0 0 0 / 0.55)',
  border: '1px solid rgb(255 255 255 / 0.14)'
} as const
const CONTROL =
  'pc-ctl flex h-10 w-10 items-center justify-center rounded-full transition-colors sm:h-8 sm:w-8'

/** 1px rule between / inside zones — an element, not a grid gap, so the
 *  entrance can draw it. `late` marks hydration-only rules. */
function Hair({ late, className = '' }: { late?: boolean; className?: string }) {
  return (
    <div
      data-pc="hair"
      data-pc-late={late ? '' : undefined}
      aria-hidden
      className={`h-px ${className}`}
      style={{ background: 'rgb(var(--lb-panel-edge) / 0.09)' }}
    />
  )
}

function Delta({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className={`${ROW} gap-1`}>
      <span className={`text-zinc-500 ${LABEL}`}>{label}</span>
      <span className={DATA} style={{ color }}>
        +{formatNumber(value)}
      </span>
    </span>
  )
}

export interface ChaseInfo {
  gap: number
  username: string
}

// Lazy: keeps html-to-image + qrcode out of the leaderboard bundle until
// someone actually opens the share sheet.
const ShareSheet = dynamic(() => import('./share/ShareSheet').then((m) => m.ShareSheet), {
  ssr: false
})

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
  const [shareOpen, setShareOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  const enterTl = useRef<gsap.core.Timeline | null>(null)
  const { play } = useSfx()

  // Latest onClose without re-wiring listeners when the parent re-renders.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const medal = medalFor(row.rank)
  const edgeRgb = medal ? medal.rgb : 'var(--lb-panel-edge)'

  // ---- graceful close: play the exit animation, then unmount ---------
  // No `open` counterpart here: the CRT screen click plays its own
  // pressStart confirm, and other open paths keep the default tap.
  const requestClose = useCallback(() => setClosing(true), [])

  useEffect(() => {
    if (!closing) return
    // Sound lives on the state transition, not in requestClose, so
    // mashing Escape during the exit animation plays it only once.
    play('close')
    exitCard(rootRef.current!, enterTl.current, () => onCloseRef.current())
  }, [closing, play])

  // ---- extended profile hydration ----------------------------------
  // Same payload as the leaderboard profile plus follow counts and the
  // viewer relationship, so the card can offer FOLLOW at discovery.
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

  // ---- motion --------------------------------------------------------
  useGSAP(
    () => {
      enterTl.current = enterCard(rootRef.current!, {
        mobile: window.matchMedia('(max-width: 639px)').matches
      })
    },
    { scope: rootRef }
  )

  useGSAP(
    () => {
      if (profile || profileFailed) hydrateIn(rootRef.current!)
    },
    { dependencies: [profile, profileFailed], scope: rootRef }
  )

  useEffect(() => bindTilt(tiltRef.current!), [])

  // ---- merged data (row renders instantly, profile enriches) --------
  const tools = profile?.topTools?.length ? profile.topTools : row.topTools || []
  // /api/leaderboard carries no agent data: AGENTIC appears on hydration.
  const agents = profile?.topAgents ?? []
  const todayScore = profile?.todayScore ?? row.todayScore
  const weekScore = profile?.weekScore ?? row.weekScore
  const badges = profile?.badges ?? null

  // inFlight is the server's "this pin is the project", so the pinned
  // copy of the project is the one hangar card not counted again.
  const hangar = profile?.hangar ?? []
  const hangarBeyondPill = hangar.filter((card) => !card.inFlight).length

  const roleKey = (profile?.role ?? row.role) || null
  const RoleIcon = roleKey ? ROLE_ICONS[roleKey] : undefined
  const roleLabel = roleKey ? ROLE_META[roleKey] : null

  // The affiliation mini-logo renders straight off the standings row; the
  // gold badge waits for the profile — isTeam is the server-verified
  // "tier TEAM AND review approved" gate, tier alone must not light it.
  // The square avatar keys off the raw tier only until the profile
  // answers; once hydrated its verdict is authoritative.
  const team = profile?.team ?? row.team ?? null
  const isTeamAccount = profile?.isTeam === true
  const squareAvatar = profile ? isTeamAccount : row.tier === 'TEAM'
  const avatarRound = squareAvatar ? 'rounded-xl' : 'rounded-full'
  const avatarImgRound = squareAvatar ? 'rounded-lg' : 'rounded-full'

  // ---- follow context (arrives with the profile hydration) ----------
  const viewer = profile?.viewer ?? null
  const followerCount = profile?.followers ?? null
  // The follow slot is reserved from the first frame with a pulsing ghost
  // that hydrateIn fades out, so the control fades into a place that was
  // already there (or, signed out, the pulse simply fades to nothing).
  const canFollow = !isYou && viewer !== null && !viewer.isYou

  const isPrivateAccount = profile?.isPrivate === true

  const mrzInput: MrzInput = {
    username: row.username,
    rank: row.rank,
    score: row.score,
    joined: profile?.memberSince ?? row.memberSince,
    isActive: row.isActive,
    seenLabel: formatRelative(row.lastSeen),
    role: roleLabel
  }
  const [mrz1, mrz2] = buildMrz(mrzInput)

  // ---- share card mapping --------------------------------------------
  // viewer is non-null exactly when the profile request carried a valid
  // session; before hydration the sheet stays optimistic and degrades on
  // a failed referral fetch.
  const shareSignedIn = profile ? profile.viewer != null : true
  const shareData: ShareCardData = {
    username: row.username,
    displayName: row.display_name || null,
    profileImage: row.profile_image,
    rank: row.rank,
    score: row.score,
    todayScore,
    weekScore,
    topTools: tools,
    badges: badges ?? [],
    memberSince: profile?.memberSince ?? row.memberSince ?? null,
    isTeam: squareAvatar
  }

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

  return createPortal(
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[70] flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] font-mono sm:items-center sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] ${
        closing ? 'pointer-events-none' : ''
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={`Player profile — @${row.username}`}
    >
      <div
        data-pc="backdrop"
        className="pc-backdrop absolute inset-0"
        onClick={requestClose}
        aria-hidden
      />

      <div data-pc="card" className="relative w-full max-w-[640px]">
        <div
          ref={tiltRef}
          data-pc="tilt"
          className="pc-tilt relative max-h-[calc(100svh-2rem)] overflow-y-auto overscroll-contain rounded-[20px] [--pc-pad:10px] sm:[--pc-pad:14px]"
          style={{
            background: `linear-gradient(180deg, rgb(255 255 255 / 0.04), transparent 30%), rgb(var(--lb-panel-bg))`,
            border: `1px solid ${medal ? medalA(medal.rgb, 0.45) : 'rgb(var(--lb-panel-edge) / 0.14)'}`,
            boxShadow: medal
              ? `0 30px 90px -30px ${medalA(medal.rgb, 0.4)}, 0 24px 60px -28px rgb(0 0 0 / 0.9)`
              : '0 30px 80px -30px rgb(0 0 0 / 0.95)'
          }}
        >
          {/* holographic sheen follows the pointer via --mx/--my */}
          <div
            aria-hidden
            className="pc-sheen pointer-events-none absolute inset-0 z-10 rounded-[20px]"
            style={{
              background: `radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), ${
                medal ? medalA(medal.rgb, 0.07) : 'rgb(255 255 255 / 0.07)'
              }, transparent 60%)`,
              mixBlendMode: 'soft-light'
            }}
          />

          {/* ---------- chrome ---------- */}
          <div data-pc="zone" className="relative h-14 overflow-hidden sm:h-20">
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
                className="absolute -bottom-3 right-3 select-none text-[56px] leading-none opacity-[0.13] [font-family:var(--font-pixel)]"
                style={{ color: medal ? medal.fg : 'rgb(var(--lb-panel-edge))' }}
              >
                #{row.rank}
              </span>
            </div>
            {row.banner_image && (
              <SafeBannerImg
                src={row.banner_image}
                frame={row.banner_frame}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-10"
              style={{ background: 'linear-gradient(180deg, transparent, rgb(var(--lb-panel-bg)))' }}
            />

            {/* rank plate — bright literals: the pill scrim stays dark in both themes */}
            <div className="absolute left-3 top-3 flex items-center gap-2">
              <span
                className={`${ROW} rounded-[6px] px-2 ${PLATE}`}
                style={{
                  color: medal ? `rgb(${medal.plate})` : 'rgb(244 244 245)',
                  background: SCRIM.background,
                  border: `1px solid ${medal ? `rgb(${medal.plate} / 0.5)` : 'rgb(255 255 255 / 0.14)'}`,
                  textShadow: medal ? `0 0 14px rgb(${medal.plate} / 0.6)` : undefined
                }}
              >
                #{row.rank}
              </span>
              {row.rankDelta !== 0 && (
                <span
                  className={`${ROW} gap-1 rounded-[6px] px-2 ${DATA}`}
                  style={{
                    color: row.rankDelta > 0 ? `rgb(${PLATE_UP})` : `rgb(${PLATE_DOWN})`,
                    background: SCRIM.background,
                    border: '1px solid rgb(255 255 255 / 0.1)'
                  }}
                >
                  <MoveGlyph dir={row.rankDelta > 0 ? 'up' : 'down'} size={7} />
                  {Math.abs(row.rankDelta)}
                </span>
              )}
              {row.isNew && row.rankDelta === 0 && (
                <span
                  className={`${ROW} rounded-[6px] px-2 ${LABEL}`}
                  style={{
                    color: 'rgb(255 214 68)',
                    background: SCRIM.background,
                    border: '1px solid rgb(255 214 68 / 0.4)'
                  }}
                >
                  NEW
                </span>
              )}
            </div>

            <div className="absolute right-3 top-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                aria-label="Share card"
                title="Share card"
                className={CONTROL}
                style={SCRIM}
              >
                <IconShare size={14} />
              </button>
              <Link
                href={`/u/${encodeURIComponent(row.username)}`}
                aria-label="Open full profile"
                title="Open full profile"
                className={CONTROL}
                style={SCRIM}
              >
                <IconExpand size={14} />
              </Link>
              <button
                type="button"
                onClick={requestClose}
                data-sfx="off"
                autoFocus
                aria-label="Close profile"
                className={CONTROL}
                style={SCRIM}
              >
                <IconClose size={14} />
              </button>
            </div>
          </div>

          <Hair />

          {/* ---------- identity: 20px rows on a 4px pitch ----------
              mobile:  avatar | name      desktop: avatar | name    | score
                       avatar | meta               avatar | meta    | score
                       actions                     avatar | actions | score
                       score                       chase            | score
                       chase                                                 */}
          <div
            data-pc="zone"
            className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 p-[var(--pc-pad)] sm:grid-cols-[auto_1fr_auto]"
          >
            <div className="relative -mt-5 row-span-2 sm:row-span-3">
              {row.rank === 1 && (
                <span
                  aria-hidden
                  className="pc-crown absolute -top-6 left-1/2 -translate-x-1/2 text-[rgb(var(--lb-gold))]"
                >
                  <IconCrown size={18} />
                </span>
              )}
              <div className="relative h-14 w-14 sm:h-16 sm:w-16">
                {medal && row.rank === 1 ? (
                  <span
                    aria-hidden
                    className={`pc-ring-spin absolute -inset-[3px] ${avatarRound}`}
                    style={{
                      background: `conic-gradient(from 0deg, transparent 0deg, ${medalA(medal.rgb, 0.9)} 80deg, rgb(var(--lb-gold-hi)) 120deg, transparent 200deg, ${medalA(medal.rgb, 0.55)} 300deg, transparent 360deg)`,
                      filter: `drop-shadow(0 0 10px ${medalA(medal.rgb, 0.55)})`
                    }}
                  />
                ) : (
                  <span
                    aria-hidden
                    className={`absolute -inset-[3px] ${avatarRound}`}
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
                  className={`absolute inset-0 ${avatarRound}`}
                  style={{ boxShadow: `inset 0 0 0 3px rgb(var(--lb-panel-bg))` }}
                />
                <Avatar
                  src={row.profile_image}
                  char={row.username[0]?.toUpperCase() ?? '?'}
                  handle={row.username}
                  imgClassName={`absolute inset-[3px] h-[50px] w-[50px] sm:h-[58px] sm:w-[58px] ${avatarImgRound} object-cover`}
                  fallbackClassName={`absolute inset-[3px] flex items-center justify-center ${avatarImgRound} bg-zinc-900 font-display text-xl text-zinc-300`}
                />
                {row.isActive && (
                  <span
                    className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full"
                    style={{
                      background: 'rgb(var(--lb-up))',
                      boxShadow: '0 0 8px rgb(var(--lb-up) / 0.8), inset 0 0 0 2px rgb(var(--lb-panel-bg))'
                    }}
                    title="Online"
                  />
                )}
              </div>
            </div>

            {/* name */}
            <div className={`${ROW} min-w-0 gap-2 sm:col-start-2 sm:row-start-1`}>
              <span className={`truncate ${NAME}`}>{row.display_name || `@${row.username}`}</span>
              {isProTier(row.tier) && <VerifiedBadge size={15} />}
              {isTeamAccount && <TeamBadge size={15} />}
              {team && <TeamMiniLogo team={team} size={15} />}
              {isYou && (
                <span className={`${TAG} shrink-0 border-accent/40 bg-accent/10 text-accent`}>YOU</span>
              )}
            </div>

            {/* meta */}
            <div className={`${ROW} min-w-0 gap-2 text-zinc-500 sm:col-start-2 sm:row-start-2`}>
              <span className={`truncate ${DATA}`}>@{row.username}</span>
              {(profile?.isPrivate ?? row.isPrivate) && (
                <span className="shrink-0 text-zinc-600" title="Private account">
                  <IconLock size={10} />
                </span>
              )}
              {viewer?.followsYou && !isYou && (
                <span data-pc-late="" className={`${ROW} shrink-0 gap-2`}>
                  <span className="text-zinc-700">·</span>
                  <span className={LABEL}>FOLLOWS YOU</span>
                </span>
              )}
            </div>

            {/* actions: tags + the follow control (slot reserved from mount) */}
            <div className={`${ROW} col-span-2 gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-3`}>
              {medal && (
                <span
                  className={`${TAG} hidden shrink-0 md:flex`}
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
                <span
                  className={`${TAG} shrink-0 border-zinc-700/70 bg-[rgb(var(--lb-panel-edge)/0.03)] text-zinc-400`}
                >
                  {RoleIcon && <RoleIcon size={10} />}
                  {roleLabel}
                </span>
              )}
              {!isYou && (
                <span className="relative inline-flex h-5 min-w-[88px]">
                  <span
                    data-pc="ghost"
                    aria-hidden
                    className="pc-ghost absolute inset-0 rounded-[6px]"
                  />
                  {canFollow && (
                    <span data-pc-late="" className="relative inline-flex h-5">
                      <FollowButton
                        targetUserId={row.userId}
                        following={viewer.isFollowing}
                        followsYou={viewer.followsYou}
                        signedIn
                        size="xs"
                        className="rounded-l-[6px] rounded-r-none"
                        onChange={handleFollowChange}
                      />
                      {followerCount !== null && (
                        <span
                          className={`${ROW} rounded-r-[6px] border border-l-0 border-zinc-700/70 px-2 text-zinc-300 ${DATA}`}
                          title={`${formatNumber(followerCount)} ${followerCount === 1 ? 'follower' : 'followers'}`}
                        >
                          {formatNumber(followerCount)}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              )}
            </div>

            {/* score: right column on desktop, a two-column row on mobile */}
            <div className="col-span-2 flex items-start justify-between gap-3 sm:col-span-1 sm:col-start-3 sm:row-span-4 sm:row-start-1 sm:flex-col sm:items-end sm:justify-start sm:gap-1">
              <div className="flex flex-col gap-1 sm:items-end">
                <span className={`${ROW} text-zinc-500 ${LABEL}`}>LIFETIME SCORE</span>
                <span
                  title={`${formatNumber(row.score)} pts`}
                  className={`flex h-6 items-center sm:h-8 ${MACRO}`}
                  style={{
                    color: 'rgb(var(--lb-score))',
                    textShadow: medal
                      ? '0 0 18px rgb(var(--lb-score) / calc(0.55 * var(--lb-glow, 1))), 0 0 44px rgb(var(--lb-score) / calc(0.22 * var(--lb-glow, 1)))'
                      : '0 0 18px rgb(var(--lb-score) / calc(0.28 * var(--lb-glow, 1)))'
                  }}
                >
                  <AnimatedCounter
                    value={row.score}
                    duration={900}
                    formatter={(v) => formatScore(Math.round(v))}
                  />
                </span>
              </div>
              <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                <Delta
                  label="TODAY"
                  value={todayScore}
                  color={todayScore > 0 ? 'rgb(var(--lb-delta))' : 'rgb(var(--z600))'}
                />
                <span className="hidden text-zinc-700 sm:inline">·</span>
                <Delta label="7D" value={weekScore} color="rgb(var(--z400))" />
              </div>
            </div>

            {/* chase / throne: rhymes with the ShareRows below */}
            {(chase || row.rank === 1) && (
              <div className={`${ROW} col-span-2 min-w-0 gap-2 sm:row-start-4 ${DATA}`}>
                <span className={CHIP.className} style={CHIP.style}>
                  {row.rank === 1 ? (
                    <IconCrown size={12} className="text-[rgb(var(--lb-gold))]" />
                  ) : (
                    <IconTarget size={12} className="text-zinc-500" />
                  )}
                </span>
                {row.rank === 1 ? (
                  <span className="truncate text-zinc-300">
                    HOLDING THE THRONE
                    {chase && <span className="text-zinc-500"> · {formatNumber(chase.gap)} PTS AHEAD</span>}
                  </span>
                ) : (
                  chase && (
                    <span className="truncate text-zinc-400">
                      <span className="text-zinc-100">{formatNumber(chase.gap)} PTS</span> TO OVERTAKE{' '}
                      <span className="text-zinc-200">@{chase.username}</span>
                    </span>
                  )
                )}
              </div>
            )}
          </div>

          <Hair />

          {/* ---------- telemetry: tools | badges ---------- */}
          <div className="grid sm:grid-cols-[1fr_1px_1fr]">
            <div data-pc="zone" className="min-w-0 p-[var(--pc-pad)]">
              <div className={`${ROW} justify-between text-zinc-500 ${LABEL}`}>
                <span>TOP TOOLS</span>
                <span className="text-zinc-700">SHARE OF SCORE</span>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {tools.length === 0 &&
                  (profile?.restricted ? (
                    <div className={`${ROW} gap-2 text-zinc-600 ${LABEL}`}>
                      <IconLock size={10} />
                      FOLLOWERS ONLY
                    </div>
                  ) : (
                    <div className={`${ROW} text-zinc-600 ${LABEL}`}>NO FIELD DATA YET</div>
                  ))}
                {tools.slice(0, 3).map((tool, i) => (
                  <ShareRow
                    key={tool.name}
                    icon={<ToolIcon name={tool.name} size={12} />}
                    label={tool.name}
                    percent={tool.percent}
                    fill={i === 0 && medal ? { medalRgb: medal.rgb, medalFg: medal.fg } : 'neutral'}
                    iconColor={i === 0 && medal ? medal.fg : undefined}
                  />
                ))}
              </div>
              {agents.length > 0 && (
                <>
                  <Hair late className="mt-3" />
                  <div data-pc-late="" className={`${ROW} mt-3 justify-between text-zinc-500 ${LABEL}`}>
                    <span>AGENTIC</span>
                    <span className="text-zinc-700">SHARE OF TOKENS</span>
                  </div>
                  {/* Only the #1 agent — the full mix lives on the profile page.
                      Ember, the Burn Board's hue: tokens are a different
                      currency than the score bars above. */}
                  <div data-pc-late="" className="mt-2 flex flex-col gap-2">
                    {agents.slice(0, 1).map((agent) => (
                      <ShareRow
                        key={agent.name}
                        icon={<TokenAgentIcon agent={agent.name} bare size={12} />}
                        label={tokenAgentLabel(agent.name) ?? agent.name}
                        percent={agent.percent}
                        fill="ember"
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <Hair className="sm:hidden" />
            <div
              data-pc="hair-v"
              aria-hidden
              className="hidden w-px self-stretch sm:block"
              style={{ background: 'rgb(var(--lb-panel-edge) / 0.09)' }}
            />

            <div data-pc="zone" className="min-w-0 p-[var(--pc-pad)]">
              <div className={`${ROW} justify-between text-zinc-500 ${LABEL}`}>
                <span>BADGES</span>
                {profile?.restricted ? (
                  <span className={`${ROW} gap-1 text-zinc-600`}>
                    <IconLock size={9} />
                    PRIVATE
                  </span>
                ) : (
                  badges !== null && (
                    <span data-pc-late="" className="tabular-nums text-zinc-600">
                      {badges.length}
                      <span className="text-zinc-700">/{ACHIEVEMENTS.length}</span>
                    </span>
                  )
                )}
              </div>
              <div className="mt-2">
                {badges === null && !profileFailed && (
                  <div className="grid grid-cols-8 gap-1">
                    {Array.from({ length: 16 }, (_, i) => (
                      <div
                        key={i}
                        className="aspect-square animate-pulse rounded-[6px] bg-[rgb(var(--lb-panel-edge)/0.05)]"
                      />
                    ))}
                  </div>
                )}
                {badges === null && profileFailed && (
                  <div className={`${ROW} text-zinc-600 ${LABEL}`}>RECORD UNAVAILABLE</div>
                )}
                {badges !== null &&
                  badges.length === 0 &&
                  (profile?.restricted ? (
                    <div className={`${ROW} gap-2 text-zinc-600 ${LABEL}`}>
                      <IconLock size={10} />
                      FOLLOWERS ONLY
                    </div>
                  ) : (
                    <div className={`${ROW} text-zinc-600 ${LABEL}`}>NO DECORATIONS YET</div>
                  ))}
                {badges !== null && badges.length > 0 && (
                  <div className="grid grid-cols-8 gap-1">
                    {badges.slice(0, 15).map((badge) => (
                      <div
                        key={badge.id}
                        data-pc="badge"
                        data-pc-late=""
                        title={`${badge.name} — ${badge.description}`}
                        className="flex aspect-square items-center justify-center rounded-[6px]"
                        style={{
                          background: rarityColorA(badge.rarity, 0.07),
                          border: `1px solid ${rarityColorA(badge.rarity, 0.3)}`
                        }}
                      >
                        <PixelIcon name={badge.icon} size={18} />
                      </div>
                    ))}
                    {badges.length > 15 && (
                      <div
                        data-pc="badge"
                        data-pc-late=""
                        className={`flex aspect-square items-center justify-center rounded-[6px] text-zinc-400 ${LABEL}`}
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

              {/* One line when the name fits; a long name pushes the hangar
                  pointer onto its own right-aligned line instead of
                  truncating to a glyph. */}
              {(profile?.project || hangarBeyondPill > 0) && (
                <>
                  <Hair late className="mt-3" />
                  <div data-pc-late="" className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {profile?.project && (
                      <a
                        href={profile.project.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={profile.project.url}
                        className={`group ${ROW} min-w-0 max-w-full gap-2`}
                      >
                        <span className={`shrink-0 text-zinc-500 ${LABEL}`}>NOW BUILDING</span>
                        <span
                          className={`flex-[1_1_auto] min-w-[10ch] truncate text-zinc-200 transition-colors group-hover:text-zinc-50 ${BODY}`}
                        >
                          {profile.project.name}
                        </span>
                      </a>
                    )}
                    {hangarBeyondPill > 0 && (
                      <Link
                        href={`/u/${encodeURIComponent(row.username)}#hangar`}
                        className={`${ROW} ml-auto shrink-0 text-zinc-500 transition-colors hover:text-zinc-200 ${LABEL}`}
                      >
                        {profile?.project
                          ? `+${hangarBeyondPill} MORE IN HANGAR →`
                          : `${hangarBeyondPill} IN HANGAR →`}
                      </Link>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <Hair />

          {/* ---------- MRZ footer (min-h-7 = the social anchors' height) ---------- */}
          <div data-pc="zone" className="flex min-h-7 flex-wrap items-center gap-3 p-[var(--pc-pad)]">
            <div
              aria-hidden
              className="flex min-w-0 select-none flex-col gap-0.5 overflow-hidden whitespace-pre text-[9px] leading-[12px] tracking-[0.18em] [font-family:var(--font-data)]"
            >
              <span className="text-zinc-500">
                {Array.from(mrz1, (ch, i) => (
                  <span key={i} data-pc="mrz-ch">
                    {ch}
                  </span>
                ))}
              </span>
              <span className="text-zinc-600">
                {Array.from(mrz2, (ch, i) => (
                  <span key={i} data-pc="mrz-ch">
                    {ch}
                  </span>
                ))}
              </span>
            </div>
            <span className="sr-only">{mrzPlainText(mrzInput)}</span>
            {profile && (
              <span data-pc-late="" className="ml-auto flex shrink-0">
                <SocialLinkRow username={row.username} socials={profile.socials} website={profile.website} />
              </span>
            )}
          </div>
        </div>
      </div>

      {shareOpen && (
        <ShareSheet
          data={shareData}
          variant="medal"
          isYou={isYou}
          signedIn={shareSignedIn}
          onClose={() => setShareOpen(false)}
        />
      )}

      <style jsx global>{`
        .pc-backdrop {
          background: rgb(0 0 0 / 0.78);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        html.light .pc-backdrop {
          /* white veil — matches the light canvas instead of dimming it */
          background: rgb(255 255 255 / 0.72);
        }
        html.light .pc-sheen {
          display: none;
        }

        .pc-ctl {
          color: rgb(212 212 216);
        }
        .pc-ctl:hover {
          color: rgb(250 250 250);
        }

        /* GSAP writes --rx/--ry from the pointer; the transform just reads them */
        .pc-tilt {
          transform: perspective(1100px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
          will-change: transform;
          scrollbar-width: none;
        }
        .pc-tilt::-webkit-scrollbar {
          display: none;
        }

        /* follow-slot ghost: pulses the fill, not opacity, so hydrateIn's
           opacity fade is not overridden by the keyframes */
        .pc-ghost {
          animation: pc-ghost-pulse 1.6s ease-in-out infinite;
        }
        @keyframes pc-ghost-pulse {
          0%,
          100% {
            background: rgb(var(--lb-panel-edge) / 0.04);
          }
          50% {
            background: rgb(var(--lb-panel-edge) / 0.09);
          }
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

        @media (prefers-reduced-motion: reduce) {
          .pc-crown,
          .pc-ring-spin,
          .pc-ghost {
            animation: none;
          }
          .pc-ghost {
            background: rgb(var(--lb-panel-edge) / 0.06);
          }
          .pc-tilt {
            will-change: auto;
          }
        }
      `}</style>
    </div>,
    document.body
  )
}
