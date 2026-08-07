'use client'

// The Bag — everything you own, collection-style. PLATES tab: a big
// tilting pilot-card stage (the Valorant central preview) that re-skins
// live with whichever plate is selected, next to the full 15-plate
// catalog with ownership overlays, filters and the EQUIP action — a
// partial PATCH to /api/user/profile, which only touches keys present in
// the body and validates ownership server-side. BADGES tab: the 24
// achievements as a collection, lazily fetched on first open; the deep
// progress view stays alive at /dashboard/achievements.
//
// No backend changes — everything runs on existing APIs. A signed-out or
// failed fetch degrades to neutral (browsable catalog, nothing owned, no
// equip offered, placeholder identity), same philosophy as the shop.

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import Link from 'next/link'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import { PlateLayer, PlatePreview } from '@/components/cosmetics/PlateLayer'
import { formatCompact, formatDuration } from '@/components/dashboard-v2/format'
import { IconSearch } from '@/components/leaderboard/icons'
import { toast } from '@/components/Toaster'
import {
  ACHIEVEMENTS,
  type AchievementCategory,
  type AchievementIcon,
  type AchievementRarity,
  type AchievementUnit
} from '@/lib/achievements'
import { fetchMe } from '@/lib/client/fetchMe'
import {
  PLATES,
  PLATE_RARITY_META,
  getPlate,
  type PlateDef,
  type PlateRarity
} from '@/lib/cosmetics/plates'
import { prefersReducedMotion } from '@/lib/motion'

/* ================= header ================= */

// "BAG" in ANSI Shadow block characters, matching the dashboard/achievements banners.
const ASCII_BAG = String.raw`██████╗  █████╗  ██████╗
██╔══██╗██╔══██╗██╔════╝
██████╔╝███████║██║  ███╗
██╔══██╗██╔══██║██║   ██║
██████╔╝██║  ██║╚██████╔╝
╚═════╝ ╚═╝  ╚═╝ ╚═════╝`

/* ================= catalog constants ================= */

/** Usable-first grid sort: rarity descending inside each shelf — the same
 * ladder as the shop's RARITY_ORDER; stable sort keeps catalog order in ties. */
const RARITY_ORDER: Record<PlateRarity, number> = {
  mythic: 0,
  legendary: 1,
  epic: 2,
  rare: 3,
  common: 4
}

/** Filter-chip display order — the ladder climbing up, like the
 * achievements summary strip. */
const RARITY_LADDER: PlateRarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic']

type BagTab = 'plates' | 'badges'
type OwnFilter = 'all' | 'owned' | 'missing'
type BadgeFilter = 'all' | 'unlocked' | 'locked'

const BAG_TABS: { value: BagTab; label: string }[] = [
  { value: 'plates', label: 'PLATES' },
  { value: 'badges', label: 'BADGES' }
]

const OWN_FILTER_OPTIONS: { value: OwnFilter; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'owned', label: 'OWNED' },
  { value: 'missing', label: 'MISSING' }
]

const BADGE_FILTER_OPTIONS: { value: BadgeFilter; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'unlocked', label: 'UNLOCKED' },
  { value: 'locked', label: 'LOCKED' }
]

const usd = (n: number) => `$${n.toFixed(2)}`

/* Rarity hues resolve through the --r-* vars from globals.css — shared by
   plate chips and badge tints, legible in both themes. */
const rarityColor = (rarity: AchievementRarity | PlateRarity) => `rgb(var(--r-${rarity}))`
const rarityColorA = (rarity: AchievementRarity | PlateRarity, alpha: number) =>
  `rgb(var(--r-${rarity}) / ${alpha})`

/* ================= cosmetics + identity state ================= */

interface CosmeticsData {
  isPro: boolean
  owned: ReadonlySet<string>
  equipped: string | null
}

/** Signed-out / failed-fetch mode: browsable, nothing owned, no equip. */
const NEUTRAL_COSMETICS: CosmeticsData = {
  isPro: false,
  owned: new Set(),
  equipped: null
}

interface Identity {
  name: string
  username: string
  avatar: string | null
  totalScore: number | null
}

const NEUTRAL_IDENTITY: Identity = {
  name: 'PILOT',
  username: 'you',
  avatar: null,
  totalScore: null
}

/** Matches the server's resolveEquippedPlate rule: owned rows plus the Pro
 * collection while a Pro tier is active. */
