// Bag manifest — shared sheet primitives. The registration-marked frame
// both spec sheets sit in, plus the three type atoms every spec table is
// set from: a mono micro label, a mono micro value in one of the status
// tones, and the `<dl>` row that joins them with a dotted leader. All
// colour comes from the --bag-* tokens declared on .bag-manifest; the
// atoms carry no colour of their own beyond those.

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import type { StatusTone } from './bagModel'
import { toneColor } from './manifestChrome'

/** Mono uppercase at the 10px floor — the sheet's data face. */
export const BAG_MICRO =
  '[font-family:var(--bag-font-data)] text-[length:var(--bag-fs-micro)] uppercase leading-[1.4]'

/** Body copy stop: taglines, descriptions. Not uppercase. */
export const BAG_COPY =
  '[font-family:var(--bag-font-data)] text-[length:var(--bag-fs-copy)] leading-[1.5]'

/** Item name as block type. Size is set per sheet (style.fontSize). */
export const BAG_BLOCK_TYPE =
  '[font-family:var(--bag-font-display)] m-0 font-bold uppercase leading-[0.9] tracking-[-0.04em] text-[color:var(--bag-ink)] [overflow-wrap:anywhere]'

/** One block of a sheet: paper surface, compartment padding. Blocks are
 * siblings inside BAG_SHEET, whose 1px gap paints the dividers. */
export const BAG_BLOCK = 'bg-[color:var(--bag-paper)] px-[var(--bag-pad)] py-[var(--bag-pad)]'

/** The sheet frame: hairline border, and the line colour showing through
 * the 1px gaps between BAG_BLOCK children as dividers (no border stacks). */
export const BAG_SHEET = 'grid gap-px border border-[color:var(--bag-line)] bg-[color:var(--bag-line)]'

type FrameTag = 'div' | 'section' | 'article' | 'aside' | 'figure'

export interface RegFrameProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children: ReactNode
  className?: string
  /** Element to render; defaults to a div. */
  as?: FrameTag
  style?: CSSProperties
}

/** A positioned box with the four corner registration crosses. The
 * crosses sit 4px outside the box, so the frame must not clip overflow
 * and needs 4px of breathing room from its own container. */
export function RegFrame({ children, className = '', as = 'div', style, ...rest }: RegFrameProps) {
  const Tag = as
  return (
    <Tag className={`bag-regmarks relative ${className}`} style={style} {...rest}>
      {children}
    </Tag>
  )
}

export interface SheetHeaderProps {
  /** Right-hand stamp, e.g. `PLT-04`. */
  serial: string
  /** Left-hand title; defaults to `[ SPEC SHEET ]`. */
  title?: string
}

/** The mono strip that opens every sheet: title left, serial right. */
export function SheetHeader({ serial, title = '[ SPEC SHEET ]' }: SheetHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 bg-[color:var(--bag-paper)] px-[var(--bag-pad)] py-2 ${BAG_MICRO} tracking-[0.18em] text-[color:var(--bag-mute)]`}
    >
      <span>{title}</span>
      <span>{serial}</span>
    </div>
  )
}

export interface SpecLabelProps {
  children: ReactNode
  className?: string
}

/** Term label: mono micro uppercase, muted, wide-tracked. */
export function SpecLabel({ children, className = '' }: SpecLabelProps) {
  return (
    <span className={`${BAG_MICRO} tracking-[0.18em] text-[color:var(--bag-mute)] ${className}`}>
      {children}
    </span>
  )
}

export interface SpecValueProps {
  children: ReactNode
  /** Status tone the value paints with; defaults to ink. `style.color`
   * (a rarity hue, for instance) wins over the tone. */
  tone?: StatusTone
  className?: string
  style?: CSSProperties
}

/** Data value: mono micro uppercase in a status tone. */
export function SpecValue({ children, tone = 'ink', className = '', style }: SpecValueProps) {
  return (
    <span
      className={`${BAG_MICRO} tracking-[0.12em] ${className}`}
      style={{ color: toneColor(tone), ...style }}
    >
      {children}
    </span>
  )
}

export interface SpecRowProps {
  label: string
  children: ReactNode
  /** Value drops to its own full-width line under the leader — for copy
   * that should wrap (notes, descriptions) instead of right-aligning. */
  block?: boolean
  /** Optional second `<dd>` spanning the full row under the value — the
   * segmented progress bar lives here. */
  detail?: ReactNode
}

/** One `<dl>` row: `<dt>` term · dotted leader · `<dd>` value. Render
 * inside a `<dl>`; the wrapper div is the HTML-sanctioned dt/dd group. */
export function SpecRow({ label, children, block = false, detail }: SpecRowProps) {
  return (
    <div className="bag-leaders">
      <dt className={`${BAG_MICRO} tracking-[0.18em] text-[color:var(--bag-mute)]`}>{label}</dt>
      <span className={block ? 'bag-leader col-span-2' : 'bag-leader'} aria-hidden />
      <dd className={block ? 'col-span-3 m-0 min-w-0 pt-1' : 'm-0 min-w-0 text-right'}>
        {children}
      </dd>
      {detail !== undefined && <dd className="col-span-3 m-0 min-w-0 pt-2">{detail}</dd>}
    </div>
  )
}
