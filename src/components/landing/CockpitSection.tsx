'use client'

// Sheet 02 — COCKPIT. The pilot dashboard as a bordered console, drawn in
// the hero's grammar (1px --lx-line hairlines, 10px tracked Plex Mono) and
// rendered inside the Sheet frame: top rule · rail row (02 · COCKPIT ·
// RECEIVING · SHEET 02 / 05) · serif hook + spec list · artifact. The
// console sits LEFT of the vertical hairline — it is the wide object, so
// it leads and the copy annotates it.
//
//   ┌──────────────────────────────┬───────────────────────┐
//   │ TOTAL SCORE                  │ ACTIVITY · 12 WEEKS   │
//   │ 92,369                       │  M ▪▪▪▪▪▪▪▪▪▪▪▪       │
//   │ #29 OF 2,929 PILOTS          │  W ▪▪▪▪▪▪▪▪▪▪▪▪ 12×7  │
//   │ ~~~ sparkline (DrawSVG) ~~~  │  F ▪▪▪▪▪▪▪▪▪▪▪▪       │
//   │ ───────────── baseline       │ STREAK 29D    ▪▪▪▪    │
//   ├──────────────────────────────┴───────────────────────┤
//   │ ARSENAL SPLIT                                        │
//   │ CURSOR   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   34%  │
//   ├──────────────────────────────────────────────────────┤
//   │ LIVE SYNC FEED                                       │
//   │ cursor.com      deep session · 44m              +292 │
//   │ EXTENSION SYNCED ▮                                   │
//   ├───────────┬────────────┬──────────────┬──────────────┤
//   │ VISITS    │ ACTIVE TIME│ DEEP SESSIONS│ FOCUS TODAY  │
//   └───────────┴────────────┴──────────────┴──────────────┘
//
// Every leaf compartment owns its left + top hairline and the console
// draws the right + bottom edge, so no line doubles at any column count
// (the rail's ownership rule). Colour is ink at four alpha steps plus ONE
// signal: the top tool's bar fill, the rail's RECEIVING square, the
// EXTENSION SYNCED line. Nothing is rounded, nothing glows, nothing tilts
// — the old --p perspective dock-in, ember heat, pixel-font numerals,
// blur orb, gradients and box-shadows are gone with the dossier chrome.
//
// Motion, three engines with fixed jobs:
//  · Entrance — the Stage's GSAP reveal (scrollFx runStageEntrance) over
//    the shared `.st*` classes with inline `--d`: compartment blocks lift
//    in 40–60ms apart, heat squares ripple column-major (`.st-cell`), bar
//    fills sweep from the left (`.st-sweep`), the sparkline baseline
//    draws (`.st-line`). The console wrapper itself never moves.
//  · Sparkline — one GSAP DrawSVG tween (0→100% over 0.8s) built inside
//    useSectionMotion once the sheet is live, so it shares the feed's
//    reduced-motion scope and off-stage lifecycle.
//  · Liveness — an anime timer reveals the sync feed row by row (240ms
//    CSS opacity/translate transitions) and snaps the rail's signal
//    square on each beat (class flip → 400ms ease back, the .lx-tick
//    grammar); the caret blink is the single steady-state animation.
//    SSR / no-JS / reduced motion render the final state: full feed,
//    drawn sparkline, square at rest.

import { CSSProperties, RefObject, useRef, useState } from 'react'
import type { LandingLive } from '@/lib/landingLive'
import { CRIBBLE_EASE_NAME } from '@/lib/landingMotion'
import { COCKPIT, heatLevel, SYNC_FEED } from './data'
import { CountUp } from './scrollFx'
import {
  Sheet,
  SHEET_DIM,
  SHEET_INK,
  SHEET_LABEL,
  SHEET_LINE,
  type SheetSpec
} from './Sheet'
import { useSectionMotion } from './useSectionMotion'

const numberFormat = new Intl.NumberFormat('en-US')

const WEEKS = 12
const DAYS = 7
/** heatLevel's day 0 is Sunday (weekends run cooler); mark M / W / F. */
const WEEKDAY_MARKS = ['', 'M', '', 'W', '', 'F', ''] as const

