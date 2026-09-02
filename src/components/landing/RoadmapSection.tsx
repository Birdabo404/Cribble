'use client'

// Sheet 05 — FLIGHT PLAN. The manifest's last sheet: where the browser-
// scored game goes next. Sheet owns the frame (top rule, rail row, serif
// hook, spec list); this file owns the two instruments inside it:
//
//  · Artifact column — a phase index (three hairline rows `01 · IN ORBIT ·
//    LIVE`, each with its 5px square) over the agent fleet the terminal
//    tracker will meter, drawn as hairline-bordered mono tags. The index
//    is the timeline in miniature, so the tall trajectory below never
//    arrives unannounced.
//  · Full-width slot — the trajectory itself. A 1px vertical hairline that
//    draws top→down with scroll: a scrubbed GSAP tween built inside
//    useSectionMotion, because Sheet's Stage does not scrub and the
//    section has to own its own ScrollTrigger (killed on revert — no
//    runtime, or reduced motion, leaves the CSS default: a full-length
//    line). Three phase blocks hang off it: a rail row (`01 · IN ORBIT ·
//    LIVE · headline`) with a 5px square node on the track (signal fill
//    LIVE, dim fill CHARTED, hollow R&D), hairline STATUS · ITEM · NOTE
//    rows, and under Phase 03 the R&D centrepiece — a hairline-framed
//    terminal typing out the agent tracker on anime timers (typewriter,
//    then line reveals).
//
// Ink on the sheet throughout: the terminal is a compartment of the
// manifest, not a dark pane — no traffic lights, no glow, no literal
// palette. Every entrance is `.st`/`.st-cell` + inline `--d`, so the Stage
// reveal (scrollFx runStageEntrance) owns the choreography and SSR/no-JS/
// still render the final state. The old sticky copy column — and the GSAP
// fake-sticky that stood in for position:sticky under ScrollSmoother — is
// gone: Sheet's copy column carries the words now, and the timeline reads
// full-width like the Tower.

import { CSSProperties, useRef, useState } from 'react'
import { CRIBBLE_EASE_NAME } from '@/lib/landingMotion'
import {
  AGENT_CHIPS,
  AGENT_TERMINAL_LINES,
  ROADMAP_PHASES,
  type RoadmapPhase
} from './data'
import {
  Sheet,
  SHEET_CELL,
  SHEET_DIM,
  SHEET_INK,
  SHEET_LABEL,
  SHEET_LINE,
  type SheetSpec
} from './Sheet'
import { useSectionMotion } from './useSectionMotion'

type PhaseStatus = RoadmapPhase['status']
type AgentLine = (typeof AGENT_TERMINAL_LINES)[number]

/** Stagger offset for the Stage reveal, in ms (read by runStageEntrance). */
const at = (ms: number): CSSProperties => ({ '--d': `${ms}ms` } as CSSProperties)

const SIGNAL_INK = 'text-[color:var(--lx-signal)]'
const FAINT_INK = 'text-[color:var(--lx-ink-faint)]'
/** The Tower's 12px Plex Mono cell register — item titles, notes, the
 *  terminal body. */
const DATA_TEXT = 'font-data text-[12px]'
/** A fleet tag: hairline border, label register, signal on hover. */
const CHIP =
  'flex items-center whitespace-nowrap border px-2.5 py-1.5 uppercase transition-colors duration-[160ms] ease-[ease] hover:border-[color:var(--lx-signal)] hover:text-[color:var(--lx-signal)]'

// Stagger plan (ms). Sheet's own rail lands 60–180, the hook at 120, the
// specs 300–400; the artifact's index rows run beside the specs, the
// fleet tags follow them. The trajectory starts once the artifact is in:
// each phase's rail cells 40ms apart, its item rows 50ms apart, the next
// phase a beat later.
const INDEX_START_MS = 300
const INDEX_STEP_MS = 50
const FLEET_LABEL_MS = 460
const CHIP_START_MS = 500
const CHIP_STEP_MS = 40
const PHASE_START_MS = 420
const PHASE_STEP_MS = 240
const CELL_STEP_MS = 40
const ITEM_OFFSET_MS = 120
const ITEM_STEP_MS = 50

