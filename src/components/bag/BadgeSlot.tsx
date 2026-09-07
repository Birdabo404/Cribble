'use client'

// One inventory slot of the badge register: an at-least-square cell in
// the 1px-gap grid — its catalog slot number in a 14px strip along the
// top, the 16x16 sprite centred beneath it (32px below md, 40px from md)
// and, from sm, the name at the foot; below sm the strip and the sheet
// carry the name. Unlocked = flat 2px rarity rule along the bottom edge
// (no glow). Locked = the sprite on its void ramp under a 1-bit dither,
// name muted; still selectable so the spec sheet can show the progress
// toward it. Selection is the ink outline + crosses from registerChrome.

import { PixelIcon } from '@/components/achievements/PixelIcon'
import { pad2, rarityColor, type AchievementRow } from './bagModel'
import {
  BADGE_CELL,
  BADGE_INDEX,
  BADGE_NAME,
  BADGE_SPRITE,
  BADGE_SPRITE_SIZE,
  MICRO,
  optionClass
} from './registerChrome'

export interface BadgeSlotProps {
  row: AchievementRow
  serial: string
  /** Position in the FULL catalog (ACHIEVEMENTS order); -1 when unknown. */
  index: number
  selected: boolean
  onSelect: () => void
}

/** Stable DOM id per option — the listbox's aria-activedescendant target. */
export const badgeOptionId = (achievementId: string) => `bag-badge-${achievementId}`

export function BadgeSlot({ row, serial, index, selected, onSelect }: BadgeSlotProps) {
  const unlocked = row.unlockedAt !== null
  const slot = index >= 0 ? pad2(index + 1) : '??'
  const statusLabel = unlocked ? 'UNLOCKED' : 'LOCKED'

  return (
    <button
      type="button"
      role="option"
      id={badgeOptionId(row.id)}
      aria-selected={selected}
      aria-label={`${row.name}, ${statusLabel}, ${row.rarity}, slot ${slot}, ${serial}`}
      title={row.description}
      tabIndex={-1}
      onClick={onSelect}
      className={`${optionClass(selected)} ${BADGE_CELL} ${MICRO}`}
    >
      {/* slot index — its own strip, never over the sprite */}
      <span aria-hidden className={`${BADGE_INDEX} text-[color:var(--bag-mute)]`}>
        {slot}
      </span>

      {/* sprite — 32px below md, 40px from md */}
      <span aria-hidden className={BADGE_SPRITE}>
        <PixelIcon name={row.icon} size={40} locked={!unlocked} className={BADGE_SPRITE_SIZE} />
        {!unlocked && <span className="bag-dither" />}
      </span>

      {/* name — from sm; two clamped lines */}
      <span
        aria-hidden
        className={BADGE_NAME}
        style={{ color: unlocked ? 'var(--bag-ink)' : 'var(--bag-mute)' }}
      >
        {row.name}
      </span>

      {unlocked && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]"
          style={{ background: rarityColor(row.rarity) }}
        />
      )}
    </button>
  )
}
