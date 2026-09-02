'use client'

// Sheet 04 — HONORS. The real 32-medal service record laid out as a medal
// case on the manifest: one bordered grid of hairline compartments, ink
// for what's earned, faint ink for what's sealed, a 6px rarity square in
// each earned tile's corner (the only non-token colour on the sheet), and
// № 32 — APEX, the legendary that only ever exists on one account — as a
// full-width DASHED row, the Tower's "you" row language for held, not
// collected. Hovering or focusing a compartment prints it to the readout
// rail that closes the frame.
//
//   ┌──┬──┬──┬──┬──┬──┬──┬──┐
//   │01│02│03│04│05│06│07│08│  tiles: border-l border-t, 4 / 6 / 8 cols
//   ├──┼──┼──┼──┼──┼──┼──┼──┤
//   │  …                     │  (empty compartments close the last row)
//   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  APEX · LEGENDARY · 1 OF 1 │ HELD BY @BIRDABO
//   ├────────────────────────┤
//   │ № 12 │ ESCAPE VELOCITY │ RARE │ UNLOCKED │ …description   readout
//   └────────────────────────┘  wrapper: border-r border-b
//
// One owner per edge, like the hero manifest: every tile draws only its
// left and top hairlines, the wrapper draws the frame's right and bottom,
// the APEX row draws its own dashed top and bottom, and the rail-style
// rows inside the frame let their first cell own the left edge. Filler
// compartments (31 tiles never fill a 4/6/8-column row) are shown per
// breakpoint so no compartment is ever open on its right.
//
// The case sits in Sheet's full-width `children` slot — eight columns of
// medals won't fit a 7/12 artifact column — and the artifact column
// carries the CASE INDEX: five hairline rows, one per category, with a
// square per medal (ink = earned, hollow = sealed) and `03 / 06` counts.
// The unlocked total lives in the rail datum as a CountUp.
//
// Entrance is the shared Stage reveal (scrollFx runStageEntrance): every
// tile is `.st-cell` with an inline `--d` computed RADIALLY from the grid
// centre — distance in tile units × 45ms + 120ms, from row/col indices at
// the lg column count (narrower breakpoints get a slightly skewed wave,
// which is fine) — so the GSAP stagger produces the centre-out ignition.
// The APEX row and the readout rail are `.st` rows that land one and two
// rings after the wave's edge. No engine of its own: the anime spring, its
// hn-wait hide + watchdog (Stage has one), the shimmer/halo/beam/crown-bob
// keyframes and every gradient, shadow and glow are gone.
//
// Medal glyphs are the achievement pixel sprites rendered monochrome:
// every cell fills with currentColor, shadow steps at half opacity so the
// relief survives as an engraving in ink. Colours are role tokens only,
// so light mode is the hero's white sheet with no overrides here.

import { CSSProperties, ReactNode, useState } from 'react'
import { PIXEL_GRIDS } from '@/components/achievements/pixelIcons'
import {
  ACHIEVEMENT_CATEGORIES,
  type AchievementDef,
  type AchievementIcon
} from '@/lib/achievements'
import { APEX, HONOR_TILES, RARITY_COLOR } from './data'
import { CountUp } from './scrollFx'
import {
  Sheet,
  SHEET_CELL,
  SHEET_DIM,
  SHEET_INK,
  SHEET_LABEL,
  SHEET_LINE
} from './Sheet'

/** The story the case tells: a mid-ladder pilot's record — commons banked,
 * rares coming in, exactly one epic to prove the ladder keeps going. */
const UNLOCKED = new Set([
  'score_1k',
  'score_10k',
  'score_50k',
  'streak_3',
  'streak_7',
  'streak_14',
  'first_sync',
  'tools_3',
  'tools_5',
  'visits_100',
  'deep_1',
  'day_1k'
])

/** 31 tiles + APEX. */
const TOTAL = HONOR_TILES.length + 1

const pad2 = (n: number) => String(n).padStart(2, '0')

/* ------------------------------------------------------------------ */
/* Grid geometry + the radial wave                                     */
/* ------------------------------------------------------------------ */

/** Column count per breakpoint — must match the grid-cols classes. */
const COLS = { base: 4, sm: 6, lg: 8 } as const

// The wave is authored for the lg grid: 8 columns, 4 rows of tiles.
const WAVE_COLS = COLS.lg
const WAVE_ROWS = Math.ceil(HONOR_TILES.length / WAVE_COLS)
const WAVE_CX = (WAVE_COLS - 1) / 2
const WAVE_CY = (WAVE_ROWS - 1) / 2
const WAVE_BASE_MS = 120
const WAVE_STEP_MS = 45

