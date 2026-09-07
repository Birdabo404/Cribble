// Bag manifest — the pure model. No React, no fetch: status resolution,
// filter + sort, serials, default selection and the readout formatters the
// register, spec sheet and header all share. Every rule the old bag page
// computed inline lives here so it is unit-tested (bagModel.test.ts) and
// so the components stay presentational. useBagData.ts owns the network.

import { formatCompact, formatDuration } from '@/components/dashboard-v2/format'
import {
  ACHIEVEMENTS,
  type AchievementCategory,
  type AchievementIcon,
  type AchievementRarity,
  type AchievementUnit
} from '@/lib/achievements'
import { PLATES, getPlate, type PlateDef, type PlateRarity } from '@/lib/cosmetics/plates'

/* ================= types ================= */

export type BagTab = 'plates' | 'badges'
export type OwnFilter = 'all' | 'owned' | 'missing'
export type BadgeFilter = 'all' | 'unlocked' | 'locked'
export type RarityFilter = PlateRarity | 'all'
export type PlateStatus = 'equipped' | 'usable' | 'locked'

/** Cosmetics fetch lifecycle. 'error' means the sheet may be showing
 * "nothing owned" because the request failed — never because it is true. */
export type SyncState = 'loading' | 'ok' | 'error'

export interface CosmeticsData {
  isPro: boolean
  owned: ReadonlySet<string>
  equipped: string | null
}

export interface Identity {
  name: string
  username: string
  avatar: string | null
  totalScore: number | null
}

/** Same row shape /api/user/achievements returns (and the achievements
 * page consumes). */
export interface AchievementRow {
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

/** Which token a status glyph/label paints with: equipped = signal,
 * stowed = ink (neutral), locked = mute. */
export type StatusTone = 'signal' | 'ink' | 'mute'

/* ================= neutral state ================= */

/** Signed-out / failed-fetch mode: browsable, nothing owned, no equip. */
export const NEUTRAL_COSMETICS: CosmeticsData = {
  isPro: false,
  owned: new Set(),
  equipped: null
}

export const NEUTRAL_IDENTITY: Identity = {
  name: 'PILOT',
  username: 'you',
  avatar: null,
  totalScore: null
}

/** Neutral degrade for the badges compartment: the full catalog straight
 * from the client-side defs, everything locked at zero. */
export const NEUTRAL_BADGES: AchievementRow[] = ACHIEVEMENTS.map((def) => ({
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

/* ================= catalog constants ================= */

export const BAG_TABS: { value: BagTab; label: string }[] = [
  { value: 'plates', label: 'PLATES' },
  { value: 'badges', label: 'BADGES' }
]

export const OWN_FILTER_OPTIONS: { value: OwnFilter; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'owned', label: 'OWNED' },
  { value: 'missing', label: 'MISSING' }
]

export const BADGE_FILTER_OPTIONS: { value: BadgeFilter; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'unlocked', label: 'UNLOCKED' },
  { value: 'locked', label: 'LOCKED' }
]

/** Filter-chip display order — the ladder climbing up. */
export const RARITY_LADDER: PlateRarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic']

/** Register sort inside each shelf: rarity descending — the same ladder as
 * the shop's RARITY_ORDER; a stable sort keeps catalog order in ties. */
export const RARITY_ORDER: Record<PlateRarity, number> = {
  mythic: 0,
  legendary: 1,
  epic: 2,
  rare: 3,
  common: 4
}

export const STATUS_META: Record<
  PlateStatus,
  { label: string; glyph: string; tone: StatusTone }
> = {
  equipped: { label: 'EQUIPPED', glyph: '■', tone: 'signal' },
  usable: { label: 'STOWED', glyph: '▣', tone: 'ink' },
  locked: { label: 'LOCKED', glyph: '□', tone: 'mute' }
}

/* ================= plate status ================= */

/** Matches the server's resolveEquippedPlate rule: owned rows plus the Pro
 * collection while a Pro tier is active. */
export function usableIdsFor(cosmetics: CosmeticsData): Set<string> {
  const ids = new Set(cosmetics.owned)
  if (cosmetics.isPro) {
    for (const plate of PLATES) {
      if (plate.proExclusive) ids.add(plate.id)
    }
  }
  return ids
}

export function statusFor(
  plateId: string,
  equippedPlate: string | null,
  usableIds: ReadonlySet<string>
): PlateStatus {
  if (equippedPlate === plateId) return 'equipped'
  if (usableIds.has(plateId)) return 'usable'
  return 'locked'
}

export const usd = (n: number) => `$${n.toFixed(2)}`

/** How a plate is obtained, straight from catalog flags. */
export function acquisitionLine(plate: PlateDef): string {
  if (plate.priceUsd !== null) return `SHOP · ${usd(plate.priceUsd)}`
  if (plate.proExclusive) return 'CRIBBLE PRO — active subscription'
  if (plate.championExclusive) return 'AWARDED TO RANK #1 (APEX)'
  if (plate.betaExclusive) return 'BETA TESTER GIFT — retired'
  return 'NOT OBTAINABLE'
}

/* ================= serials ================= */

/** Two-digit zero-pad: serials, slot numbers, counts, the REV month. */
export const pad2 = (n: number) => String(n).padStart(2, '0')

const PLATE_INDEX = new Map(PLATES.map((plate, index) => [plate.id, index]))
const BADGE_INDEX = new Map(ACHIEVEMENTS.map((def, index) => [def.id, index]))

/** `PLT-01`.. by catalog position; unknown ids stamp `PLT-??`. */
export function plateSerial(plateId: string): string {
  const index = PLATE_INDEX.get(plateId)
  return index === undefined ? 'PLT-??' : `PLT-${pad2(index + 1)}`
}

/** `BDG-01`.. by catalog position; unknown ids stamp `BDG-??`. */
export function badgeSerial(achievementId: string): string {
  const index = BADGE_INDEX.get(achievementId)
  return index === undefined ? 'BDG-??' : `BDG-${pad2(index + 1)}`
}

/* ================= filter + sort ================= */

function matchesOwnFilter(ownFilter: OwnFilter, usable: boolean): boolean {
  switch (ownFilter) {
    case 'all':
      return true
    case 'owned':
      return usable
    case 'missing':
      return !usable
    default: {
      const exhaustive: never = ownFilter
      return exhaustive
    }
  }
}

function matchesBadgeFilter(filter: BadgeFilter, unlocked: boolean): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'unlocked':
      return unlocked
    case 'locked':
      return !unlocked
    default: {
      const exhaustive: never = filter
      return exhaustive
    }
  }
}

