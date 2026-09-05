// Shared bits for the /u/[username] UNIT RECORD: the spine and the panes
// both draw stroke icons, print inks and the stat-cell anatomy, so they
// live here instead of inside ProfileClient. The paper primitives
// (Frame, PanelHeader, Marker, Brackets, Plate, Stamp) are thin wrappers
// over the .pf-* recipes in dossier.css so every block speaks the same
// row grammar. Colours come only from the --pf-* tokens.

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

/* ---------- page chassis (shared by the record and its fallback screens) ---------- */

/** The page wrapper: zoomed composition, 1120px cap, phone gutters that
 *  the record cancels with -mx-4 so it bleeds edge to edge under the nav
 *  bar, safe-area bottom padding. */
export const PAGE_WRAP =
  'page-zoom-out relative mx-auto max-w-[1120px] px-4 pt-0 sm:px-6 sm:pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))]'

/** The sheet itself: tokens + fill (.pf-dossier), the outer 1px frame,
 *  the registration marks off its corners (.pf-sheet — ink only on the
 *  drafting board), and .pf-bleed to drop the frame's sides below sm. */
export const SHEET = 'pf-dossier pf-sheet pf-bleed pf-frame -mx-4 sm:mx-0'

/* ---------- print inks (dossier.css tokens; muted stamps, never glows) ---------- */

const MEDAL_INK: Record<number, string | undefined> = {
  1: 'var(--pf-gold)',
  2: 'var(--pf-silver)',
  3: 'var(--pf-bronze)'
}

/** Gold / silver / bronze ink for a podium rank; null off the podium. */
export const medalInk = (rank: number | null): string | null =>
  rank == null ? null : (MEDAL_INK[rank] ?? null)

const RARITY_INK: Record<string, string | undefined> = {
  common: 'var(--pf-rarity-common)',
  rare: 'var(--pf-rarity-rare)',
  epic: 'var(--pf-rarity-epic)',
  legendary: 'var(--pf-rarity-legendary)',
  mythic: 'var(--pf-rarity-mythic)'
}

/** Rarity ink; unknown rarities print as common. */
export const rarityInk = (rarity: string): string =>
  RARITY_INK[rarity] ?? 'var(--pf-rarity-common)'

export const monthYear = (iso: string | null | undefined) => {
  if (!iso) return '—'
  return new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase()
}

/* ---------- small stroke icons (24px grid, Lucide path data) ---------- */

export function Stroke({ size = 12, className = '', d }: { size?: number; className?: string; d: string }) {
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

export const PATH_PIN =
  'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
export const PATH_LINK =
  'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
export const PATH_SHARE =
  'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13'
export const PATH_EDIT =
  'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z'
export const PATH_LOCK =
  'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4'
export const PATH_BACK = 'M19 12H5 M12 19l-7-7 7-7'
// HANGAR telemetry + controls (Lucide star / git-fork / globe /
// arrow-up-right / x / plus / chevron-left / chevron-right)
export const PATH_STAR =
  'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
export const PATH_FORK =
  'M12 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9 M12 12v3'
export const PATH_GLOBE =
  'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20 M2 12h20'
export const PATH_ARROW_UP_RIGHT = 'M7 7h10v10 M7 17L17 7'
export const PATH_X = 'M18 6L6 18 M6 6l12 12'
export const PATH_PLUS = 'M5 12h14 M12 5v14'
export const PATH_CHEVRON_LEFT = 'M15 18l-6-6 6-6'
export const PATH_CHEVRON_RIGHT = 'M9 18l6-6-6-6'
// UNIT RECORD chrome (Lucide clock / chevron-down / external-link)
export const PATH_CLOCK = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2'
export const PATH_CHEVRON_DOWN = 'M6 9l6 6 6-6'
export const PATH_EXTERNAL =
  'M15 3h6v6 M10 14L21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'

/* ---------- paper primitives (recipes in dossier.css) ---------- */

/** 1px --pf-line box. Attributes pass through so motion hooks can hang
 *  data-pf-* and the `pf-panel` unfold class off it. */
export function Frame({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`pf-frame ${className}`} {...rest}>
      {children}
    </div>
  )
}

/** Centred `[ TITLE ]` between two wing rules; `aside` is a right-aligned
 *  micro readout (count, timestamp). The brackets are decoration, so
 *  screen readers only get the title. The title sits alone in its own
 *  span carrying data-pf-decode (one text node) so the boot can
 *  scramble it without touching the brackets. */