function usableIdsFor(cosmetics: CosmeticsData): Set<string> {
  const ids = new Set(cosmetics.owned)
  if (cosmetics.isPro) {
    for (const plate of PLATES) {
      if (plate.proExclusive) ids.add(plate.id)
    }
  }
  return ids
}

async function fetchCosmetics(): Promise<CosmeticsData> {
  try {
    const res = await fetch('/api/user/cosmetics', {
      cache: 'no-store',
      credentials: 'include'
    })
    if (!res.ok) return NEUTRAL_COSMETICS
    const data = await res.json()
    if (!data?.success) return NEUTRAL_COSMETICS
    return {
      isPro: Boolean(data.isPro),
      owned: new Set(
        Array.isArray(data.ownedPlateIds) ? data.ownedPlateIds.map(String) : []
      ),
      equipped: typeof data.equippedPlate === 'string' ? data.equippedPlate : null
    }
  } catch {
    return NEUTRAL_COSMETICS
  }
}

async function fetchIdentity(): Promise<Identity> {
  try {
    // Shared /me client cache — reuses the nav shell's request on a
    // hard load instead of firing a duplicate.
    const result = await fetchMe()
    if (!result.ok) return NEUTRAL_IDENTITY
    const user = result.data.user
    if (!user) return NEUTRAL_IDENTITY
    const totalScore = Number(result.data.scores?.total_score)
    return {
      name:
        typeof user.twitter_name === 'string' && user.twitter_name
          ? user.twitter_name
          : 'PILOT',
      username:
        typeof user.twitter_username === 'string' && user.twitter_username
          ? user.twitter_username
          : 'you',
      avatar:
        typeof user.twitter_profile_image === 'string' && user.twitter_profile_image
          ? user.twitter_profile_image
          : null,
      totalScore: Number.isFinite(totalScore) ? totalScore : null
    }
  } catch {
    return NEUTRAL_IDENTITY
  }
}

/* ================= badges state ================= */

/** Same row shape /api/user/achievements returns (and the achievements
 * page consumes). */
interface AchievementRow {
  id: string
  name: string
  description: string
  category: AchievementCategory
  rarity: AchievementRarity
  icon: AchievementIcon
  target: number
  current: number
  unit: AchievementUnit
  unlockedAt: string | null
}

/** Neutral degrade for the badges tab: the full catalog straight from the
 * client-side defs, everything locked at zero — still browsable signed out. */
const NEUTRAL_BADGES: AchievementRow[] = ACHIEVEMENTS.map((def) => ({
  id: def.id,
  name: def.name,
  description: def.description,
  category: def.category,
  rarity: def.rarity,
  icon: def.icon,
  target: def.target,
  current: 0,
  unit: def.unit,
  unlockedAt: null
}))

function formatProgressValue(unit: AchievementUnit, value: number): string {
  switch (unit) {
    case 'points':
      return formatCompact(Math.round(value))
    case 'duration':
      return formatDuration(value)
    case 'days':
    case 'tools':
    case 'visits':
    case 'sessions':
      return Math.round(value).toLocaleString('en-US')
    case 'none':
      return ''
    default: {
      const exhaustive: never = unit
      return exhaustive
    }
  }
}

function formatUnlockDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase()
}

/* ================= plate status ================= */

type PlateStatus = 'equipped' | 'usable' | 'locked'