const SPECS: SheetSpec[] = [
  { label: 'NOW', value: 'THE BROWSER' },
  { label: 'NEXT', value: 'THE TERMINAL · CURSOR · CLAUDE CODE · CODEX' },
  { label: 'COUNTS', value: 'PROMPTS · TOOL CALLS · THE OVERNIGHT RUN' }
]

/** The one accent, per status: the node square's fill (or hollow border)
 *  and the ink of the status label beside it. */
function statusStyle(status: PhaseStatus): {
  node: CSSProperties
  ink: string
} {
  switch (status) {
    case 'LIVE':
      return { node: { background: 'var(--lx-signal)' }, ink: SIGNAL_INK }
    case 'CHARTED':
      return { node: { background: 'var(--lx-ink-dim)' }, ink: SHEET_DIM }
    case 'R&D':
      return {
        node: { border: '1px solid var(--lx-line-strong)' },
        ink: SHEET_DIM
      }
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

/** 'PHASE 01' → '01' — the rail's index cell. */
const phaseIndex = (phase: RoadmapPhase) => phase.phase.slice(-2)

/** The 5px square — the hero's signal square, now a status glyph. `snap`
 *  marks the LIVE node on the track that Trajectory flashes once when the
 *  stage goes live. */
function Node({
  status,
  snap = false,
  className = ''
}: {
  status: PhaseStatus
  snap?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      data-node-live={snap && status === 'LIVE' ? '' : undefined}
      className={`block h-[5px] w-[5px] shrink-0 ${className}`}
      style={statusStyle(status).node}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Artifact — phase index + agent fleet                                 */
/* ------------------------------------------------------------------ */

function FlightIndex() {
  return (
    <div>
      <ol className={SHEET_LABEL}>
        {ROADMAP_PHASES.map((phase, i) => {
          const { ink } = statusStyle(phase.status)
          const last = i === ROADMAP_PHASES.length - 1
          return (
            <li
              key={phase.phase}
              className={`st flex items-center gap-4 border-t ${SHEET_LINE} py-3 ${
                last ? 'border-b' : ''
              }`}
              style={at(INDEX_START_MS + INDEX_STEP_MS * i)}
            >
              <span className={`w-6 shrink-0 ${SHEET_INK}`}>
                {phaseIndex(phase)}
              </span>
              <span className={`min-w-0 flex-1 ${SHEET_INK}`}>{phase.code}</span>
              <span className={`flex items-center gap-2.5 ${ink}`}>
                <Node status={phase.status} />
                {phase.status}
              </span>
            </li>
          )
        })}
      </ol>

      <p
        className={`st mt-[var(--rhythm-3)] ${SHEET_LABEL} ${SHEET_DIM}`}
        style={at(FLEET_LABEL_MS)}
      >
        AGENT FLEET · PHASE 03 TARGETS
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {AGENT_CHIPS.map((chip, i) => (
          <li
            key={chip.name}
            className={`st-cell ${CHIP} border-[color:var(--lx-line-strong)] ${SHEET_LABEL} ${SHEET_INK}`}
            style={at(CHIP_START_MS + CHIP_STEP_MS * i)}
          >
            {chip.name}
          </li>
        ))}
        {/* Dashed = open, yours to fill — the Tower's empty-row language. */}
        <li
          className={`st-cell ${CHIP} border-dashed border-[color:var(--lx-line-strong)] ${SHEET_LABEL} ${SHEET_DIM}`}
          style={at(CHIP_START_MS + CHIP_STEP_MS * AGENT_CHIPS.length)}
        >
          + YOURS
        </li>
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Agent-tracker terminal                                              */
/* ------------------------------------------------------------------ */

const Prompt = () => <span className={SHEET_DIM}>$ </span>

const Caret = () => (
  <span
    aria-hidden
    className="rm-caret ml-0.5 inline-block h-3 w-[6px] align-middle"
  />
)

/** One output line, by tone. The command line is typed separately. */
function TerminalLine({ line }: { line: AgentLine }) {
  switch (line.tone) {
    case 'cmd':
      return null
    case 'sys':
      return (
        <span className={`whitespace-pre-wrap ${SHEET_DIM}`}>{line.text}</span>
      )
    case 'dim':
      return (
        <span className={`block truncate whitespace-pre ${FAINT_INK}`}>
          {line.text}
        </span>
      )
    case 'row':
      return (
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate whitespace-pre">
            <span className={SIGNAL_INK}>● </span>
            <span>{line.text.slice(2)}</span>
          </span>
          <span className="shrink-0 tabular-nums">+{line.pts}</span>
        </span>
      )
    case 'total': {
      // 'SESSION TOTAL    1,369 pts → …' — label and value are split by
      // the column gap in the script itself.
      const [label, value] = line.text.split(/\s{2,}/)
      return (
        <span
          className={`mt-1 flex items-baseline justify-between gap-3 border-t ${SHEET_LINE} pt-2`}
        >
          <span className={`tracking-[0.14em] ${SHEET_DIM}`}>{label}</span>
          <span className={`tabular-nums ${SIGNAL_INK}`}>{value}</span>
        </span>
      )
    }
    default: {
      const exhaustive: never = line
      return exhaustive
    }
  }
}

function AgentTerminal({ delayMs }: { delayMs: number }) {
  const [count, setCount] = useState(AGENT_TERMINAL_LINES.length)
  const [typed, setTyped] = useState('')
  // Flips once the typing build actually starts — until then (SSR, chunk
  // still loading, reduced motion) the render below shows the full command.
  const [armed, setArmed] = useState(false)

  const command = AGENT_TERMINAL_LINES[0].text.replace(/^\$ /, '')

  useSectionMotion('roadmap', ({ timer }) => {
    setArmed(true)
    setCount(0)
    setTyped('')

    // Type the command character by character, then reveal output lines.
    // Each keystroke is its own one-shot timer (chained via onComplete) so
    // the irregular 34–74ms rhythm rides the engine tick.
    let ci = 0
    const typeNext = () => {
      ci++
      setTyped(command.slice(0, ci))
      if (ci < command.length) {
        timer({ duration: 34 + Math.random() * 40, onComplete: typeNext })
      } else {
        timer({ duration: 320, onComplete: () => setCount(1) })
        for (let i = 2; i <= AGENT_TERMINAL_LINES.length; i++) {
          timer({
            duration: 320 + (i - 1) * 430,
            onComplete: () => setCount(i)
          })
        }
      }
    }
    timer({ duration: 700, onComplete: typeNext })

    // Reduced motion flipped on mid-type: resolve the whole session, the
    // state SSR renders.
    return () => {
      setTyped(command)
      setCount(AGENT_TERMINAL_LINES.length)
    }
  })

  const done = count >= AGENT_TERMINAL_LINES.length

  return (
    <div
      className="st overflow-hidden border border-[color:var(--lx-line-strong)]"
      style={at(delayMs)}
    >
      {/* Compartment header — a rail row, not a title bar. */}
      <div
        className={`flex h-12 items-stretch border-b ${SHEET_LINE} ${SHEET_LABEL}`}
      >
        <div className={`flex items-center px-3 sm:px-5 ${SHEET_INK}`}>
          CRIBBLE AGENT
        </div>
        <div className={`${SHEET_CELL} ${SHEET_DIM}`}>PREVIEW BUILD</div>
        <div className={`${SHEET_CELL} ml-auto ${SHEET_DIM}`}>R&amp;D</div>
      </div>

      <div className={`px-3 py-4 sm:px-5 ${DATA_TEXT} leading-relaxed ${SHEET_INK}`}>
        {/* typed command */}
        <div>
          <Prompt />
          <span>{armed ? typed : command}</span>
          {!done && <Caret />}
        </div>

        {AGENT_TERMINAL_LINES.slice(1).map((line, i) => {
          const visible = count >= i + 2 || done
          return (
            <div
              key={line.text}
              className="rm-term-line"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? 'none' : 'translateY(3px)'
              }}
            >
              <TerminalLine line={line} />
            </div>
          )
        })}

        {/* visibility (not conditional render) keeps the line in layout
            while the typing replays: unmounting it shrank the pane ~9px,
            and inside ScrollSmoother any document-height change forces a
            full ScrollTrigger refresh mid-scroll. */}
        <div className="mt-1" style={{ visibility: done ? 'visible' : 'hidden' }}>
          <Prompt />
          <Caret />
        </div>
      </div>

      <style jsx global>{`
        .rm-term-line {
          transition:
            opacity 380ms ease,
            transform 380ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .rm-caret {
          background: var(--lx-signal);
          animation: rm-caret-blink 1.05s steps(1) infinite;
        }
        @keyframes rm-caret-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .rm-caret {
            animation: none;
          }
        }
        html[data-motion='reduced'] .rm-caret {
          animation: none;
        }
      `}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Trajectory — the track, the phases, the terminal                    */
/* ------------------------------------------------------------------ */

function PhaseBlock({ phase, index }: { phase: RoadmapPhase; index: number }) {
  const base = PHASE_START_MS + PHASE_STEP_MS * index
  const { ink } = statusStyle(phase.status)
  const lastItem = phase.items.length - 1

  return (
    <li className="relative">
      {/* Node on the track: the root's left padding is the offset back to
          it; 21.5px centres the 5px square on the 48px rail row. */}
      <Node
        status={phase.status}
        snap
        className="absolute -left-6 top-[21.5px] sm:-left-10"
      />

      {/* Rail row — the Sheet's header grammar, one per phase. */}
      <header
        className={`flex h-12 items-stretch border-y ${SHEET_LINE} ${SHEET_LABEL}`}
      >
        <div
          className={`st flex items-center pr-3 sm:pr-5 ${SHEET_INK}`}
          style={at(base)}
        >
          {phaseIndex(phase)}
        </div>
        <div
          className={`st ${SHEET_CELL} whitespace-nowrap ${SHEET_INK}`}
          style={at(base + CELL_STEP_MS)}
        >
          {phase.code}
        </div>
        <div className={`st ${SHEET_CELL} ${ink}`} style={at(base + CELL_STEP_MS * 2)}>
          {phase.status}
        </div>
        <div
          className={`st ${SHEET_CELL} ml-auto hidden whitespace-nowrap uppercase md:flex ${SHEET_DIM}`}
          style={at(base + CELL_STEP_MS * 3)}
        >
          {phase.headline}
        </div>
      </header>

      {/* Items — STATUS · ITEM · NOTE. Per-row top hairlines (the first
          skips its own so it never doubles the rail rule), the last closes
          the block. Below md the note wraps under the title. */}
      {phase.items.length > 0 && (
        <ul>
          {phase.items.map((item, j) => (
            <li
              key={item.title}
              className={`st grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 py-3 transition-colors hover:bg-[color:rgb(var(--z900)/0.55)] sm:gap-x-5 md:grid-cols-[5.5rem_15rem_minmax(0,1fr)] lg:grid-cols-[6rem_18rem_minmax(0,1fr)] ${SHEET_LINE} ${
                j === 0 ? '' : 'border-t'
              } ${j === lastItem ? 'border-b' : ''}`}
              style={at(base + ITEM_OFFSET_MS + ITEM_STEP_MS * j)}
            >
              <span className={`${SHEET_LABEL} ${ink}`}>{phase.status}</span>
              <span className={`${DATA_TEXT} leading-relaxed ${SHEET_INK}`}>
                {item.title}
              </span>
              <span
                className={`col-start-2 ${DATA_TEXT} leading-relaxed md:col-start-3 ${SHEET_DIM}`}
              >
                {item.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      {phase.status === 'R&D' && (
        <div className="mt-[var(--rhythm-2)] lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-8">
            <AgentTerminal delayMs={base + ITEM_OFFSET_MS} />
          </div>
          <p
            className={`st mt-3 lg:col-span-4 lg:mt-0 lg:self-end ${SHEET_LABEL} ${FAINT_INK}`}
            style={at(base + ITEM_OFFSET_MS + 80)}
          >
            CONCEPT CAPTURE · THE CLI IS IN R&amp;D, THE AMBITION IS NOT
          </p>
        </div>
      )}
    </li>
  )
}

function Trajectory() {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)

  // The track's scroll scrub. Sheet's Stage never writes `--p`, so the
  // section builds its own scrubbed tween once the stage goes live; the
  // anime Scope in useSectionMotion reverts it on a reduced-motion flip
  // and the cleanup hands the hairline back to CSS (scaleY 1, full length
  // — the same pose SSR, no-JS and the still tier show). Scroll-linked and
  // linear by contract: `ease: 'none'`, progress is the scroll.
  useSectionMotion('roadmap', ({ motion }) => {
    const root = rootRef.current
    const track = trackRef.current
    if (!root || !track) return
    const { gsap } = motion

    const draw = gsap.fromTo(
      track,
      { scaleY: 0, transformOrigin: 'top center' },
      {
        scaleY: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: root,
          start: 'top 75%',
          end: 'bottom 60%',
          scrub: true
        }
      }
    )

    // The LIVE node snaps once as the sheet goes live — the hero's
    // signal-square beat, not a pulse.
    const liveNode = root.querySelector<HTMLElement>('[data-node-live]')
    const snap = liveNode
      ? gsap.fromTo(
          liveNode,
          { opacity: 0.35 },
          {
            opacity: 1,
            duration: 0.4,
            ease: CRIBBLE_EASE_NAME,
            clearProps: 'opacity'
          }
        )
      : null

    return () => {
      snap?.kill()
      draw.scrollTrigger?.kill()
      draw.kill()
      gsap.set(track, { clearProps: 'transform' })
      if (liveNode) gsap.set(liveNode, { clearProps: 'opacity' })
    }
  })

  return (
    <div ref={rootRef} className="relative pl-6 sm:pl-10">
      {/* The track — a 1px hairline the scrub above draws from the top. */}
      <span
        ref={trackRef}
        aria-hidden
        className="rm-track absolute inset-y-0 left-[2px] w-px origin-top will-change-transform"
        style={{ background: 'var(--lx-line-strong)' }}
      />
      <ol className="flex flex-col gap-[var(--rhythm-3)]">
        {ROADMAP_PHASES.map((phase, i) => (
          <PhaseBlock key={phase.phase} phase={phase} index={i} />
        ))}
      </ol>

      <style jsx global>{`
        /* Not a .st element (the reveal's clearProps would fight the
           scrub's transform), so the track hides with the armed stage by
           hand and fades in as it goes live — by then the scrub owns its
           length, so it never flashes full before drawing. still/no-JS
           never arm: the line simply stands. */
        .rm-track {
          transition: opacity 0.4s ease;
        }
        .stage-armed .rm-track {
          opacity: 0;
          transition: none; /* arming is a cut, like the .st hide */
        }
      `}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function RoadmapSection() {
  return (
    <Sheet
      id="roadmap"
      index="05"
      label="FLIGHT PLAN"
      datum={
        <>
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0"
            style={{ background: 'var(--lx-signal)' }}
          />
          <span>
            <span className={SHEET_INK}>PHASE 01</span> LIVE
          </span>
        </>
      }
      hook={
        <>
          the browser was the <em>warm-up lap</em>.
        </>
      }
      specs={SPECS}
      artifact={<FlightIndex />}
    >
      <Trajectory />
    </Sheet>
  )
}
