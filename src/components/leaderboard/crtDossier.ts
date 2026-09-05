// The data contract between a leaderboard feed and the CRT monitor.
//
// The tube (CrtMonitor) knows nothing about scores, tokens or dollars — it
// renders a personnel dossier: a name, a halftone portrait, two data bars,
// two codes, one hero figure that counts up in the live phosphor, and a
// bracketed power bar. Each feed (GLOBAL standings, CLI burn, CURSOR burn)
// maps its own row shape onto this record in crtFeeds.ts, so the same
// monitor can be tuned to any board.

export type CrtReadout = { k: string; v: string }

/** The tag-row status lamp: `ONLINE`, `WHALE`, `STREAK 12D`. `on` lights
 *  the LED and the label in the live phosphor; off reads dim white. */
export type CrtStatus = { label: string; on: boolean }

/** The big number. `value` is the count-up target (an approximation is
 *  fine — it only drives the tween); `format` paints every frame. */
export type CrtFigure = { label: string; value: number; format: (n: number) => string }

export type CrtDossier = {
  /** Stable identity: React key and the onSelect round-trip to the row. */
  key: number
  rank: number
  name: string
  /** Rendered as `@handle` in the tag row. */
  handle: string
  /** Portrait source. `handle` seeds the identicon fallback and the
   *  by-handle X avatar refresh; `url` may be a dead link. */
  avatar: { url: string | null; handle: string }
  /** Roster noun for the header index: `PILOT 001/387`, `BURNER 001/042`. */
  roster: string
  status: CrtStatus
  bars: readonly [CrtReadout, CrtReadout]
  codes: readonly [CrtReadout, CrtReadout]
  figure: CrtFigure
  /** The bracketed block bar under the figure: label + 0..1 fill. */
  bar: { label: string; frac: number }
  /** Seed for the `>SIG` telemetry texture — stable per player. */
  seed: number
  /** PRESS START line, e.g. `PRESS START ─ OPEN PILOT CARD`. */
  hint: string
  /** Screen button label while this dossier is on the tube. */
  aria: string
}

/** Which phosphor the live data wears. */
export type CrtTheme = 'amber' | 'ember'

/** The diegetic strings printed on the cabinet and chrome. */
export type CrtChrome = {
  /** Screen chrome, top-left: `CRIBBLE//BROADCAST`. */
  brand: string
  /** Chin plate: `MODEL CRT·1984 // ATTRACT MODE`. */
  model: string
  /** AWAITING SIGNAL subtitle while loading: `SCANNING FOR PILOTS`. */
  scanning: string
  /** Section aria-label in attract mode. */
  aria: string
}

export const BAR_CELLS = 18
const SPARK_GLYPHS = '▁▂▃▄▅▆▇█'

export const pad = (n: number, width = 3) =>
  String(Math.max(0, n)).padStart(width, '0')

/** Bracketed block-glyph power bar: `████▓░····` for a 0..1 fraction. */
export function barString(frac: number): string {
  const clamped = Math.max(0, Math.min(1, frac))
  const filled = clamped * BAR_CELLS
  const full = Math.floor(filled)
  const rem = filled - full
  let s = '█'.repeat(full)
  if (full < BAR_CELLS) s += rem > 0.66 ? '▓' : rem > 0.33 ? '▒' : '░'
  return (s + '·'.repeat(BAR_CELLS)).slice(0, BAR_CELLS)
}

/** Deterministic per-player telemetry strip (pure texture, seeded so the
 *  same pilot always broadcasts the same signal). */
export function sparkline(seed: number): string {
  let x = (seed >>> 0) || 1
  let out = ''
  for (let i = 0; i < 22; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    out += SPARK_GLYPHS[Math.floor((x / 4294967296) * SPARK_GLYPHS.length)]
  }
  return out
}

/** Share of the leader's figure as a 0..1 bar fill. A zero or negative
 *  leader (empty board, bad data) floors to an empty bar. */
export function shareOf(value: number, leader: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(leader) || leader <= 0) return 0
  return Math.max(0, Math.min(1, value / leader))
}
