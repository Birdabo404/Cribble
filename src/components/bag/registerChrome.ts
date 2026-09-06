'use client'

// Register chrome — the class strings, column templates, tone lookups and
// grid-measuring hook the plate rows, badge slots and their ghost / empty
// states share. One source for the row template means the column header,
// the live rows and the loading rows can never drift out of alignment.
// Every colour here is a --bag-* token; rarity rides --r-* via bagModel
// and the status tone lookup (toneColor) is manifestChrome's.

import { useEffect, useState, type RefObject } from 'react'
import type { PlateDef } from '@/lib/cosmetics/plates'
import { usd } from './bagModel'

/* ================= type ================= */

/** Mono micro text: the 10px floor, uppercase, typewriter tracking. */
export const MICRO =
  '[font-family:var(--bag-font-data)] text-[length:var(--bag-fs-micro)] uppercase tracking-[0.08em]'

/** Mono label text (11px) — action labels, not metadata. */
export const LABEL =
  '[font-family:var(--bag-font-data)] text-[length:var(--bag-fs-label)] uppercase tracking-[0.08em]'

/* ================= option chrome ================= */

/** Fine-pointer hover: a flat --bag-well tint layered over the paper fill.
 * A two-stop identical gradient is a solid layer, so the option's paper
 * stays opaque over the 1px grid lines it sits on. Touch gets nothing. */
export const OPTION_HOVER =
  '[@media(hover:hover)_and_(pointer:fine)]:hover:[background-image:linear-gradient(var(--bag-well),var(--bag-well))]'

/** Every option: positioned (for the bar + crosses), paper-filled, square,
 * no UA ring — the listbox owns focus and the ring rides the selection. */
export const OPTION_BASE = `relative w-full select-none appearance-none bg-[color:var(--bag-paper)] text-left outline-none touch-manipulation ${OPTION_HOVER}`

/** Selected: 1px ink (--bag-focus) outline drawn inside the box (never
 * over a neighbour), registration crosses, and a z-index of 1 so the
 * crosses paint over the neighbouring cells without climbing past any
 * sticky chrome. While the listbox has keyboard focus the same outline
 * goes dashed — the focus ring is the selection ring. Never the signal
 * hue: that is the equipped mark, and one colour carries one meaning. */
export const OPTION_SELECTED =
  'z-[1] bag-regmarks outline outline-1 outline-offset-[-1px] outline-[color:var(--bag-focus)] group-focus-visible:outline-dashed'

export function optionClass(selected: boolean): string {
  return selected ? `${OPTION_BASE} ${OPTION_SELECTED}` : OPTION_BASE
}

/** The 2px signal bar on the equipped row's left edge — equipped only,
 * so the live plate is findable at a glance whether or not it is the
 * selection (which the ink outline + crosses carry). */
export const EQUIPPED_BAR =
  'pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-[color:var(--bag-signal-text)]'

/* ================= listbox chrome ================= */

/** Hairline grid: 1px gap on the soft line colour, children paint paper. */
export const LISTBOX_BASE = 'group grid gap-px bg-[color:var(--bag-line-soft)] outline-none'

/** When nothing in the visible list is selected there is no option to
 * carry the focus ring, so the listbox itself shows the dashed outline. */
export const LISTBOX_FOCUS_FALLBACK =
  'focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--bag-focus)]'

/* ================= plate row template ================= */

/** Row template, one source for the column header, live rows and ghost
 * rows. Columns: ST (glyph only, 16px) · NO (2ch) · PLATE (thumb 72 /
 * 80 / 112) · NAME (minmax 96 → 120, takes the slack) · CLASS (72px from
 * md; below md the class is a 2px rarity rule under the thumb) · SRC (6ch,
 * xl only). Widths are fixed per breakpoint, never content-driven, and
 * NAME's minimum is what keeps the register from collapsing the name
 * instead of overflowing — the track set is budgeted so it never does.
 *
 * Budget (CSS px, nav rail on, the tighter case): the register cell is
 * 373 at 768, 437 at 1024 and 462 at 1280+ (max-w-6xl caps the page),
 * less 24px row padding; 2ch is 13.3px at the md micro size. md:
 * 16+13+80+72 + 4×8 gaps → NAME 136 at 768 and 200 at 1024. xl:
 * 16+13+112+72+40 + 5×8 gaps → NAME 145. A widened status column for the
 * inline label at xl (72px) would leave NAME under 90, so the status
 * stays glyph-only everywhere; the row's aria-label and the spec sheet
 * name it. */
