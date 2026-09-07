'use client'

// One line of the plate register: a ledger row, not a card. Fixed columns
// (status · no · thumb · name · class · src) so 15 rows scan vertically;
// the thumb is a PlateLayer with its FX frozen (.bag-thumb) — only the
// spec sheet is alive. Locked plates stay selectable (the sheet explains
// how to get them) but read as ghosted print: desaturated under a 1-bit
// dither, name muted. The equipped row carries the signal bar whether or
// not it is selected, so the live plate is findable at a glance; the
// selection itself is the ink outline + crosses (registerChrome).
//
// Status is glyph-only in every row (■ ▣ □, toned); the row's aria-label
// and the spec sheet spell it out. While the cosmetics sync has failed the
// status is a guess, not a fact, so `unknown` prints `?` and skips the
// locked treatment — the register must never say "not yours" on a blip.

import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { PLATE_RARITY_META, type PlateDef } from '@/lib/cosmetics/plates'
import { STATUS_META, rarityColor, rarityColorA, type PlateStatus } from './bagModel'
import { toneColor } from './manifestChrome'
import {
  EQUIPPED_BAR,
  MICRO,
  PLATE_COLS,
  PLATE_ROW,
  optionClass,
  plateRowBox,
  sourceTag
} from './registerChrome'

export interface PlateRowProps {
  plate: PlateDef
  serial: string
  status: PlateStatus
  selected: boolean
  loading: boolean
  /** Cosmetics sync failed: ownership is unknown, not "locked". */
  unknown?: boolean
  onSelect: () => void
  compact?: boolean
}

/** Stable DOM id per option — the listbox's aria-activedescendant target. */
export const plateOptionId = (plateId: string) => `bag-plate-${plateId}`

const LOCKED_FILTER = 'saturate(0.2) brightness(0.8)'

export function PlateRow({
  plate,
  serial,
  status,
  selected,
  loading,
  unknown = false,
  onSelect,
  compact = false
}: PlateRowProps) {
  const meta = STATUS_META[status]
  const rarity = PLATE_RARITY_META[plate.rarity]
  // Ownership unknown while loading or after a failed sync: no status
  // paint, no dither, neutral ink.
  const locked = !loading && !unknown && status === 'locked'
  const equipped = !loading && !unknown && status === 'equipped'
  const accessibleName = loading
    ? `${plate.name}, ${rarity.label}, ${serial}`
    : unknown
      ? `${plate.name}, status unknown, ${rarity.label}, ${serial}`
      : `${plate.name}, ${meta.label}, ${rarity.label}, ${serial}`

  return (
    <button
      type="button"
      role="option"
      id={plateOptionId(plate.id)}
      aria-selected={selected}
      aria-label={accessibleName}
      tabIndex={-1}
      onClick={onSelect}
      className={`${optionClass(selected)} ${PLATE_ROW} ${PLATE_COLS} ${plateRowBox(compact)} ${MICRO}`}
    >
      {equipped && <span aria-hidden className={EQUIPPED_BAR} />}

      {/* ST — glyph only; `?` while the sync is not definitive */}
      {unknown ? (
        <span
          aria-label="status unknown"
          title="status unknown"
          className="inline-block w-4 text-center text-[length:var(--bag-fs-label)] leading-none text-[color:var(--bag-mute)]"
        >
          ?
        </span>
      ) : (
        <span
          aria-hidden
          className="inline-block w-4 text-center text-[length:var(--bag-fs-label)] leading-none"
          style={{ color: loading ? 'var(--bag-mute)' : toneColor(meta.tone) }}
        >
          {loading ? '' : meta.glyph}
        </span>
      )}

      {/* NO — catalog number; the full serial rides the title */}
      <span
        aria-hidden
        title={serial}
        className="leading-none tracking-normal text-[color:var(--bag-mute)]"
      >
        {serial.slice(-2)}
      </span>

      {/* PLATE — 4:1 thumb, FX paused by .bag-thumb. Below md the class
          column is gone, so a 2px rarity rule along the foot carries it. */}
      <span
        aria-hidden
        className="bag-thumb relative block w-full overflow-hidden"
        style={{ aspectRatio: '4 / 1' }}
      >
        <span className="absolute inset-0" style={locked ? { filter: LOCKED_FILTER } : undefined}>
          <PlateLayer plateId={plate.id} fade="none" />
        </span>
        {locked && <span className="bag-dither" />}
        <span className="pointer-events-none absolute inset-0 border border-[color:var(--bag-line)]" />
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] md:hidden"
          style={{ background: rarityColor(plate.rarity) }}
        />
      </span>

      {/* NAME */}
      <span
        aria-hidden
        className="min-w-0 truncate [font-family:var(--bag-font-display)] text-[13px] font-semibold leading-tight tracking-[0.02em]"
        style={{ color: locked ? 'var(--bag-mute)' : 'var(--bag-ink)' }}
      >
        {plate.name}
      </span>

      {/* CLASS — md and up */}
      <span
        aria-hidden
        className="hidden truncate border px-1 py-[3px] text-center leading-none tracking-normal md:block"
        style={{
          color: rarityColor(plate.rarity),
          borderColor: rarityColorA(plate.rarity, 0.5)
        }}
      >
        {rarity.label}
      </span>

      {/* SRC — xl only */}
      <span
        aria-hidden
        className="hidden text-right leading-none text-[color:var(--bag-mute)] xl:block"
      >
        {sourceTag(plate)}
      </span>
    </button>
  )
}
