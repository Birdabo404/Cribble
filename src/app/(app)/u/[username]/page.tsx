'use client'

// Public pilot profile — /u/[username].
//
// Reads like an X profile (banner → avatar → identity → bio → meta →
// counts) so nobody has to learn it, but every material is Cribble's
// own: Space Grotesk identity, Press Start 2P numerals, synthwave
// banner duotone, pixel-art service record.
//
// Follow psychology, deliberately placed: FOLLOWS YOU sits beside the
// handle to trigger reciprocity; follower counts render in the score
// font (a stat worth growing); "Followed by @a and @b" lends social
// proof; both counts open rosters with inline follow buttons.
//
// Backdrop: no starfield here (AppShell skips it on /u/*). Instead the
// pilot's banner is blown up into a blurred aurora behind the page —
// see ProfileAmbience. It mounts OUTSIDE .page-zoom-out because zoom
// distorts fixed-position descendants.

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import {
  formatDuration,
  formatNumber,
  formatRelative,
  tierAccent
} from '@/components/dashboard-v2/format'
import { Avatar, SafeBannerImg } from '@/components/leaderboard/Avatar'
import {
  IconCalendar,
  MoveGlyph,
  SOCIAL_LABEL,
  SocialIcon,
  socialHref,
  ToolIcon,
  type SocialKind
} from '@/components/leaderboard/icons'
import { medalA, medalFor, ROLE_META } from '@/components/leaderboard/types'
import { EditProfileModal, type EditableProfile } from '@/components/profile/EditProfileModal'
import { FollowButton, FollowsYouChip, type FollowChange } from '@/components/profile/FollowButton'
import { FollowListModal, type FollowListKind } from '@/components/profile/FollowListModal'
import { ProfileAmbience } from '@/components/profile/ProfileAmbience'
import { ACHIEVEMENTS } from '@/lib/achievements'
import type { Tier } from '@/types/dashboard'
import type { PublicProfileData } from '@/types/profile'
import { ROLE_ICONS } from '@/components/roleIcons'

const SOCIAL_KINDS: SocialKind[] = ['x', 'github', 'youtube', 'linkedin']

const rarityColor = (rarity: string) => `rgb(var(--r-${rarity}))`
const rarityColorA = (rarity: string, alpha: number) => `rgb(var(--r-${rarity}) / ${alpha})`

const monthYear = (iso: string | null | undefined) => {
  if (!iso) return '—'
  return new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase()
}

const prettyUrl = (raw: string) =>
  raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')

/* ---------- small stroke icons (24px grid, Lucide path data) ---------- */