/** Faint ink — decoration only (weekday letters, UTC tag, legend). */
const FAINT = 'text-[color:var(--lx-ink-faint)]'
/** A leaf compartment: owns its left + top hairline. */
const COMPARTMENT = `border-l border-t ${SHEET_LINE} p-4 sm:p-5`
/** Compartment header register. */
const HEAD = `${SHEET_LABEL} ${SHEET_DIM}`
/** Data register — the tower's 12px tabular Plex Mono. */
const DATA = 'font-data text-[12px] tabular-nums'

/** Heat in four ink-alpha steps; heatLevel's 0–4 folds 3 and 4 together
 *  (the hottest two weeks read as solid ink either way). */
const HEAT_INK = [
  'rgb(var(--z800) / 0.5)',
  'rgb(var(--z600))',
  'rgb(var(--z400))',
  'var(--lx-ink)'
] as const
const heatInk = (level: number) =>
  HEAT_INK[Math.min(level, HEAT_INK.length - 1)]

/** Stagger offset for the Stage reveal, in ms (read by runStageEntrance). */
const at = (ms: number): CSSProperties =>
  ({ '--d': `${ms}ms` } as CSSProperties)

// Entrance ladder (ms). The Sheet's own rail lands 60–180 and its hook
// starts at 120, so the console's blocks follow from 160 in 40–60ms steps,
// top-left to bottom-right; the heat ripple runs finer (8ms/cell) so 84
// squares fill inside ~0.7s.
const SCORE_LABEL_MS = 160
const SCORE_MS = 200
const RANK_MS = 240
const SPARK_MS = 280
const HEAT_HEAD_MS = 200
const HEAT_MARKS_MS = 240
const HEAT_START_MS = 280
const HEAT_STEP_MS = 8
const HEAT_FOOT_MS = 320
const ARSENAL_HEAD_MS = 320
const ARSENAL_ROW_MS = 360
const ARSENAL_STEP_MS = 50
const ARSENAL_FILL_LAG_MS = 60
const FEED_HEAD_MS = 400
const FEED_ROWS_MS = 440
const KPI_START_MS = 480
const KPI_STEP_MS = 40

/** DrawSVG starts this long after the sheet goes live — after the score
 *  label and numeral are in, a beat behind its own block's lift. */
const SPARK_DELAY_S = 0.3
const SPARK_DURATION_S = 0.8

/** Feed cadence: one scored session lands every beat. */
const FEED_BEAT_MS = 620
/** Pinned on the rail's signal square for a frame per received row. */
const SIGNAL_ON_CLASS = 'ck-signal-on'

const SPECS: SheetSpec[] = [
  { label: 'INSTALL', value: 'ONCE, THEN INVISIBLE' },
  { label: 'SIGNAL', value: 'HEARTBEATS, WEIGHTED TO DEEP WORK' },
  { label: 'TIMERS · CHECK-INS · HONOR SYSTEM', value: 'NONE' }
]

interface CockpitProps {
  /** Live board size for the "OF n PILOTS" line under the staged rank;
   *  null (read failed) prints a dash rather than a fake denominator. */
  playerCount: LandingLive['playerCount']
}

type SignalRef = RefObject<HTMLSpanElement>

/** Snap: the class pins full opacity with no transition; removing it two
 *  frames later (one painted with it on) lets the 400ms transition ease
 *  back to the resting 0.35 — hero/useTowerLiveness.ts's tick flash. */
function snapSignal(el: HTMLElement | null) {
  if (!el) return
  el.classList.add(SIGNAL_ON_CLASS)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.remove(SIGNAL_ON_CLASS))
  })
}

/* ------------------------------------------------------------------ */
/* Rail datum                                                          */
/* ------------------------------------------------------------------ */

