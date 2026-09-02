'use client'

// Sheet — the frame every descent sheet renders inside. The hero is sheet
// 00 of a document of record (rail / tower / footer, drawn in 1px
// hairlines and 10px tracked Plex Mono); the five sheets below the fold
// are the rest of that manifest, and this component is their shared
// anatomy, replacing the old SectionHeader + Seam pair:
//
//   ┌────────────────────────────────────────────────────────┐ top rule
//   │ 01 │ ARENA │ 2,929 PILOTS                │ SHEET 01 / 05 │ rail row
//   ├────────────────────────────┬───────────────────────────┤ rail rule
//   │ somebody holds #1.         │                           │
//   │ it isn't you. *yet*.       │        [artifact]         │ body grid
//   │ ──                         │                           │ 5 / 7 cols
//   │ TABLE      ONE, GLOBAL     │                           │
//   │ RE-SORT    ON EVERY SYNC   │                           │
//   ├────────────────────────────┴───────────────────────────┤
//   │ [children — full-width slot, optional]                 │
//   └────────────────────────────────────────────────────────┘
//
//  · Top rule — `.st-line`, the hero's [data-hero-line]: scaleX 0→1, 0.5s.
//  · Rail row — h-12, mirrors hero/Rail.tsx: each cell owns its left
//    hairline (SHEET_CELL) so no line doubles; index and label in ink, the
//    live datum (hidden below md) and the `SHEET n / N` annotation (hidden
//    below sm) in dim ink. Cells are `.st` rows 40ms apart from 60ms. The
//    datum cell is a flex row with the rail's gap-2.5 already on it, so a
//    sheet passes `<square /> TEXT` as siblings — no wrapper of its own.
//  · Body — a 12-col grid split by one vertical hairline: copy column
//    (5) and artifact column (7), side configurable per sheet. Below lg the
//    copy always comes first and the artifact follows under a top rule.
//    The artifact column insets 32px from the hairline by default;
//    `artifactFlush` drops that inset for artifacts that carry their own
//    (a table on hero/towerStyles.ts's COL_POS sits 20px off the line,
//    exactly like the hero Tower in its compartment).
//  · Copy column — the ONE Instrument Serif sentence at --fs-tagline in
//    --lx-ink with the signal word in an <em> (styled to --lx-signal, no
//    italic); revealed as SplitText masked lines via useMaskedLines, which
//    reads Stage context — hence the SheetBody child. A 40/64px signal
//    hairline (Numeral.tsx's label rule) then a <dl> spec list of ≤3 mono
//    rows LABEL — VALUE, lifting in 50ms apart. From sm the list is a
//    two-column grid (label column sized to its longest label, so labels
//    never wrap; values may) where each row's dt and dd both carry the
//    row's hairline so it runs unbroken across the columns; below sm the
//    label stacks over its value under one hairline.
//  · Children — an optional full-width slot under the grid (the Honors
//    tile grid, the roadmap timeline), separated by a top hairline.
//
// Accent is only ever var(--lx-signal): a 1px rule or one emphasised word.
// No radius, no shadow, no gradient, no glow, no display face. Everything
// animated is `.st*` + inline `--d`, so the Stage's GSAP reveal (scrollFx
// runStageEntrance) owns the choreography and SSR/no-JS/still render the
// final state.

import { CSSProperties, Fragment, ReactNode } from 'react'
import { Stage, useMaskedLines } from './scrollFx'

/** Hairline border color — the manifest's one line weight. */
export const SHEET_LINE = 'border-[color:var(--lx-line)]'
/** Primary ink. */
export const SHEET_INK = 'text-[color:var(--lx-ink)]'
/** Label ink — the readable floor for 10px type (see globals.css). */
export const SHEET_DIM = 'text-[color:var(--lx-ink-dim)]'
/** The 10px tracked Plex Mono label register every cell and spec row uses. */
export const SHEET_LABEL =
  'font-data text-[length:var(--fs-label)] tracking-[0.2em]'
/** A rail cell: owns its left hairline, same paddings as Rail.tsx's CELL. */
export const SHEET_CELL =
  'flex items-center border-l border-[color:var(--lx-line)] px-3 sm:px-5'

export type SheetSpec = { label: string; value: ReactNode }