export const PLATE_COLS =
  'grid-cols-[16px_2ch_72px_minmax(96px,1fr)] md:grid-cols-[16px_2ch_80px_minmax(120px,1fr)_72px] xl:grid-cols-[16px_2ch_112px_minmax(120px,1fr)_72px_6ch]'

/** Shared by the header, live rows and ghost rows: the grid itself and
 * the row box (tap floor on compact, 56px otherwise). 8px column gaps —
 * a ledger, not a card grid. */
export const PLATE_ROW = 'grid items-center gap-x-2'
export const plateRowBox = (compact: boolean) =>
  compact ? 'min-h-[var(--bag-tap)] px-2 py-1' : 'min-h-[56px] px-3 py-1.5'

/* ================= badge grid template ================= */

/** Column count per breakpoint. The register cell is capped at 462px from
 * 1280 (max-w-6xl), so six columns is the ceiling that keeps a slot at
 * ~72–78px from md up — eight would give 57px cells and clip every name to
 * six characters. */
export const BADGE_GRID = 'grid-cols-4 sm:grid-cols-5 lg:grid-cols-6'

/** Cell box shared by live slots and ghost slots: at least square, a
 * top-anchored column — a 14px index strip, the sprite centred in the
 * slack, the name (from sm) at the foot. Where the cell is narrower than
 * its content is tall the grid row grows; the index never overprints
 * the sprite. */
export const BADGE_CELL = 'flex aspect-square flex-col items-stretch p-1.5 sm:p-2'

/** The index strip at the top of a slot. */
export const BADGE_INDEX = 'block h-[14px] shrink-0 text-left leading-none'

/** The sprite well: fills the slack, centres the sprite. */
export const BADGE_SPRITE = 'relative flex flex-1 items-center justify-center'

/** Sprite box: 32px below md, 40px from md. */
export const BADGE_SPRITE_SIZE = 'block h-8 w-8 md:h-10 md:w-10'

/** Name: hidden below sm (the strip and the sheet carry it), two clamped
 * lines from sm. */
export const BADGE_NAME =
  'hidden w-full shrink-0 pt-1 text-center leading-[1.25] tracking-[0.02em] sm:line-clamp-2 sm:min-h-[2.5em] sm:whitespace-normal'

/* ================= lookups ================= */

/** SRC column: how the plate is obtained, in five characters or fewer. */
export function sourceTag(plate: PlateDef): string {
  if (plate.priceUsd !== null) return usd(plate.priceUsd)
  if (plate.proExclusive) return 'PRO'
  if (plate.championExclusive) return '#1'
  if (plate.betaExclusive) return 'BETA'
  return 'N/A'
}

/* ================= grid measurement ================= */

/** Resolved track count of a CSS grid — the responsive column classes
 * are the source of truth, so keyboard rows and filler cells read the
 * live layout instead of duplicating the breakpoints. */
export function readGridColumns(el: HTMLElement): number {
  const tracks = getComputedStyle(el).gridTemplateColumns.trim()
  return tracks ? tracks.split(' ').length : 1
}

/** Column count of the grid behind `ref`, re-measured on resize. 0 until
 * the first measurement lands (SSR and the very first client paint).
 * `mounted` must flip true in the render that attaches the grid — a ref
 * alone cannot re-run the effect when the grid appears after a loading
 * or empty state. */
export function useGridColumns<T extends HTMLElement>(
  ref: RefObject<T>,
  mounted: boolean
): number {
  const [cols, setCols] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!mounted || !el) return
    const measure = () => setCols(readGridColumns(el))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, mounted])
  return cols
}

/** Empty cells needed to complete the last row of an n-item grid, so the
 * trailing space reads as empty inventory slots instead of a bare slab. */
export function fillerCount(items: number, cols: number): number {
  if (cols <= 0) return 0
  return (cols - (items % cols)) % cols
}