function ReceivingDatum({ signalRef }: { signalRef: SignalRef }) {
  return (
    <>
      <span
        ref={signalRef}
        aria-hidden
        className="ck-signal h-1.5 w-1.5 shrink-0"
        style={{ background: 'var(--lx-signal)' }}
      />
      <span>RECEIVING</span>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Compartments                                                        */
/* ------------------------------------------------------------------ */

function ScoreCompartment({ playerCount }: CockpitProps) {
  return (
    <div className={COMPARTMENT}>
      <span className={`st block ${HEAD}`} style={at(SCORE_LABEL_MS)}>
        TOTAL SCORE
      </span>
      <div
        className={`st mt-3 font-data text-[length:var(--fs-display)] font-semibold leading-none tracking-[-0.04em] tabular-nums ${SHEET_INK}`}
        style={at(SCORE_MS)}
      >
        <CountUp to={COCKPIT.score} duration={1800} delay={SCORE_MS} />
      </div>
      <div
        className={`st mt-3 whitespace-nowrap ${SHEET_LABEL} ${SHEET_DIM}`}
        style={at(RANK_MS)}
      >
        <span className={SHEET_INK}>
          #<CountUp to={COCKPIT.rank} duration={1200} delay={RANK_MS} />
        </span>
        {' OF '}
        {playerCount === null ? '—' : numberFormat.format(playerCount)}
        {' PILOTS'}
      </div>
      <Sparkline />
    </div>
  )
}

/** The score trail: a 1px ink stroke that draws itself (DrawSVG) over a
 *  dim baseline. The viewBox stretches to the compartment width
 *  (preserveAspectRatio none) — no non-scaling-stroke, which DrawSVG can't
 *  measure under a non-proportional scale; at these widths the stretch is
 *  within a few percent of 1 so the hairline stays a hairline. */
function Sparkline() {
  const pathRef = useRef<SVGPathElement>(null)
  const pts = COCKPIT.spark
  const max = Math.max(...pts)
  const W = 320
  const H = 56
  const step = W / (pts.length - 1)
  const d = pts
    .map(
      (v, i) =>
        `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - (v / max) * (H - 2) - 1).toFixed(1)}`
    )
    .join(' ')

  useSectionMotion('cockpit', ({ motion }) => {
    const path = pathRef.current
    if (!path) return
    const tween = motion.gsap.fromTo(
      path,
      { drawSVG: '0%' },
      {
        drawSVG: '100%',
        duration: SPARK_DURATION_S,
        ease: CRIBBLE_EASE_NAME,
        delay: SPARK_DELAY_S
      }
    )
    // Revert hands the path back to CSS fully drawn — the SSR state.
    return () => {
      tween.kill()
      path.style.removeProperty('stroke-dasharray')
      path.style.removeProperty('stroke-dashoffset')
    }
  })

  // The block is `.st` so the Stage reveal holds it at alpha 0 through the
  // frame between the live commit and the build's fromTo snapping the
  // stroke to 0% — otherwise the finished trail would flash once before
  // drawing. Its lift starts with the baseline, the draw 20ms later.
  return (
    <div className="st mt-4" style={at(SPARK_MS)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-14 w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          ref={pathRef}
          d={d}
          fill="none"
          stroke="var(--lx-ink)"
          strokeWidth="1"
        />
      </svg>
      <span
        aria-hidden
        className="st-line block h-px w-full"
        style={{ background: 'var(--lx-line-strong)', ...at(SPARK_MS) }}
      />
    </div>
  )
}

function HeatmapCompartment() {
  return (
    <div className={COMPARTMENT}>
      <div
        className={`st flex items-center justify-between ${HEAD}`}
        style={at(HEAT_HEAD_MS)}
      >
        <span>ACTIVITY · 12 WEEKS</span>
        <span className={FAINT}>UTC</span>
      </div>

      <div className="mt-4 flex gap-2">
        <div
          className={`st flex flex-col gap-[3px] ${SHEET_LABEL} ${FAINT}`}
          style={at(HEAT_MARKS_MS)}
          aria-hidden
        >
          {WEEKDAY_MARKS.map((mark, d) => (
            <span key={d} className="flex h-[9px] w-[9px] items-center leading-none">
              {mark}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {Array.from({ length: WEEKS }).map((_, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {Array.from({ length: DAYS }).map((_, d) => (
                <span
                  key={d}
                  className="st-cell block h-[9px] w-[9px]"
                  style={{
                    // column-major ripple: the quarter fills week by week
                    background: heatInk(heatLevel(w, d)),
                    ...at(HEAT_START_MS + (w * DAYS + d) * HEAT_STEP_MS)
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div
        className={`st mt-4 flex items-center justify-between ${SHEET_LABEL} ${SHEET_DIM}`}
        style={at(HEAT_FOOT_MS)}
      >
        <span>
          STREAK{' '}
          <span className={`tabular-nums ${SHEET_INK}`}>
            {COCKPIT.streakDays}D
          </span>
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          {HEAT_INK.map((ink) => (
            <span
              key={ink}
              className="block h-[7px] w-[7px]"
              style={{ background: ink }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}

/** Tool split — hairline tracks, ink fills; only the daily driver earns
 *  the signal colour. */
function ArsenalCompartment() {
  return (
    <div className={`${COMPARTMENT} sm:col-span-2`}>
      <span className={`st block ${HEAD}`} style={at(ARSENAL_HEAD_MS)}>
        ARSENAL SPLIT
      </span>
      <div className="mt-4 flex flex-col gap-3">
        {COCKPIT.tools.map((tool, i) => {
          const rowMs = ARSENAL_ROW_MS + i * ARSENAL_STEP_MS
          return (
            <div
              key={tool.name}
              className="st grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-center gap-3"
              style={at(rowMs)}
            >
              <span className={`truncate uppercase ${SHEET_LABEL} ${SHEET_INK}`}>
                {tool.name}
              </span>
              <span
                className="relative block h-[2px]"
                style={{ background: 'var(--lx-line-strong)' }}
              >
                <span
                  className="st-sweep absolute inset-y-0 left-0 block"
                  style={{
                    width: `${tool.pct}%`,
                    background: i === 0 ? 'var(--lx-signal)' : 'var(--lx-ink)',
                    ...at(rowMs + ARSENAL_FILL_LAG_MS)
                  }}
                />
              </span>
              <span className={`text-right tabular-nums ${SHEET_LABEL} ${SHEET_DIM}`}>
                {tool.pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Scored sessions landing one per beat. SSR renders the full feed; the
 *  timer (built once the sheet is live, reverted on reduced motion) resets
 *  it and streams the rows back in, snapping the rail's signal square on
 *  each. */
function FeedCompartment({ signalRef }: { signalRef: SignalRef }) {
  const [shown, setShown] = useState(SYNC_FEED.length)

  useSectionMotion('cockpit', ({ timer }) => {
    setShown(0)
    let i = 0
    timer({
      duration: FEED_BEAT_MS,
      loop: true,
      onLoop: (self) => {
        i++
        setShown(i)
        snapSignal(signalRef.current)
        if (i >= SYNC_FEED.length) self.cancel()
      }
    })
    // Reduced motion flipped on mid-stream: resolve to the full feed, the
    // state SSR renders, and let the square rest.
    return () => {
      setShown(SYNC_FEED.length)
      signalRef.current?.classList.remove(SIGNAL_ON_CLASS)
    }
  })

  const synced = shown >= SYNC_FEED.length

  return (
    <div className={`${COMPARTMENT} sm:col-span-2`}>
      <span className={`st block ${HEAD}`} style={at(FEED_HEAD_MS)}>
        LIVE SYNC FEED
      </span>
      {/* `.st` on the list: the SSR'd rows are all visible until the
          build resets them, and that 240ms fade-out must happen behind
          the Stage's alpha 0, not in view. */}
      <div className="st mt-3" style={at(FEED_ROWS_MS)}>
        {SYNC_FEED.map((row, i) => (
          <div
            key={row.site}
            className={`ck-feed-row grid grid-cols-[9rem_minmax(0,1fr)_auto] items-baseline gap-x-4 border-t ${SHEET_LINE} py-2 ${SHEET_LABEL}`}
            style={{
              opacity: i < shown ? 1 : 0,
              transform: i < shown ? 'none' : 'translateY(4px)'
            }}
          >
            <span className={`truncate ${SHEET_INK}`}>{row.site}</span>
            <span className={`truncate ${SHEET_DIM}`}>{row.note}</span>
            <span className={`tabular-nums ${SHEET_INK}`}>+{row.pts}</span>
          </div>
        ))}
        <div
          className={`flex items-center gap-2 border-t ${SHEET_LINE} py-2 ${SHEET_LABEL}`}
          style={{
            color: 'var(--lx-signal)',
            opacity: synced ? 1 : 0,
            transition: 'opacity 240ms ease'
          }}
        >
          <span>EXTENSION SYNCED</span>
          <span aria-hidden className="ck-caret inline-block h-[10px] w-[6px]" />
        </div>
      </div>
    </div>
  )
}

/** The four KPIs as one rail row of hairline cells. Label over value:
 *  four `LABEL VALUE` pairs inline never fit the artifact column, and the
 *  stacked cell is still 56px — the rail's register, one line taller.
 *  Borders stay static (the compartment frame); the pair inside lifts. */
function KpiRail() {
  return (
    <div className="grid grid-cols-2 sm:col-span-2 sm:grid-cols-4">
      {COCKPIT.kpis.map((kpi, i) => (
        <div
          key={kpi.label}
          className={`flex h-14 items-center border-l border-t ${SHEET_LINE} px-4 sm:px-5`}
        >
          <div
            className="st flex flex-col gap-1.5 whitespace-nowrap"
            style={at(KPI_START_MS + i * KPI_STEP_MS)}
          >
            <span className={HEAD}>{kpi.label}</span>
            <span className={`${DATA} ${SHEET_INK}`}>{kpi.value}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Console                                                             */
/* ------------------------------------------------------------------ */

function Console({
  playerCount,
  signalRef
}: CockpitProps & { signalRef: SignalRef }) {
  return (
    <>
      {/* Frame: leaves draw left + top, the wrapper closes right + bottom.
          No entrance class and no transform on the wrapper itself. */}
      <div className={`border-b border-r ${SHEET_LINE}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <ScoreCompartment playerCount={playerCount} />
          <HeatmapCompartment />
          <ArsenalCompartment />
          <FeedCompartment signalRef={signalRef} />
          <KpiRail />
        </div>
      </div>

      {/* Liveness CSS. Transitions only (opacity/transform) on the site
          curve (CRIBBLE_EASE, written out so styled-jsx keeps this block
          static); the caret blink is the one steady-state keyframe and
          both reduced-motion switches (OS media query, in-app
          data-motion) stop it. .ck-signal-on is SIGNAL_ON_CLASS. */}
      <style jsx global>{`
        .ck-signal {
          opacity: 0.35;
          transition: opacity 400ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ck-signal.ck-signal-on {
          opacity: 1;
          transition: none;
        }
        .ck-feed-row {
          transition:
            opacity 240ms ease,
            transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ck-caret {
          background: var(--lx-signal);
          animation: ck-caret-blink 1.1s steps(1) infinite;
        }
        @keyframes ck-caret-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .ck-caret {
            animation: none;
          }
        }
        html[data-motion='reduced'] .ck-caret {
          animation: none;
        }
      `}</style>
    </>
  )
}

/* ------------------------------------------------------------------ */

export function CockpitSection({ playerCount }: CockpitProps) {
  // The rail's RECEIVING square and the feed live in different Sheet
  // slots; the feed's timer snaps the square through this ref — a DOM
  // class flip, never a re-render of the rail.
  const signalRef = useRef<HTMLSpanElement>(null)

  return (
    <Sheet
      id="cockpit"
      index="02"
      label="COCKPIT"
      datum={<ReceivingDatum signalRef={signalRef} />}
      hook={
        <>
          the extension does the counting. you do the <em>flying</em>.
        </>
      }
      specs={SPECS}
      artifact={<Console playerCount={playerCount} signalRef={signalRef} />}
      artifactSide="left"
    />
  )
}