export type SheetProps = {
  /** Section key — element id `descent-${id}`, `data-sec={id}` (the rope's
   *  tick anchor). */
  id: string
  /** Sheet number, zero-padded: '01'. */
  index: string
  /** Sheet title in the rail: 'ARENA'. */
  label: string
  /** Sheet count for the annotation cell — `SHEET 01 / 05`. */
  total?: string
  /** Optional live datum rail cell ('2,929 PILOTS', 'RECEIVING'); hidden
   *  below md where the rail has no room. */
  datum?: ReactNode
  /** The ONE serif sentence. Wrap the signal word in <em>. */
  hook: ReactNode
  /** ≤3 rows of LABEL — VALUE under the hook. */
  specs: SheetSpec[]
  /** The instrument. */
  artifact: ReactNode
  /** Which side of the vertical hairline the artifact sits on at lg+. */
  artifactSide?: 'left' | 'right'
  /** Drop the artifact column's 32px horizontal inset at lg+, for
   *  artifacts that bring their own (the Arena's Tower-style table). */
  artifactFlush?: boolean
  /** Optional full-width slot below the grid, under its own top hairline. */
  children?: ReactNode
  /** Extra classes for the outer <section>. */
  className?: string
}

/** Stagger offset for the Stage reveal, in ms (read by runStageEntrance). */
const at = (ms: number): CSSProperties => ({ '--d': `${ms}ms` } as CSSProperties)

// Rail cells fade 40ms apart from 60ms (the top rule at 0 leads them, the
// rail's own rule follows at 80); the hook's masked lines start once the
// rail is in, then the signal rule and the spec rows.
const RAIL_STEP_MS = 40
const RAIL_START_MS = 60
const RAIL_LINE_MS = 80
const HOOK_MS = 120
const SIGNAL_RULE_MS = 260
const SPEC_START_MS = 300
const SPEC_STEP_MS = 50

export function Sheet({
  id,
  index,
  label,
  total = '05',
  datum,
  hook,
  specs,
  artifact,
  artifactSide = 'right',
  artifactFlush = false,
  children,
  className = ''
}: SheetProps) {
  return (
    <section
      id={`descent-${id}`}
      data-sec={id}
      className={`lx-sheet relative ${className}`}
    >
      <Stage className="page-zoom-out mx-auto w-full max-w-6xl px-6 py-[var(--rhythm-3)] sm:py-16 md:py-24">
        <SheetBody
          index={index}
          label={label}
          total={total}
          datum={datum}
          hook={hook}
          specs={specs}
          artifact={artifact}
          artifactSide={artifactSide}
          artifactFlush={artifactFlush}
        >
          {children}
        </SheetBody>
      </Stage>

      {/* The signal word inside the serif hook: color only, no italic —
          Instrument Serif's roman is the voice, the color is the emphasis.
          styled-jsx dedupes identical global blocks across sheets. */}
      <style jsx global>{`
        .lx-sheet-hook em {
          font-style: inherit;
          color: var(--lx-signal);
        }
      `}</style>
    </section>
  )
}

/* ------------------------------------------------------------------ */

type SheetBodyProps = Required<
  Pick<SheetProps, 'index' | 'label' | 'total' | 'artifactSide' | 'artifactFlush'>
> &
  Pick<SheetProps, 'datum' | 'hook' | 'specs' | 'artifact' | 'children'>

/** Everything inside the Stage. Split out because useMaskedLines reads the
 *  surrounding Stage's context — called from Sheet itself (outside the
 *  Stage) the hook would never hear "live" and strand the serif hidden. */