export interface PlateFilterInput {
  query: string
  ownFilter: OwnFilter
  rarityFilter: RarityFilter
  usableIds: ReadonlySet<string>
}

/** Register order: usable first, then rarity descending, catalog order in
 * ties. Filters on name substring, ownership and rarity. */
export function filterPlates({
  query,
  ownFilter,
  rarityFilter,
  usableIds
}: PlateFilterInput): PlateDef[] {
  const q = query.trim().toLowerCase()
  return PLATES.filter((plate) => {
    if (q && !plate.name.toLowerCase().includes(q)) return false
    if (!matchesOwnFilter(ownFilter, usableIds.has(plate.id))) return false
    if (rarityFilter !== 'all' && plate.rarity !== rarityFilter) return false
    return true
  }).sort(
    (a, b) =>
      Number(usableIds.has(b.id)) - Number(usableIds.has(a.id)) ||
      RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]
  )
}

export interface BadgeFilterInput {
  query: string
  filter: BadgeFilter
}

/** Slot grid order is the row order (the catalog); filters only. */
export function filterBadges(
  rows: readonly AchievementRow[],
  { query, filter }: BadgeFilterInput
): AchievementRow[] {
  const q = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (q && !row.name.toLowerCase().includes(q)) return false
    return matchesBadgeFilter(filter, row.unlockedAt !== null)
  })
}

/* ================= default selection ================= */

/** What the spec sheet opens on: the equipped plate when the catalog still
 * knows it, else the first thing in the bag, else the catalog front. */
export function defaultPlateSelection(cosmetics: CosmeticsData): string {
  const usable = usableIdsFor(cosmetics)
  const equippedValid =
    cosmetics.equipped && getPlate(cosmetics.equipped) ? cosmetics.equipped : null
  const firstUsable = PLATES.find((plate) => usable.has(plate.id))?.id ?? null
  return equippedValid ?? firstUsable ?? PLATES[0].id
}

/** The badge the spec sheet shows: the selected row when it is present,
 * else the first unlocked, else the first row, else nothing. */
export function defaultBadgeSelection(
  rows: readonly AchievementRow[],
  selectedId: string | null
): AchievementRow | null {
  return (
    rows.find((row) => row.id === selectedId) ??
    rows.find((row) => row.unlockedAt !== null) ??
    rows[0] ??
    null
  )
}

/* ================= counts ================= */

export function countUsable(usableIds: ReadonlySet<string>): number {
  return PLATES.filter((plate) => usableIds.has(plate.id)).length
}

export function countUnlocked(rows: readonly AchievementRow[]): number {
  return rows.filter((row) => row.unlockedAt !== null).length
}

/* ================= readouts ================= */

export function formatProgressValue(unit: AchievementUnit, value: number): string {
  switch (unit) {
    case 'points':
    case 'tokens':
      return formatCompact(Math.round(value))
    case 'duration':
      return formatDuration(value)
    case 'usd':
      return `$${Math.round(value).toLocaleString('en-US')}`
    case 'days':
    case 'tools':
    case 'visits':
    case 'sessions':
    case 'models':
      return Math.round(value).toLocaleString('en-US')
    case 'none':
      return ''
    default: {
      const exhaustive: never = unit
      return exhaustive
    }
  }
}

export function formatUnlockDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase()
}

/** Sheet revision stamp: `REV 2026.09`. */
export function revStamp(date: Date): string {
  return `REV ${date.getFullYear()}.${pad2(date.getMonth() + 1)}`
}

/* Rarity hues resolve through the --r-* vars from globals.css — shared by
   plate tags and badge tints, legible in both themes. */
export const rarityColor = (rarity: AchievementRarity | PlateRarity) => `rgb(var(--r-${rarity}))`
export const rarityColorA = (rarity: AchievementRarity | PlateRarity, alpha: number) =>
  `rgb(var(--r-${rarity}) / ${alpha})`