/** Stage stagger for the i-th compartment: 120ms + 45ms per tile unit of
 *  distance from the grid centre. */
const waveAt = (i: number) =>
  WAVE_BASE_MS +
  Math.round(
    Math.hypot((i % WAVE_COLS) - WAVE_CX, Math.floor(i / WAVE_COLS) - WAVE_CY) *
      WAVE_STEP_MS
  )

/** The wave's edge (a corner tile); APEX and the readout follow it. */
const WAVE_EDGE_MS =
  WAVE_BASE_MS + Math.round(Math.hypot(WAVE_CX, WAVE_CY) * WAVE_STEP_MS)
const APEX_MS = WAVE_EDGE_MS + WAVE_STEP_MS
const READOUT_MS = APEX_MS + WAVE_STEP_MS

// Case index rows lift in behind the hook, spec-list cadence.
const INDEX_START_MS = 200
const INDEX_STEP_MS = 50

/** Stagger offset for the Stage reveal, in ms (read by runStageEntrance). */
const at = (ms: number): CSSProperties => ({ '--d': `${ms}ms` } as CSSProperties)

// Empty compartments that close the last tile row. 31 tiles leave one slot
// open at 4 and 8 columns and five at 6; filler k renders wherever k is
// below that breakpoint's gap, so every compartment keeps a right edge.
const gapAt = (cols: number) => (cols - (HONOR_TILES.length % cols)) % cols
const GAPS = { base: gapAt(COLS.base), sm: gapAt(COLS.sm), lg: gapAt(COLS.lg) }
const FILLER_COUNT = Math.max(GAPS.base, GAPS.sm, GAPS.lg)
const fillerClass = (k: number) =>
  [
    k < GAPS.base ? 'block' : 'hidden',
    k < GAPS.sm ? 'sm:block' : 'sm:hidden',
    k < GAPS.lg ? 'lg:block' : 'lg:hidden'
  ].join(' ')

/* ------------------------------------------------------------------ */
/* Monochrome medal glyph                                              */
/* ------------------------------------------------------------------ */

type GlyphRun = { x: number; y: number; w: number; lit: boolean }

// Sprite chars in ramp order (pixelIcons.ts): index % 4 is the tone step,
// 0–1 shadow, 2–3 light. Ramp identity is dropped — one ink, two tones.
const SLOT_CHARS = '123456789abc'

function toneOf(ch: string): boolean | null {
  const i = SLOT_CHARS.indexOf(ch)
  if (i === -1) return null
  return i % 4 >= 2
}

// 32 sprites × up to 256 cells: collapse horizontal runs of one tone and
// cache per glyph, as PixelIcon does.
const glyphCache = new Map<AchievementIcon, GlyphRun[]>()

function glyphRuns(name: AchievementIcon): GlyphRun[] {
  const cached = glyphCache.get(name)
  if (cached) return cached
  const runs: GlyphRun[] = []
  PIXEL_GRIDS[name].grid.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const lit = toneOf(row[x])
      if (lit === null) {
        x += 1
        continue
      }
      let end = x + 1
      while (end < row.length && toneOf(row[end]) === lit) end += 1
      runs.push({ x, y, w: end - x, lit })
      x = end
    }
  })
  glyphCache.set(name, runs)
  return runs
}