function statusMeta(status: PlateStatus): { label: string; fg: string; border: string; wash: string } {
  switch (status) {
    case 'equipped':
      return {
        label: 'EQUIPPED',
        fg: 'rgb(var(--accent-rgb))',
        border: 'rgb(var(--accent-rgb) / 0.4)',
        wash: 'rgb(var(--accent-rgb) / 0.08)'
      }
    case 'usable':
      return {
        label: 'IN BAG',
        fg: 'rgb(var(--lb-up))',
        border: 'rgb(var(--lb-up) / 0.4)',
        wash: 'rgb(var(--lb-up) / 0.07)'
      }
    case 'locked':
      return {
        label: 'LOCKED',
        fg: 'rgb(var(--z500))',
        border: 'rgb(var(--lb-panel-edge) / 0.2)',
        wash: 'rgb(var(--lb-panel-edge) / 0.04)'
      }
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

/** How a plate is obtained, straight from catalog flags. */
function acquisitionLine(plate: PlateDef): string {
  if (plate.priceUsd !== null) return `SHOP · ${usd(plate.priceUsd)}`
  if (plate.proExclusive) return 'CRIBBLE PRO — active subscription'
  if (plate.championExclusive) return 'AWARDED TO RANK #1 (APEX)'
  if (plate.betaExclusive) return 'BETA TESTER GIFT — retired'
  return 'NOT OBTAINABLE'
}

/* ================= chips ================= */

function StatusChip({ status }: { status: PlateStatus }) {
  const meta = statusMeta(status)
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
      style={{ color: meta.fg, border: `1px solid ${meta.border}`, background: meta.wash }}
    >
      {meta.label}
    </span>
  )
}

function SeasonalChip({ label }: { label: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
      style={{
        color: 'rgb(var(--lb-gold))',
        border: '1px solid rgb(var(--lb-gold) / 0.4)',
        background: 'rgb(var(--lb-gold) / 0.07)'
      }}
    >
      {label}
    </span>
  )
}

/* ================= filter controls ================= */

function SearchField({
  value,
  onChange,
  placeholder,
  label
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  label: string
}) {
  return (
    <div className="lb-inset flex w-full items-center overflow-hidden rounded-lg sm:max-w-[220px]">
      <span className="pl-3 pr-1 text-zinc-600">
        <IconSearch size={12} />
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="border-l border-[rgb(var(--lb-panel-edge)/0.08)] px-3 py-2 text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200"
        >
          CLEAR
        </button>
      )}
    </div>
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="lb-inset flex items-center gap-1 rounded-lg p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.25em] transition-colors ${
            value === option.value
              ? 'bg-accent/10 text-accent'
              : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ================= stage card ================= */

function StageCard({ plate, identity }: { plate: PlateDef; identity: Identity }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const raf = useRef(0)

  const onMove = (e: ReactPointerEvent) => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty('--rx', `${(0.5 - py) * 10}deg`)
      el.style.setProperty('--ry', `${(px - 0.5) * 12}deg`)
      el.style.setProperty('--gx', `${px * 100}%`)
      el.style.setProperty('--gy', `${py * 100}%`)
      el.style.setProperty('--glare', '1')
    })
  }

  const onLeave = () => {
    const el = ref.current
    if (!el) return
    cancelAnimationFrame(raf.current)
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
    el.style.setProperty('--glare', '0')
  }

  const accent = plate.render.kind === 'css' ? plate.render.accent : '2 254 1'
  const rarity = PLATE_RARITY_META[plate.rarity]

  return (
    <div style={{ perspective: '1200px' }}>
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="bag-card relative overflow-hidden rounded-2xl"
        style={
          {
            transform: 'rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))',
            background:
              'linear-gradient(180deg, rgb(255 255 255 / 0.045), transparent 40%), rgb(var(--lb-panel-bg))',
            border: `1px solid rgb(${accent} / 0.35)`,
            boxShadow: `0 30px 80px -30px rgb(0 0 0 / 0.9), 0 0 60px -18px rgb(${accent} / 0.3)`,
            transition: 'border-color 600ms ease, box-shadow 600ms ease'
          } as CSSProperties
        }
      >
        {/* banner — the selected plate, full bleed */}
        <div className="relative h-[132px] overflow-hidden">
          {/* crossfade: key swap re-mounts, entering layer fades in over the old paint */}
          <div key={plate.id} className="bag-plate-in absolute inset-0">
            <PlateLayer plateId={plate.id} fade="none" />
          </div>
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, transparent 58%, rgb(var(--lb-panel-bg) / 0.94))'
            }}
          />
          <span
            className="absolute left-4 top-4 rounded-md px-2 py-1 text-[9px] leading-none tracking-[0.3em]"
            style={{
              color: `rgb(${accent})`,
              background: 'rgb(0 0 0 / 0.55)',
              border: `1px solid rgb(${accent} / 0.45)`,
              textShadow: `0 0 10px rgb(${accent} / 0.6)`
            }}
          >
            {plate.name.toUpperCase()}
          </span>
          <span
            className="absolute right-4 top-4 rounded bg-black/50 px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
            style={{
              color: rarity.color,
              border: `1px solid ${rarityColorA(plate.rarity, 0.5)}`
            }}
          >
            {rarity.label}
          </span>
        </div>

        {/* identity — how the plate reads next to your name on the board */}
        <div className="relative px-6 pb-6">
          <div className="-mt-[34px] flex items-end justify-between">
            <div className="relative h-[72px] w-[72px]">
              <span
                aria-hidden
                className="absolute -inset-[3px] rounded-full"
                style={{
                  background: `conic-gradient(from 210deg, rgb(${accent} / 0.9), rgb(${accent} / 0.15), rgb(${accent} / 0.9))`,
                  transition: 'background 600ms ease'
                }}
              />
              <span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: 'inset 0 0 0 3px rgb(var(--lb-panel-bg))' }}
              />
              <span className="absolute inset-[3px] flex items-center justify-center overflow-hidden rounded-full bg-zinc-900">
                {identity.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={identity.avatar}
                    alt={`@${identity.username}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-lg text-zinc-600 [font-family:var(--font-pixel)]">
                    {identity.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
            </div>
            <span className="pb-1 text-right text-[9px] tracking-[0.3em] text-zinc-600">
              AS SEEN ON THE BOARD
            </span>
          </div>

          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <span className="block truncate font-display text-xl font-semibold tracking-tight text-zinc-50">
                {identity.name}
              </span>
              <span className="text-[11px] text-zinc-500">@{identity.username}</span>
            </div>
            <div className="shrink-0 text-right">
              <span className="block text-[7px] tracking-[0.3em] text-zinc-600">
                TOTAL SCORE
              </span>
              <span className="mt-1 block text-[15px] leading-none tabular-nums text-zinc-100 [font-family:var(--font-pixel)]">
                {identity.totalScore !== null ? formatCompact(identity.totalScore) : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* holo glare — follows the pointer */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: 'var(--glare, 0)',
            background:
              'radial-gradient(300px circle at var(--gx, 50%) var(--gy, 50%), rgb(255 255 255 / 0.08), transparent 65%)',
            transition: 'opacity 400ms ease'
          }}
        />
      </div>
    </div>
  )
}

/* ================= details panel ================= */

function PlateDetails({
  plate,
  status,
  loading,
  equipping,
  onEquip
}: {
  plate: PlateDef
  status: PlateStatus
  loading: boolean
  equipping: boolean
  onEquip: (plateId: string | null) => void
}) {
  return (
    <div className="lb-panel mt-3 rounded-xl p-4">
      <p className="text-[11px] leading-relaxed text-zinc-400">{plate.tagline}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {!loading && <StatusChip status={status} />}
        {plate.seasonal && <SeasonalChip label={plate.seasonal.label} />}
        <span className="text-[9px] tracking-[0.25em] text-zinc-600">
          {acquisitionLine(plate)}
        </span>
      </div>

      <div className="mt-4">
        {loading ? (
          <span className="inline-block h-9 w-32 animate-pulse rounded-lg bg-white/[0.05]" />
        ) : status === 'equipped' ? (
          <button
            type="button"
            onClick={() => onEquip(null)}
            disabled={equipping}
            className="h-9 rounded-lg border border-zinc-800 px-5 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:cursor-wait disabled:opacity-60"
          >
            {equipping ? 'WORKING…' : 'UNEQUIP'}
          </button>
        ) : status === 'usable' ? (
          <button
            type="button"
            onClick={() => onEquip(plate.id)}
            disabled={equipping}
            className="h-9 rounded-lg bg-accent px-6 text-[10px] font-bold tracking-[0.3em] text-black shadow-[0_0_14px_rgb(var(--accent-rgb)/0.25)] transition-all hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {equipping ? 'EQUIPPING…' : 'EQUIP'}
          </button>
        ) : plate.priceUsd !== null ? (
          <Link
            href="/shop"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-4 text-[10px] tracking-[0.3em] text-accent transition-colors hover:border-accent/70 hover:bg-accent/10"
          >
            GET IT — {usd(plate.priceUsd)} <span aria-hidden>→</span>
          </Link>
        ) : plate.proExclusive ? (
          <Link
            href="/shop"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-300/40 bg-amber-300/5 px-4 text-[10px] tracking-[0.3em] text-amber-300 transition-colors hover:border-amber-300/70 hover:bg-amber-300/10"
          >
            REQUIRES PRO <span aria-hidden>→</span>
          </Link>
        ) : (
          <span className="text-[9px] tracking-[0.3em] text-zinc-600">
            {plate.championExclusive ? 'NEVER SOLD · AWARDED AT #1' : 'NEVER SOLD · BETA GIFT'}
          </span>
        )}
      </div>
    </div>
  )
}

/* ================= plate tile ================= */

function PlateTile({
  plate,
  selected,
  equipped,
  locked,
  loading,
  onSelect
}: {
  plate: PlateDef
  selected: boolean
  equipped: boolean
  locked: boolean
  loading: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={plate.tagline}
      className={`relative overflow-hidden rounded-xl text-left transition-shadow ${
        selected
          ? 'ring-2 ring-accent/70 shadow-[0_0_14px_rgb(var(--accent-rgb)/0.25)]'
          : 'ring-1 ring-white/[0.06] hover:ring-zinc-600'
      }`}
    >
      <span className={`block ${!loading && locked ? 'opacity-60 saturate-50' : ''}`}>
        <PlatePreview plateId={plate.id} />
      </span>
      {!loading && equipped && (
        <span
          className="absolute right-2 top-2 z-10 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
          style={{
            color: 'rgb(var(--lb-up))',
            borderColor: 'rgb(var(--lb-up) / 0.45)',
            background: 'rgb(0 0 0 / 0.55)'
          }}
        >
          EQUIPPED
        </span>
      )}
      {!loading && locked && !equipped && (
        <span
          className="absolute right-2 top-2 z-10 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
          style={{
            color: 'rgb(var(--z400))',
            borderColor: 'rgb(255 255 255 / 0.14)',
            background: 'rgb(0 0 0 / 0.55)'
          }}
        >
          LOCKED
        </span>
      )}
      {/* rarity hairline — every tile states its shelf */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 z-10 h-[2px]"
        style={{ background: rarityColorA(plate.rarity, 0.55) }}
      />
    </button>
  )
}

/* ================= badge stage + tile ================= */

function BadgeStage({ row }: { row: AchievementRow }) {
  const unlocked = row.unlockedAt !== null
  const color = unlocked ? rarityColor(row.rarity) : 'rgb(var(--z600))'
  const ratio = row.target > 0 ? Math.min(1, row.current / row.target) : 0

  return (
    <div className="lb-panel rounded-2xl p-5">
      <div
        className="lb-inset flex items-center justify-center rounded-xl py-10"
        style={{ color }}
      >
        <PixelIcon
          name={row.icon}
          size={128}
          className={unlocked ? 'bag-pixel-glow' : 'opacity-55'}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h3
          className={`text-[12px] tracking-[0.25em] ${unlocked ? 'text-zinc-100' : 'text-zinc-500'}`}
          style={unlocked ? { textShadow: `0 0 12px ${rarityColorA(row.rarity, 0.45)}` } : undefined}
        >
          {row.name}
        </h3>
        <span
          className="rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
          style={{
            color: unlocked ? color : 'rgb(var(--z600))',
            borderColor: unlocked ? rarityColorA(row.rarity, 0.4) : 'rgb(var(--z800))',
            backgroundColor: unlocked ? rarityColorA(row.rarity, 0.07) : 'transparent'
          }}
        >
          {row.rarity.toUpperCase()}
        </span>
      </div>
      <p className="mt-1 text-[9px] tracking-[0.3em] text-zinc-600">
        {row.category.toUpperCase()}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{row.description}</p>

      {/* showcase only — badges are earned, never equipped */}
      <div className="mt-4">
        <div className="h-1.5 overflow-hidden rounded bg-white/[0.06]">
          <span
            className="block h-full rounded"
            style={{
              width: `${unlocked ? 100 : Math.floor(ratio * 100)}%`,
              background: unlocked ? color : 'rgb(var(--accent-rgb))',
              boxShadow: unlocked ? `0 0 6px ${rarityColorA(row.rarity, 0.5)}` : undefined
            }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[9px] tracking-[0.2em]">
          {unlocked ? (
            <>
              <span style={{ color }}>◆ UNLOCKED</span>
              <span className="text-zinc-600">{formatUnlockDate(row.unlockedAt as string)}</span>
            </>
          ) : row.unit === 'none' ? (
            <>
              <span className="text-zinc-600">LOCKED</span>
              <span className="text-zinc-700">CLASSIFIED</span>
            </>
          ) : (
            <>
              <span className="text-zinc-500">
                {formatProgressValue(row.unit, Math.min(row.current, row.target))}
                <span className="text-zinc-700">
                  {' '}
                  / {formatProgressValue(row.unit, row.target)}
                </span>
              </span>
              <span className="text-zinc-700">{Math.floor(ratio * 100)}%</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function BadgeTile({
  row,
  selected,
  onSelect
}: {
  row: AchievementRow
  selected: boolean
  onSelect: () => void
}) {
  const unlocked = row.unlockedAt !== null
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={row.description}
      className={`lb-inset flex flex-col items-center gap-2 rounded-xl px-2 py-3 transition-shadow ${
        selected
          ? 'ring-2 ring-accent/70 shadow-[0_0_14px_rgb(var(--accent-rgb)/0.25)]'
          : 'hover:ring-1 hover:ring-zinc-600'
      }`}
      style={{ color: unlocked ? rarityColor(row.rarity) : 'rgb(var(--z600))' }}
    >
      <PixelIcon
        name={row.icon}
        size={36}
        className={unlocked ? 'bag-pixel-glow' : 'opacity-55'}
      />
      <span
        className={`text-center text-[8px] leading-relaxed tracking-[0.2em] ${
          unlocked ? 'text-zinc-300' : 'text-zinc-600'
        }`}
      >
        {row.name}
      </span>
    </button>
  )
}

/* ================= the bag ================= */

export default function BagPage() {
  const [tab, setTab] = useState<BagTab>('plates')

  // fetched state — null while in flight, neutral on any failure
  const [cosmetics, setCosmetics] = useState<CosmeticsData | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [equippedPlate, setEquippedPlate] = useState<string | null>(null)
  const [equipping, setEquipping] = useState(false)

  // plates tab
  const [selectedPlateId, setSelectedPlateId] = useState<string>(PLATES[0].id)
  const [query, setQuery] = useState('')
  const [ownFilter, setOwnFilter] = useState<OwnFilter>('all')
  const [rarityFilter, setRarityFilter] = useState<PlateRarity | 'all'>('all')

  // badges tab — fetched lazily on first activation
  const [achievements, setAchievements] = useState<AchievementRow[] | null>(null)
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null)
  const [badgeQuery, setBadgeQuery] = useState('')
  const [badgeFilter, setBadgeFilter] = useState<BadgeFilter>('all')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [cosmeticsData, identityData] = await Promise.all([
        fetchCosmetics(),
        fetchIdentity()
      ])
      if (cancelled) return
      setCosmetics(cosmeticsData)
      setIdentity(identityData)
      setEquippedPlate(cosmeticsData.equipped)
      // stage default: what's equipped, else the first thing in the bag,
      // else the catalog front
      const usable = usableIdsFor(cosmeticsData)
      const equippedValid =
        cosmeticsData.equipped && getPlate(cosmeticsData.equipped)
          ? cosmeticsData.equipped
          : null
      const firstUsable = PLATES.find((plate) => usable.has(plate.id))?.id ?? null
      setSelectedPlateId(equippedValid ?? firstUsable ?? PLATES[0].id)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (tab !== 'badges' || achievements !== null) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/user/achievements', { credentials: 'include' })
        const data = res.ok ? await res.json() : null
        if (cancelled) return
        if (data?.success && Array.isArray(data.achievements)) {
          setAchievements(data.achievements as AchievementRow[])
        } else {
          setAchievements(NEUTRAL_BADGES)
        }
      } catch {
        if (!cancelled) setAchievements(NEUTRAL_BADGES)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [tab, achievements])

  const loading = cosmetics === null
  const usableIds = useMemo(
    () => (cosmetics ? usableIdsFor(cosmetics) : new Set<string>()),
    [cosmetics]
  )

  const visiblePlates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PLATES.filter((plate) => {
      if (q && !plate.name.toLowerCase().includes(q)) return false
      if (ownFilter === 'owned' && !usableIds.has(plate.id)) return false
      if (ownFilter === 'missing' && usableIds.has(plate.id)) return false
      if (rarityFilter !== 'all' && plate.rarity !== rarityFilter) return false
      return true
    }).sort(
      (a, b) =>
        Number(usableIds.has(b.id)) - Number(usableIds.has(a.id)) ||
        RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]
    )
  }, [query, ownFilter, rarityFilter, usableIds])

  const filteredBadges = useMemo(() => {
    if (!achievements) return []
    const q = badgeQuery.trim().toLowerCase()
    return achievements.filter((row) => {
      if (q && !row.name.toLowerCase().includes(q)) return false
      if (badgeFilter === 'unlocked') return row.unlockedAt !== null
      if (badgeFilter === 'locked') return row.unlockedAt === null
      return true
    })
  }, [achievements, badgeQuery, badgeFilter])

  const selectedPlate = getPlate(selectedPlateId) ?? PLATES[0]
  const selectedStatus: PlateStatus =
    equippedPlate === selectedPlate.id
      ? 'equipped'
      : usableIds.has(selectedPlate.id)
        ? 'usable'
        : 'locked'

  const selectedBadge = useMemo(() => {
    if (!achievements) return null
    return (
      achievements.find((row) => row.id === selectedBadgeId) ??
      achievements.find((row) => row.unlockedAt !== null) ??
      achievements[0] ??
      null
    )
  }, [achievements, selectedBadgeId])

  const usableCount = PLATES.filter((plate) => usableIds.has(plate.id)).length
  const unlockedBadgeCount =
    achievements?.filter((row) => row.unlockedAt !== null).length ?? 0

  const equip = async (nextPlateId: string | null) => {
    const prev = equippedPlate
    setEquipping(true)
    setEquippedPlate(nextPlateId)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipped_plate: nextPlateId })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) throw new Error('equip rejected')
      if (nextPlateId) {
        toast({
          kind: 'success',
          title: 'PLATE EQUIPPED',
          body: `${getPlate(nextPlateId)?.name ?? 'Plate'} is live on the board.`
        })
      } else {
        toast({
          kind: 'info',
          title: 'PLATE UNEQUIPPED',
          body: 'Back to the stock row.'
        })
      }
    } catch {
      setEquippedPlate(prev)
      toast({
        kind: 'error',
        title: 'EQUIP FAILED',
        body: 'The board did not take it. Try again.'
      })
    } finally {
      setEquipping(false)
    }
  }

  const shownIdentity = identity ?? NEUTRAL_IDENTITY

  return (
    <div className="page-zoom-out relative mx-auto max-w-6xl px-6 pb-16 pt-6">
      {/* ---------- header ---------- */}
      <section className="mt-4 flex flex-col items-center gap-2">
        <div className="w-full overflow-x-auto py-1">
          <pre
            aria-label="BAG"
            className="mx-auto whitespace-pre text-center font-mono leading-[0.9] text-accent"
            style={{
              fontSize: 'clamp(7px, 1.5vw, 13px)',
              textShadow:
                '0 0 8px rgb(var(--accent-rgb)/0.33), 0 0 22px rgb(var(--accent-rgb)/0.15)',
              letterSpacing: '-0.02em'
            }}
          >
            {ASCII_BAG}
          </pre>
        </div>
        <p className="text-center text-[10px] tracking-[0.3em] text-zinc-600">
          <span className="text-accent/80">{'// '}</span>
          EVERYTHING YOU OWN
          <span className="mx-2 text-zinc-800">·</span>
          <span className="tabular-nums">
            {usableCount} / {PLATES.length} PLATES
          </span>
          {achievements !== null && (
            <>
              <span className="mx-2 text-zinc-800">·</span>
              <span className="tabular-nums">
                {unlockedBadgeCount} / {achievements.length} BADGES
              </span>
            </>
          )}
        </p>

        <div className="mt-3 flex items-center gap-1.5">
          {BAG_TABS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={tab === entry.value}
              onClick={() => setTab(entry.value)}
              className={`rounded-lg px-5 py-2 text-[10px] tracking-[0.3em] transition-colors ${
                tab === entry.value
                  ? 'border border-accent/50 bg-accent/10 text-accent'
                  : 'lb-inset text-zinc-500 hover:text-zinc-100'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </section>

      <main className="mt-8">
        {tab === 'plates' ? (
          /* ---------- plates: stage + catalog grid ---------- */
          <div className="lg:grid lg:grid-cols-[minmax(360px,5fr)_7fr] lg:gap-6">
            <div className="self-start lg:sticky lg:top-24">
              <StageCard plate={selectedPlate} identity={shownIdentity} />
              <PlateDetails
                plate={selectedPlate}
                status={selectedStatus}
                loading={loading}
                equipping={equipping}
                onEquip={equip}
              />
            </div>

            <div className="mt-6 min-w-0 lg:mt-0">
              <div className="flex flex-wrap items-center gap-2">
                <SearchField
                  value={query}
                  onChange={setQuery}
                  placeholder="hunt a plate…"
                  label="Search plates"
                />
                <Segmented
                  options={OWN_FILTER_OPTIONS}
                  value={ownFilter}
                  onChange={setOwnFilter}
                  label="Ownership filter"
                />
              </div>

              <div
                role="group"
                aria-label="Rarity filter"
                className="mt-2 flex flex-wrap items-center gap-1.5"
              >
                <button
                  type="button"
                  aria-pressed={rarityFilter === 'all'}
                  onClick={() => setRarityFilter('all')}
                  className={`rounded border px-2 py-1 text-[8px] tracking-[0.25em] transition-colors ${
                    rarityFilter === 'all'
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-[rgb(var(--lb-panel-edge)/0.12)] text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  ALL
                </button>
                {RARITY_LADDER.map((rarity) => {
                  const active = rarityFilter === rarity
                  return (
                    <button
                      key={rarity}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setRarityFilter(active ? 'all' : rarity)}
                      className={`rounded border px-2 py-1 text-[8px] tracking-[0.25em] transition-colors ${
                        active
                          ? ''
                          : 'border-[rgb(var(--lb-panel-edge)/0.12)] text-zinc-500 hover:text-zinc-300'
                      }`}
                      style={
                        active
                          ? {
                              color: PLATE_RARITY_META[rarity].color,
                              borderColor: rarityColorA(rarity, 0.5),
                              background: rarityColorA(rarity, 0.1)
                            }
                          : undefined
                      }
                    >
                      {PLATE_RARITY_META[rarity].label}
                    </button>
                  )
                })}
              </div>

              {visiblePlates.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-white/[0.08] px-4 py-10 text-center text-[10px] tracking-[0.3em] text-zinc-600">
                  NO PLATES MATCH THE FILTERS
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {visiblePlates.map((plate) => (
                    <PlateTile
                      key={plate.id}
                      plate={plate}
                      selected={plate.id === selectedPlateId}
                      equipped={plate.id === equippedPlate}
                      locked={!usableIds.has(plate.id)}
                      loading={loading}
                      onSelect={() => setSelectedPlateId(plate.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ---------- badges: stage + collection grid ---------- */
          <>
            {achievements === null ? (
              <div className="lg:grid lg:grid-cols-[minmax(360px,5fr)_7fr] lg:gap-6">
                <div className="h-72 animate-pulse rounded-2xl bg-white/[0.04]" />
                <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:mt-0 xl:grid-cols-4">
                  {Array.from({ length: 12 }, (_, i) => (
                    <div key={i} className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
                  ))}
                </div>
              </div>
            ) : (
              <div className="lg:grid lg:grid-cols-[minmax(360px,5fr)_7fr] lg:gap-6">
                <div className="self-start lg:sticky lg:top-24">
                  {selectedBadge && <BadgeStage row={selectedBadge} />}
                </div>

                <div className="mt-6 min-w-0 lg:mt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SearchField
                      value={badgeQuery}
                      onChange={setBadgeQuery}
                      placeholder="hunt a badge…"
                      label="Search badges"
                    />
                    <Segmented
                      options={BADGE_FILTER_OPTIONS}
                      value={badgeFilter}
                      onChange={setBadgeFilter}
                      label="Unlock filter"
                    />
                  </div>

                  {filteredBadges.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-white/[0.08] px-4 py-10 text-center text-[10px] tracking-[0.3em] text-zinc-600">
                      NO BADGES MATCH THE FILTERS
                    </div>
                  ) : (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                      {filteredBadges.map((row) => (
                        <BadgeTile
                          key={row.id}
                          row={row}
                          selected={selectedBadge?.id === row.id}
                          onSelect={() => setSelectedBadgeId(row.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Link
                href="/dashboard/achievements"
                className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-500 transition-colors hover:text-zinc-200"
              >
                FULL SERVICE RECORD <span aria-hidden>→</span>
              </Link>
            </div>
          </>
        )}
      </main>

      <footer className="mt-10 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
        <span>CRIBBLE · {new Date().getFullYear()}</span>
        <span className="text-zinc-700">{'// pack it, fly it'}</span>
      </footer>

      <style jsx global>{`
        .bag-card {
          will-change: transform;
          transform-style: preserve-3d;
        }

        /* key-swap crossfade: the entering plate lands hot and settles —
           same read as the landing pilot card, defined locally because the
           landing keyframe is component-scoped there. */
        .bag-plate-in {
          animation: bag-plate-in 700ms ease backwards;
        }
        @keyframes bag-plate-in {
          from {
            opacity: 0;
            filter: saturate(1.6) brightness(1.35);
          }
        }

        /* unlocked badge bitmaps glow in their rarity hue */
        .bag-pixel-glow {
          filter: drop-shadow(0 0 5px currentColor);
        }

        @media (prefers-reduced-motion: reduce) {
          .bag-plate-in {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
