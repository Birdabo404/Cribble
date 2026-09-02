// Tower table classes — shared by the hero Tower and the descent's Arena
// board so both tables draw identically: same 36px header / 42px row
// heights, same hairline per-cell top borders, same dashed `you` row, same
// column paddings. Class strings only; no runtime.

/** Column header: 10px tracked Plex Mono in dim ink. */
export const TH =
  'h-9 whitespace-nowrap align-middle font-normal text-[length:var(--fs-label)] tracking-[0.2em] text-[color:var(--lx-ink-dim)]'
/** Body cell height/alignment; color is set per column. */
export const TD = 'h-[42px] align-middle'
/** Row hairline — a per-cell top border (the first row skips its own so it
 *  never doubles the header's rule). */
export const LINE = 'border-t border-[color:var(--lx-line)]'
/** The dashed empty row: the pitch. */
export const YOU_LINE =
  'border-y border-dashed border-[color:var(--lx-line-strong)]'

// Column paddings: flush with the container edge below lg; inset from the
// compartment's vertical hairline at lg+. GAP is the last column only from sm.
export const COL_POS = 'pl-0 pr-3 text-left lg:pl-5'
export const COL_CALLSIGN = 'w-full px-3 text-left'
export const COL_ORG = 'hidden px-3 text-left xl:table-cell'
export const COL_SCORE = 'pl-3 pr-0 text-right sm:pr-3'
export const COL_GAP = 'hidden pl-3 pr-0 text-right sm:table-cell'