function SheetBody({
  index,
  label,
  total,
  datum,
  hook,
  specs,
  artifact,
  artifactSide,
  artifactFlush,
  children
}: SheetBodyProps) {
  const hookRef = useMaskedLines<HTMLParagraphElement>(HOOK_MS)
  const artifactLeft = artifactSide === 'left'
  // The artifact column owns the vertical hairline; its inset from that
  // line is the copy column's mirror unless the artifact brings its own.
  const artifactInset = artifactFlush ? '' : artifactLeft ? 'lg:pr-8' : 'lg:pl-8'

  // Only rendered cells take a stagger slot, so the annotation never waits
  // on a datum that isn't there.
  let railSlot = 0
  const railAt = () => at(RAIL_START_MS + RAIL_STEP_MS * railSlot++)

  return (
    <>
      {/* Top rule */}
      <span
        aria-hidden
        className="st-line block h-px w-full"
        style={{ background: 'var(--lx-line)', ...at(0) }}
      />

      {/* Rail row — each cell owns its left hairline; the first has none
          (the sheet's left edge is the rule's start). */}
      <div className={`flex h-12 items-stretch ${SHEET_LABEL}`}>
        <div
          className={`st flex items-center pr-3 sm:pr-5 ${SHEET_INK}`}
          style={railAt()}
        >
          {index}
        </div>
        <div className={`st ${SHEET_CELL} ${SHEET_INK}`} style={railAt()}>
          {label}
        </div>
        {datum ? (
          <div
            className={`st ${SHEET_CELL} hidden gap-2.5 whitespace-nowrap md:flex ${SHEET_DIM}`}
            style={railAt()}
          >
            {datum}
          </div>
        ) : null}
        <div
          className={`st ${SHEET_CELL} ml-auto hidden whitespace-nowrap sm:flex ${SHEET_DIM}`}
          style={railAt()}
        >
          SHEET {index} / {total}
        </div>
      </div>

      {/* Rail rule */}
      <span
        aria-hidden
        className="st-line block h-px w-full"
        style={{ background: 'var(--lx-line)', ...at(RAIL_LINE_MS) }}
      />

      {/* Body — copy and artifact split by one vertical hairline, owned by
          the artifact column so it never doubles. Below lg the copy reads
          first regardless of side and the artifact takes a top rule. */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div
          className={`py-[var(--rhythm-3)] lg:col-span-5 lg:py-10 ${
            artifactLeft ? 'lg:pl-8' : 'lg:pr-8'
          }`}
        >
          <p
            ref={hookRef}
            className={`st lx-sheet-hook font-serif text-[length:var(--fs-tagline)] leading-[1.1] ${SHEET_INK}`}
            style={at(HOOK_MS)}
          >
            {hook}
          </p>

          {/* Signal rule — Numeral.tsx's label hairline. */}
          <span
            aria-hidden
            className="st-grow mt-[var(--rhythm-2)] block h-px w-10 sm:w-16"
            style={{ background: 'var(--lx-signal)', ...at(SIGNAL_RULE_MS) }}
          />

          {specs.length ? (
            /* Spec list. Both cells of a row are `.st` boxes with the row's
               `--d` (a display:contents wrapper couldn't be transformed),
               and both carry the row's hairline: the label column is
               max-content wide with its gap as right padding — a grid gap
               would break the line between the columns. */
            <dl
              className={`mt-[var(--rhythm-3)] grid grid-cols-1 sm:grid-cols-[max-content_minmax(0,1fr)] ${SHEET_LABEL}`}
            >
              {specs.map((spec, i) => {
                const last = i === specs.length - 1
                const rowAt = at(SPEC_START_MS + SPEC_STEP_MS * i)
                return (
                  <Fragment key={`${i}-${spec.label}`}>
                    <dt
                      className={`st whitespace-nowrap border-t pt-3 pb-1 sm:py-3 sm:pr-4 ${SHEET_LINE} ${SHEET_DIM} ${
                        last ? 'sm:border-b' : ''
                      }`}
                      style={rowAt}
                    >
                      {spec.label}
                    </dt>
                    <dd
                      className={`st min-w-0 pb-3 sm:border-t sm:py-3 ${SHEET_LINE} ${SHEET_INK} ${
                        last ? 'border-b' : ''
                      }`}
                      style={rowAt}
                    >
                      {spec.value}
                    </dd>
                  </Fragment>
                )
              })}
            </dl>
          ) : null}
        </div>

        <div
          className={`border-t ${SHEET_LINE} py-[var(--rhythm-3)] lg:col-span-7 lg:border-t-0 lg:py-10 ${
            artifactLeft ? 'lg:order-first lg:border-r' : 'lg:border-l'
          } ${artifactInset}`}
        >
          {artifact}
        </div>
      </div>

      {children ? (
        <div className={`border-t ${SHEET_LINE} pt-[var(--rhythm-3)]`}>
          {children}
        </div>
      ) : null}
    </>
  )
}