function Stroke({ size = 12, className = '', d }: { size?: number; className?: string; d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}

const PATH_PIN =
  'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
const PATH_LINK =
  'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
const PATH_SHARE =
  'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13'
const PATH_EDIT =
  'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z'

/* ===================================================================== */

// Next 15: route params arrive as a Promise; unwrap with React.use().
export default function PilotProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params)

  const [profile, setProfile] = useState<PublicProfileData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [roster, setRoster] = useState<FollowListKind | null>(null)
  const [editing, setEditing] = useState(false)
  const [editInitial, setEditInitial] = useState<EditableProfile | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchProfile = useCallback(async () => {
    const res = await fetch(`/api/profile/${encodeURIComponent(username)}`, {
      credentials: 'include',
      cache: 'no-store'
    })
    if (res.status === 404 || res.status === 400) return 'missing' as const
    if (!res.ok) return 'error' as const
    const data = await res.json()
    if (!data.success || !data.profile) return 'error' as const
    return data.profile as PublicProfileData
  }, [username])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetchProfile()
      .then((result) => {
        if (cancelled) return
        if (result === 'missing' || result === 'error') {
          setStatus(result)
          return
        }
        setProfile(result)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [fetchProfile])

  // Silent refresh (post-edit / post-roster-changes): keep the page up
  // without blanking it back to the skeleton.
  const refreshProfile = useCallback(() => {
    fetchProfile()
      .then((result) => {
        if (result !== 'missing' && result !== 'error') setProfile(result)
      })
      .catch(() => {})
  }, [fetchProfile])

  useEffect(() => {
    if (profile) document.title = `@${profile.username} — Cribble`
  }, [profile])

  const handleFollowChange = useCallback((change: FollowChange) => {
    setProfile((p) => {
      if (!p || !p.viewer) return p
      const wasFollowing = p.viewer.isFollowing
      const followers =
        change.followers !== null
          ? change.followers
          : p.followers +
            (change.following === wasFollowing ? 0 : change.following ? 1 : -1)
      return {
        ...p,
        followers: Math.max(0, followers),
        viewer: { ...p.viewer, isFollowing: change.following }
      }
    })
  }, [])

  const openEditor = useCallback(async () => {
    // Edit from the user's *saved* values, not the profile view — the view
    // backfills socials from the OAuth provider, which shouldn't get
    // written back as if the user typed them.
    try {
      const res = await fetch('/api/user/profile', { credentials: 'include', cache: 'no-store' })
      const data = res.ok ? await res.json() : null
      const saved = data?.profile
      setEditInitial({
        bio: saved?.bio || '',
        location: saved?.location || '',
        website: saved?.website || '',
        banner_image: saved?.banner_image || '',
        role: saved?.role || null,
        socials: {
          x: saved?.socials?.x || '',
          github: saved?.socials?.github || '',
          youtube: saved?.socials?.youtube || '',
          linkedin: saved?.socials?.linkedin || ''
        }
      })
      setEditing(true)
    } catch {
      setEditInitial({
        bio: '',
        location: '',
        website: '',
        banner_image: '',
        role: null,
        socials: { x: '', github: '', youtube: '', linkedin: '' }
      })
      setEditing(true)
    }
  }, [])

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/u/${encodeURIComponent(username)}`
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }, [username])

  /* ---------------- derived ---------------- */

  const medal = profile?.rank ? medalFor(profile.rank) : null
  const signedIn = profile?.viewer !== null && profile?.viewer !== undefined
  const isYou = profile?.viewer?.isYou ?? false

  const socialEntries = useMemo(() => {
    if (!profile) return []
    return SOCIAL_KINDS.map((kind) => ({ kind, value: profile.socials[kind] })).filter(
      (e): e is { kind: SocialKind; value: string } => Boolean(e.value)
    )
  }, [profile])

  const roleKey = profile?.role || null
  const RoleIcon = roleKey ? ROLE_ICONS[roleKey] : undefined
  const roleLabel = roleKey ? ROLE_META[roleKey] : null

  /* ---------------- render ---------------- */

  if (status !== 'ready' || !profile) {
    const fallback =
      status === 'missing' ? (
        <MissingPilot username={username} />
      ) : status === 'loading' ? (
        <ProfileSkeleton />
      ) : (
        <ProfileError />
      )
    return (
      <>
        <ProfileAmbience src={null} />
        {fallback}
      </>
    )
  }

  const bannerEdge = medal ? medal.rgb : 'var(--banner-a)'

  const page = (
    <div className="page-zoom-out relative mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      {/* ---------- hero card ---------- */}
      <section className="pf-reveal overflow-hidden rounded-2xl glass-pop" style={{ ['--rv' as string]: '0ms' }}>
        {/* banner */}
        <div className="relative h-40 overflow-hidden sm:h-48">
          <div aria-hidden className="absolute inset-0">
            <div
              className="absolute inset-0"
              style={{
                background: [
                  `radial-gradient(120% 140% at 18% -10%, ${medalA(bannerEdge, 0.32)}, transparent 55%)`,
                  `radial-gradient(90% 130% at 92% 6%, rgb(var(--banner-b) / 0.24), transparent 60%)`,
                  `repeating-linear-gradient(90deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 24px)`,
                  `repeating-linear-gradient(0deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 24px)`
                ].join(', ')
              }}
            />
            {profile.rank !== null && (
              <span
                className="absolute -bottom-3 right-4 select-none text-[64px] leading-none opacity-[0.12] [font-family:var(--font-pixel)]"
                style={{ color: medal ? medal.fg : 'rgb(var(--banner-a))' }}
              >
                #{profile.rank}
              </span>
            )}
          </div>
          {profile.banner_image && (
            <SafeBannerImg
              src={profile.banner_image}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-16"
            style={{ background: 'linear-gradient(180deg, transparent, rgb(0 0 0 / 0.55))' }}
          />
        </div>

        {/* identity */}
        <div className="px-5 pb-6 sm:px-7">
          <div className="flex items-end justify-between gap-3">
            {/* avatar overlapping the banner */}
            <div className="relative -mt-12 sm:-mt-14">
              <div className="relative h-[92px] w-[92px] sm:h-[104px] sm:w-[104px]">
                <span
                  aria-hidden
                  className="absolute -inset-[3px] rounded-full"
                  style={{
                    background: medal
                      ? `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.9)}, ${medalA(medal.rgb, 0.25)}, ${medalA(medal.rgb, 0.9)})`
                      : 'rgb(var(--z800))',
                    boxShadow: medal ? `0 0 22px ${medalA(medal.rgb, 0.35)}` : undefined
                  }}
                />
                <span aria-hidden className="absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 0 4px rgb(var(--background))' }} />
                <Avatar
                  src={profile.profile_image}
                  char={profile.username[0]?.toUpperCase() ?? '?'}
                  imgClassName="absolute inset-[4px] h-[calc(100%-8px)] w-[calc(100%-8px)] rounded-full object-cover"
                  fallbackClassName="absolute inset-[4px] flex h-[calc(100%-8px)] w-[calc(100%-8px)] items-center justify-center rounded-full bg-zinc-900 font-display text-3xl text-zinc-300"
                />
                {profile.isActive && (
                  <span
                    className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 rounded-full"
                    style={{
                      background: 'rgb(var(--lb-up))',
                      boxShadow: '0 0 8px rgb(var(--lb-up) / 0.8), inset 0 0 0 2.5px rgb(var(--background))'
                    }}
                    title="Online"
                  />
                )}
              </div>
            </div>

            {/* action cluster */}
            <div className="flex items-center gap-2 pb-1">
              {isYou ? (
                <>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-accent"
                    aria-label="Copy profile link"
                    title={copied ? 'Copied' : 'Copy profile link'}
                  >
                    {copied ? (
                      <span className="text-[8px] tracking-[0.1em] text-accent">OK</span>
                    ) : (
                      <Stroke d={PATH_SHARE} size={13} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={openEditor}
                    className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-200 transition-colors hover:border-accent/50 hover:text-accent"
                  >
                    <Stroke d={PATH_EDIT} size={11} />
                    EDIT PROFILE
                  </button>
                </>
              ) : (
                <FollowButton
                  targetUserId={profile.userId}
                  following={profile.viewer?.isFollowing ?? false}
                  followsYou={profile.viewer?.followsYou ?? false}
                  signedIn={signedIn}
                  onChange={handleFollowChange}
                />
              )}
            </div>
          </div>

          {/* name + handle */}
          <div className="mt-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-50">
                {profile.display_name}
              </h1>
              {medal && (
                <span
                  className="rounded border px-2 py-0.5 text-[9px] tracking-[0.25em]"
                  style={{
                    color: medal.fg,
                    borderColor: medalA(medal.rgb, 0.45),
                    background: medalA(medal.rgb, 0.08)
                  }}
                >
                  {medal.label}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-zinc-500">@{profile.username}</span>
              {profile.viewer?.followsYou && !isYou && <FollowsYouChip />}
              <span className={`rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em] ${tierAccent(profile.tier as Tier)}`}>
                {profile.tier}
              </span>
              {roleLabel && (
                <span className="flex items-center gap-1.5 rounded border border-zinc-700/70 bg-white/[0.03] px-1.5 py-0.5 text-[8px] tracking-[0.25em] text-zinc-400">
                  {RoleIcon && <RoleIcon size={9} />}
                  {roleLabel}
                </span>
              )}
            </div>
          </div>

          {/* bio — plain body copy, reads like any other profile */}
          {profile.bio ? (
            <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-zinc-200">
              {profile.bio}
            </p>
          ) : isYou ? (
            <button
              type="button"
              onClick={openEditor}
              className="mt-4 block text-left text-[13px] text-zinc-600 transition-colors hover:text-zinc-400"
            >
              No bio yet — tell people what you do.
            </button>
          ) : null}

          {/* meta row */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-zinc-500">
            {profile.location && (
              <span className="flex items-center gap-1.5">
                <Stroke d={PATH_PIN} className="text-zinc-600" />
                {profile.location}
              </span>
            )}
            {profile.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-accent/90 transition-colors hover:text-accent"
              >
                <Stroke d={PATH_LINK} className="text-accent/60" />
                {prettyUrl(profile.website)}
              </a>
            )}
            <span className="flex items-center gap-1.5">
              <IconCalendar size={12} className="text-zinc-600" />
              PILOT SINCE {monthYear(profile.memberSince)}
            </span>
            <span className="flex items-center gap-1.5">
              {profile.isActive ? (
                <span style={{ color: 'rgb(var(--lb-up))' }}>ONLINE NOW</span>
              ) : (
                <span>SEEN {formatRelative(profile.lastSeen).toUpperCase()}</span>
              )}
            </span>
          </div>

          {/* follow counts + social proof */}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              onClick={() => setRoster('following')}
              className="group flex items-baseline gap-2"
            >
              <span className="text-[13px] tabular-nums text-zinc-50 [font-family:var(--font-pixel)]">
                {formatNumber(profile.following)}
              </span>
              <span className="text-[9px] tracking-[0.3em] text-zinc-500 transition-colors group-hover:text-zinc-200">
                FOLLOWING
              </span>
            </button>
            <button
              type="button"
              onClick={() => setRoster('followers')}
              className="group flex items-baseline gap-2"
            >
              <span className="text-[13px] tabular-nums text-zinc-50 [font-family:var(--font-pixel)]">
                {formatNumber(profile.followers)}
              </span>
              <span className="text-[9px] tracking-[0.3em] text-zinc-500 transition-colors group-hover:text-zinc-200">
                {profile.followers === 1 ? 'FOLLOWER' : 'FOLLOWERS'}
              </span>
            </button>

            {socialEntries.length > 0 && (
              <span className="ml-auto flex items-center gap-1.5">
                {socialEntries.map(({ kind, value }) => (
                  <a
                    key={kind}
                    href={socialHref(kind, value)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`@${profile.username} on ${SOCIAL_LABEL[kind]}`}
                    title={SOCIAL_LABEL[kind]}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-zinc-500 transition-all hover:-translate-y-0.5 hover:text-zinc-100"
                  >
                    <SocialIcon kind={kind} size={13} />
                  </a>
                ))}
              </span>
            )}
          </div>

          {profile.followedBy && profile.followedBy.usernames.length > 0 && (
            <p className="mt-2.5 text-[10px] tracking-[0.08em] text-zinc-600">
              FOLLOWED BY{' '}
              {profile.followedBy.usernames.map((name, i) => (
                <span key={name}>
                  {i > 0 && <span className="text-zinc-700"> · </span>}
                  <a href={`/u/${encodeURIComponent(name)}`} className="text-zinc-400 transition-colors hover:text-accent">
                    @{name}
                  </a>
                </span>
              ))}
              {profile.followedBy.total > profile.followedBy.usernames.length && (
                <span>
                  {' '}+ {profile.followedBy.total - profile.followedBy.usernames.length} MORE YOU FOLLOW
                </span>
              )}
            </p>
          )}
        </div>
      </section>

      {/* ---------- flight record (KPI strip) ---------- */}
      <section
        className="pf-reveal mt-4 grid grid-cols-2 overflow-hidden rounded-2xl liquid-glass sm:grid-cols-3 md:grid-cols-5"
        style={{ ['--rv' as string]: '110ms' }}
      >
        <StatCell label="RANK" divider={false}>
          {profile.rank !== null ? (
            <span className="flex items-baseline gap-2">
              <span
                className="text-base tabular-nums [font-family:var(--font-pixel)]"
                style={{
                  color: medal ? medal.fg : 'rgb(var(--z50))',
                  textShadow: medal ? `0 0 14px ${medalA(medal.rgb, 0.5)}` : undefined
                }}
              >
                #{profile.rank}
              </span>
              {profile.rankDelta !== 0 && (
                <span
                  className="flex items-center gap-0.5 text-[9px] font-semibold tabular-nums"
                  style={{ color: profile.rankDelta > 0 ? 'rgb(var(--lb-up))' : 'rgb(var(--lb-down))' }}
                >
                  <MoveGlyph dir={profile.rankDelta > 0 ? 'up' : 'down'} size={7} />
                  {Math.abs(profile.rankDelta)}
                </span>
              )}
            </span>
          ) : (
            <span className="text-base text-zinc-600 [font-family:var(--font-pixel)]">—</span>
          )}
        </StatCell>

        <StatCell label="LIFETIME SCORE" sub={`+${formatNumber(profile.todayScore)} TODAY`}>
          <span className="cribble-score-glow text-base tabular-nums text-zinc-50 [font-family:var(--font-pixel)]">
            <AnimatedCounter value={profile.score} duration={900} formatter={(v) => formatNumber(Math.round(v))} />
          </span>
        </StatCell>

        <StatCell label="ACTIVE DAYS">
          <span className="font-display text-base font-semibold tabular-nums text-zinc-100">
            {formatNumber(profile.activeDays)}
          </span>
        </StatCell>

        <StatCell label="BEST STREAK">
          <span className="font-display text-base font-semibold tabular-nums text-zinc-100">
            {formatNumber(profile.longestStreak)}
            <span className="ml-0.5 text-[10px] font-normal text-zinc-500">d</span>
          </span>
        </StatCell>

        <StatCell label="FOCUS TIME">
          <span className="font-display text-base font-semibold tabular-nums text-zinc-100">
            {formatDuration(profile.totalActiveMs)}
          </span>
        </StatCell>
      </section>

      {/* ---------- tools + service record ---------- */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="pf-reveal rounded-2xl glass-lite p-5" style={{ ['--rv' as string]: '200ms' }}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[10px] tracking-[0.4em] text-zinc-300">
              <span className="text-accent/80">{'// '}</span>TOP TOOLS
            </h2>
            <span className="text-[9px] tracking-[0.25em] text-zinc-600">SHARE OF SORTIES</span>
          </div>
          <div className="mt-4 space-y-3">
            {profile.topTools.length === 0 && (
              <div className="py-4 text-center text-[10px] tracking-[0.2em] text-zinc-600">
                NO FIELD DATA YET
              </div>
            )}
            {profile.topTools.map((tool, i) => (
              <div key={tool.name} className="flex items-center gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02]"
                  style={{ color: i === 0 ? 'rgb(var(--accent-rgb))' : 'rgb(var(--z300))' }}
                >
                  <ToolIcon name={tool.name} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-xs font-medium text-zinc-200">{tool.name}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{tool.percent}%</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="pf-bar h-full rounded-full"
                      style={{
                        width: `${Math.max(3, tool.percent)}%`,
                        background:
                          i === 0
                            ? 'linear-gradient(90deg, rgb(var(--accent-rgb) / 0.5), rgb(var(--accent-rgb)))'
                            : 'linear-gradient(90deg, rgb(var(--z600)), rgb(var(--z400)))',
                        animationDelay: `${200 + i * 120}ms`
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="pf-reveal rounded-2xl glass-lite p-5" style={{ ['--rv' as string]: '260ms' }}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[10px] tracking-[0.4em] text-zinc-300">
              <span className="text-accent/80">{'// '}</span>SERVICE RECORD
            </h2>
            <span className="text-[9px] tabular-nums tracking-[0.25em] text-zinc-600">
              {profile.badges.length}
              <span className="text-zinc-700">/{ACHIEVEMENTS.length}</span>
            </span>
          </div>
          <div className="mt-4">
            {profile.badges.length === 0 ? (
              <div className="py-4 text-center text-[10px] tracking-[0.2em] text-zinc-600">
                NO DECORATIONS YET
              </div>
            ) : (
              <div className="grid grid-cols-6 gap-2">
                {profile.badges.map((badge) => (
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
                      size={22}
                      className="[filter:drop-shadow(0_0_4px_currentColor)]"
                    />
                  </div>
                ))}
              </div>
            )}
            {isYou && (
              <a
                href="/dashboard/achievements"
                className="mt-4 block text-center text-[9px] tracking-[0.3em] text-zinc-600 transition-colors hover:text-accent"
              >
                VIEW FULL SERVICE RECORD →
              </a>
            )}
          </div>
        </section>
      </div>

      <footer className="mt-10 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
        <span>CRIBBLE · {new Date().getFullYear()}</span>
        <span className="text-zinc-700">{'// pilot profile'}</span>
      </footer>

      {/* ---------- overlays ---------- */}
      {roster && (
        <FollowListModal
          username={profile.username}
          kind={roster}
          signedIn={signedIn}
          onClose={(dirty) => {
            setRoster(null)
            if (dirty) refreshProfile()
          }}
        />
      )}
      {editing && editInitial && (
        <EditProfileModal
          initial={editInitial}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            refreshProfile()
          }}
        />
      )}

      <style jsx>{`
        .pf-reveal {
          animation: pf-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        @keyframes pf-reveal-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
        }
        :global(.pf-bar) {
          transform-origin: left center;
          animation: pf-bar-grow 700ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes pf-bar-grow {
          from {
            transform: scaleX(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pf-reveal,
          :global(.pf-bar) {
            animation: none;
          }
        }
      `}</style>
    </div>
  )

  return (
    <>
      <ProfileAmbience src={profile.banner_image} />
      {page}
    </>
  )
}

/* ================= supporting screens ================= */

function StatCell({
  label,
  sub,
  divider = true,
  children
}: {
  label: string
  sub?: string
  divider?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`px-4 py-4 transition-colors hover:bg-white/[0.03] ${
        divider ? 'border-l border-white/[0.06]' : ''
      }`}
    >
      <div className="text-[9px] tracking-[0.35em] text-zinc-500">{label}</div>
      <div className="mt-2">{children}</div>
      {sub && <div className="mt-1 text-[9px] tracking-[0.15em] text-zinc-600">{sub}</div>}
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="page-zoom-out relative mx-auto max-w-3xl animate-pulse px-4 pb-16 pt-6 sm:px-6">
      <div className="overflow-hidden rounded-2xl glass-pop">
        <div className="h-40 bg-white/[0.04] sm:h-48" />
        <div className="px-5 pb-6 sm:px-7">
          <div className="-mt-12 h-[92px] w-[92px] rounded-full border-4 border-black bg-zinc-900 sm:-mt-14" />
          <div className="mt-4 h-5 w-48 rounded bg-white/[0.06]" />
          <div className="mt-2 h-3 w-28 rounded bg-white/[0.04]" />
          <div className="mt-5 h-3.5 w-72 max-w-full rounded bg-white/[0.04]" />
          <div className="mt-4 flex gap-4">
            <div className="h-3 w-24 rounded bg-white/[0.04]" />
            <div className="h-3 w-24 rounded bg-white/[0.04]" />
          </div>
        </div>
      </div>
      <div className="mt-4 h-20 rounded-2xl bg-white/[0.03]" />
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-48 rounded-2xl bg-white/[0.03]" />
        <div className="h-48 rounded-2xl bg-white/[0.03]" />
      </div>
    </div>
  )
}

function MissingPilot({ username }: { username: string }) {
  return (
    <div className="page-zoom-out relative mx-auto flex max-w-3xl flex-col items-center px-6 pb-16 pt-24 text-center">
      <div className="text-4xl text-zinc-800 [font-family:var(--font-pixel)]">404</div>
      <h1 className="mt-6 text-[11px] tracking-[0.4em] text-zinc-300">PILOT NOT FOUND</h1>
      <p className="mt-3 max-w-sm text-xs leading-relaxed text-zinc-500">
        No profile on file for <span className="text-zinc-300">@{username}</span>. The callsign may
        have changed, or this pilot never enlisted.
      </p>
      <a
        href="/leaderboard"
        className="mt-8 rounded-lg border border-zinc-800 px-4 py-2 text-[10px] tracking-[0.3em] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
      >
        SCAN THE LEADERBOARD
      </a>
    </div>
  )
}

function ProfileError() {
  return (
    <div className="page-zoom-out relative mx-auto flex max-w-3xl flex-col items-center px-6 pb-16 pt-24 text-center">
      <h1 className="text-[11px] tracking-[0.4em] text-zinc-300">RECORD UNAVAILABLE</h1>
      <p className="mt-3 max-w-sm text-xs leading-relaxed text-zinc-500">
        The profile could not be retrieved. Give it a moment and try again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-8 rounded-lg border border-zinc-800 px-4 py-2 text-[10px] tracking-[0.3em] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
      >
        RETRY
      </button>
    </div>
  )
}