export function PanelHeader({
  title,
  aside,
  as: Tag = 'h2',
  className = ''
}: {
  title: string
  aside?: ReactNode
  as?: 'h2' | 'h3' | 'div'
  className?: string
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div aria-hidden className="pf-rule flex-1" />
      <Tag className="pf-label shrink-0 whitespace-nowrap">
        <span aria-hidden>{'[ '}</span>
        <span data-pf-decode>{title}</span>
        <span aria-hidden>{' ]'}</span>
      </Tag>
      <div aria-hidden className="pf-rule flex-1" />
      {aside != null && <span className="pf-micro shrink-0 text-right">{aside}</span>}
    </div>
  )
}

/** 6px square list marker; hollow for inactive / secondary rows. Draws
 *  in currentColor, so `style` is for handing it its own ink. */
export function Marker({
  hollow = false,
  className = '',
  style
}: {
  hollow?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      aria-hidden
      className={`pf-marker ${hollow ? 'pf-marker-hollow' : ''} ${className}`}
      style={style}
    />
  )
}

/** Four corner ticks around whatever it wraps (avatar, vacant cell). */
export function Brackets({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`pf-brackets ${className}`}>{children}</div>
}

/** Inverted row — the page's one highlight. */
export function Plate({
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: 'div' | 'span' | 'li' | 'p'; children: ReactNode }) {
  return (
    <Tag className={`pf-plate ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

/** Inline ink stamp (medal, rarity). `ink` comes from medalInk / rarityInk. */
export function Stamp({ ink, className = '', children }: { ink: string; className?: string; children: ReactNode }) {
  return (
    <span className={`pf-stamp ${className}`} style={{ color: ink }}>
      {children}
    </span>
  )
}

/* ===================================================================== */

/** Tighter-tracked micro line for cell context / telemetry strips (the
 *  .pf-micro recipe's 0.18em is still a touch wide for a full sentence).
 *  Explicit utilities rather than pf-micro + an override: dossier.css
 *  outranks utilities of equal specificity. */
export const CONTEXT_LINE =
  'font-data text-[10px] uppercase tracking-[0.15em] text-[color:var(--pf-ink-3)]'

/** Numeral recipes for stat cells: RANK and SCORE print in the pixel
 *  face (dot-matrix on paper); every other count is Plex Mono, tabular. */
export const PIXEL_NUMERAL =
  'text-[17px] leading-none tabular-nums [font-family:var(--font-pixel)] sm:text-[15px] md:text-[18px]'
export const MONO_NUMERAL =
  'font-data text-[19px] font-medium leading-none tabular-nums sm:text-[17px] md:text-[20px]'

/** Follower-only section body for private accounts: a hatched, dashed
 *  vacant cell. The follow CTA already sits in the spine, so this stays
 *  informational. Dashed via inline style: .pf-frame's border shorthand
 *  outranks a utility of equal specificity (dossier.css loads last). */
export function LockedPanel({ hint, className = '' }: { hint: string; className?: string }) {
  return (
    <div
      className={`pf-frame pf-hatch flex flex-col items-center px-4 py-6 text-center ${className}`}
      style={{ borderStyle: 'dashed' }}
    >
      <span
        className="pf-frame flex h-9 w-9 items-center justify-center"
        style={{ color: 'var(--pf-ink-2)', background: 'var(--pf-paper)' }}
      >
        <Stroke d={PATH_LOCK} size={15} />
      </span>
      <div className="pf-label mt-3">FOLLOWERS ONLY</div>
      <p className="mt-1.5 max-w-[240px] text-[11px] leading-relaxed" style={{ color: 'var(--pf-ink-2)' }}>
        {hint}
      </p>
    </div>
  )
}

/** Fixed three-row anatomy (label / numeral / context) so all cells sit on
 * the same baselines regardless of content. Cells own their top+left
 * hairlines (--pf-line-soft); the grid's -1px offset hides the outer
 * edge, which makes the dividers correct at every column count. Phone
 * sizes are the base (10px label / 18px numeral row / 10px context);
 * sm: restores the denser desktop card; md: gives the numeral its room
 * back. Hover lifts the cell to --pf-paper-3. `pf-row` is the motion
 * hook's stagger hook. */
export function StatCell({
  label,
  sub,
  title,
  className = '',
  children
}: {
  label: string
  sub?: ReactNode
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      title={title}
      className={`pf-row border-l border-t border-[color:var(--pf-line-soft)] px-4 py-3.5 transition-colors hover:bg-[color:var(--pf-paper-3)] sm:py-4 md:py-5 ${className}`}
    >
      <div className="pf-micro truncate">{label}</div>
      <div className="mt-2.5 flex h-[18px] items-end sm:h-4 md:h-[18px]">{children}</div>
      <div className={`${CONTEXT_LINE} mt-2 h-3.5 truncate sm:h-3 sm:text-[9px]`}>{sub ?? '\u00A0'}</div>
    </div>
  )
}