function Glyph({ name, size }: { name: AchievementIcon; size: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {glyphRuns(name).map((run, i) => (
        <rect
          key={i}
          x={run.x}
          y={run.y}
          width={run.w}
          height={1}
          fill="currentColor"
          fillOpacity={run.lit ? 1 : 0.5}
        />
      ))}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Inspection                                                          */
/* ------------------------------------------------------------------ */

type InspectStatus = 'unlocked' | 'sealed' | 'held'

type Inspected = {
  /** 1-based medal number, 1–32. */
  number: number
  def: AchievementDef
  status: InspectStatus
}

function statusCell(status: InspectStatus): {
  label: string
  className: string
  style?: CSSProperties
} {
  switch (status) {
    case 'unlocked':
      return { label: 'UNLOCKED', className: SHEET_INK }
    case 'sealed':
      return { label: 'SEALED', className: SHEET_DIM }
    case 'held':
      return { label: 'HELD', className: '', style: { color: 'var(--lx-signal)' } }
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

/* ------------------------------------------------------------------ */
/* Compartments                                                        */
/* ------------------------------------------------------------------ */

// The Tower you-row hover, plus a 1px signal focus ring drawn inside the
// compartment so it never fights the hairlines.
const COMPARTMENT_HOVER =
  'cursor-default transition-colors ease-[ease] hover:bg-[color:rgb(var(--z900)/0.55)] focus-visible:bg-[color:rgb(var(--z900)/0.55)] focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[color:var(--lx-signal)]'

/** A tile owns its left and top hairlines only. */
const TILE_EDGES = `border-l border-t ${SHEET_LINE}`

function Tile({
  def,
  number,
  delayMs,
  onInspect
}: {
  def: AchievementDef
  number: number
  delayMs: number
  onInspect: (next: Inspected) => void
}) {
  const unlocked = UNLOCKED.has(def.id)
  const inspect = () =>
    onInspect({ number, def, status: unlocked ? 'unlocked' : 'sealed' })

  return (
    <button
      type="button"
      onPointerEnter={inspect}
      onFocus={inspect}
      onClick={inspect}
      aria-label={`№ ${pad2(number)} ${def.name} — ${def.rarity}, ${
        unlocked ? 'unlocked' : 'sealed'
      }. ${def.description}`}
      className={`st-cell relative flex h-24 flex-col items-center justify-center lg:h-28 ${TILE_EDGES} ${COMPARTMENT_HOVER}`}
      style={at(delayMs)}
    >
      {/* Ink for earned, faint ink at half opacity for sealed — on an inner
          span so the Stage's opacity reveal never fights it. */}
      <span
        className={`flex flex-col items-center gap-2.5 ${
          unlocked ? SHEET_INK : 'text-[color:var(--lx-ink-faint)] opacity-50'
        }`}
      >
        <Glyph name={def.icon} size={28} />
        <span className={SHEET_LABEL}>{pad2(number)}</span>
      </span>

      {/* Rarity: a 6px square, filled in the rarity colour once earned; a
          hollow line-strong square while sealed. */}
      <span
        aria-hidden
        className="absolute right-2 top-2 h-1.5 w-1.5"
        style={
          unlocked
            ? { background: RARITY_COLOR[def.rarity] }
            : { border: '1px solid var(--lx-line-strong)' }
        }
      />
    </button>
  )
}

function ApexRow({ onInspect }: { onInspect: (next: Inspected) => void }) {
  const inspect = () => onInspect({ number: TOTAL, def: APEX, status: 'held' })

  return (
    <button
      type="button"
      onPointerEnter={inspect}
      onFocus={inspect}
      onClick={inspect}
      aria-label={`№ ${TOTAL} ${APEX.name} — legendary, 1 of 1 in circulation, held by @birdabo. ${APEX.description}`}
      className={`st col-span-full flex h-14 items-stretch border-y border-dashed border-[color:var(--lx-line-strong)] text-left ${SHEET_LABEL} ${COMPARTMENT_HOVER}`}
      style={at(APEX_MS)}
    >
      <span className={`${SHEET_CELL} ${SHEET_INK}`}>
        <Glyph name={APEX.icon} size={28} />
      </span>
      <span className={`${SHEET_CELL} min-w-0 gap-2 whitespace-nowrap ${SHEET_INK}`}>
        <span>{APEX.name}</span>
        <span className={SHEET_DIM}>·</span>
        <span>{APEX.rarity.toUpperCase()}</span>
        <span className={`hidden gap-2 md:flex ${SHEET_DIM}`}>
          <span>·</span>
          <span className={SHEET_INK}>1 OF 1 IN CIRCULATION</span>
        </span>
      </span>
      <span
        className={`${SHEET_CELL} ml-auto whitespace-nowrap`}
        style={{ color: 'var(--lx-signal)' }}
      >
        <span className="hidden sm:inline">HELD BY&nbsp;</span>@BIRDABO
      </span>
    </button>
  )
}

/** The rail row that closes the frame: what the pointer is on. */
function Readout({ inspected }: { inspected: Inspected | null }) {
  let cells: ReactNode
  if (inspected) {
    const status = statusCell(inspected.status)
    cells = (
      <>
        <span className={`${SHEET_CELL} whitespace-nowrap ${SHEET_INK}`}>
          <span className={SHEET_DIM}>№&nbsp;</span>
          {pad2(inspected.number)}
        </span>
        <span className={`${SHEET_CELL} min-w-0 ${SHEET_INK}`}>
          <span className="truncate">{inspected.def.name}</span>
        </span>
        <span className={`${SHEET_CELL} hidden whitespace-nowrap sm:flex ${SHEET_DIM}`}>
          {inspected.def.rarity.toUpperCase()}
        </span>
        <span
          className={`${SHEET_CELL} whitespace-nowrap ${status.className}`}
          style={status.style}
        >
          {status.label}
        </span>
        <span className={`${SHEET_CELL} hidden min-w-0 flex-1 lg:flex ${SHEET_DIM}`}>
          <span className="truncate uppercase">{inspected.def.description}</span>
        </span>
      </>
    )
  } else {
    cells = (
      <span className={`${SHEET_CELL} ${SHEET_DIM}`}>HOVER A MEDAL TO INSPECT</span>
    )
  }

  return (
    <div
      className={`st col-span-full flex h-12 items-stretch ${SHEET_LABEL}`}
      style={at(READOUT_MS)}
    >
      {cells}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The case                                                            */
/* ------------------------------------------------------------------ */

function MedalCase() {
  const [inspected, setInspected] = useState<Inspected | null>(null)

  return (
    <div
      className={`grid grid-cols-4 border-b border-r sm:grid-cols-6 lg:grid-cols-8 ${SHEET_LINE}`}
    >
      {HONOR_TILES.map((def, i) => (
        <Tile
          key={def.id}
          def={def}
          number={i + 1}
          delayMs={waveAt(i)}
          onInspect={setInspected}
        />
      ))}

      {Array.from({ length: FILLER_COUNT }, (_, k) => (
        <span
          key={`filler-${k}`}
          aria-hidden
          className={`st-cell h-24 lg:h-28 ${TILE_EDGES} ${fillerClass(k)}`}
          style={at(waveAt(HONOR_TILES.length + k))}
        />
      ))}

      <ApexRow onInspect={setInspected} />
      <Readout inspected={inspected} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Case index — the artifact column                                    */
/* ------------------------------------------------------------------ */

const CASE_INDEX = ACHIEVEMENT_CATEGORIES.map((category) => {
  const medals = [...HONOR_TILES, APEX].filter((d) => d.category === category)
  return {
    category,
    medals,
    unlocked: medals.filter((d) => UNLOCKED.has(d.id)).length
  }
})

function CaseIndex() {
  return (
    <div className={SHEET_LABEL}>
      <div
        className={`st flex items-center justify-between pb-3 ${SHEET_DIM}`}
        style={at(INDEX_START_MS)}
      >
        <span>CASE INDEX</span>
        <span>UNLOCKED / CUT</span>
      </div>
      <dl>
        {CASE_INDEX.map((row, i) => (
          <div
            key={row.category}
            className={`st flex items-center gap-4 border-t py-3 ${SHEET_LINE} ${
              i === CASE_INDEX.length - 1 ? 'border-b' : ''
            }`}
            style={at(INDEX_START_MS + INDEX_STEP_MS * (i + 1))}
          >
            <dt className={`w-24 shrink-0 sm:w-28 ${SHEET_DIM}`}>
              {row.category.toUpperCase()}
            </dt>
            <dd className="flex min-w-0 flex-1 items-center gap-4">
              {/* One square per medal: ink = earned, hollow = sealed. */}
              <span aria-hidden className="flex gap-1">
                {row.medals.map((d) => (
                  <span
                    key={d.id}
                    className="h-1.5 w-1.5"
                    style={
                      UNLOCKED.has(d.id)
                        ? { background: 'var(--lx-ink)' }
                        : { border: '1px solid var(--lx-line-strong)' }
                    }
                  />
                ))}
              </span>
              <span className={`ml-auto whitespace-nowrap tabular-nums ${SHEET_INK}`}>
                {pad2(row.unlocked)} / {pad2(row.medals.length)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sheet 04                                                            */
/* ------------------------------------------------------------------ */

const SPECS = [
  { label: 'MEDALS', value: String(TOTAL) },
  {
    label: 'CUT FROM',
    value: ACHIEVEMENT_CATEGORIES.map((c) => c.toUpperCase()).join(' · ')
  },
  { label: `№ ${TOTAL}`, value: 'HELD, NEVER COLLECTED' }
]

export function HonorsSection() {
  return (
    <Sheet
      id="honors"
      index="04"
      label="HONORS"
      datum={
        <span>
          <span className={SHEET_INK}>
            <CountUp to={UNLOCKED.size} />
          </span>
          {' / '}
          {TOTAL} UNLOCKED
        </span>
      }
      hook={
        <>
          earned in the field, never <em>bought</em>.
        </>
      }
      specs={SPECS}
      artifact={<CaseIndex />}
    >
      <MedalCase />
    </Sheet>
  )
}
