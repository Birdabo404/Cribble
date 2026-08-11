'use client'

// Descent stage 05 — THE FLIGHT PLAN. Touchdown: a trajectory line that
// draws itself with scroll, three mission phases, and the R&D centerpiece —
// a live terminal typing out the agent tracker that will meter Cursor,
// Claude Code, Codex and the rest of the CLI fleet.

import { CSSProperties, useEffect, useRef, useState } from 'react'
import { ToolIcon } from '@/components/leaderboard/icons'
import { prefersReducedMotion } from '@/lib/motion'
import {
  AGENT_CHIPS,
  AGENT_TERMINAL_LINES,
  ROADMAP_PHASES,
  type RoadmapPhase
} from './data'
import { Seam, SectionHeader, Stage, useStageLive } from './scrollFx'

function StatusChip({ status }: { status: RoadmapPhase['status'] }) {
  if (status === 'LIVE') {
    return (
      <span
        className="flex items-center gap-1.5 rounded border px-2 py-1 text-[8px] tracking-[0.3em]"
        style={{
          color: 'var(--accent)',
          borderColor: 'rgb(var(--accent-rgb) / 0.45)',
          background: 'rgb(var(--accent-rgb) / 0.07)'
        }}
      >
        <span
          className="rm-live-dot h-1 w-1 rounded-full"
          style={{ background: 'var(--accent)' }}
        />
        LIVE
      </span>
    )
  }
  if (status === 'CHARTED') {
    return (
      <span className="rounded border border-zinc-700 px-2 py-1 text-[8px] tracking-[0.3em] text-zinc-400">
        CHARTED
      </span>
    )
  }
  return (
    <span
      className="rounded border border-dashed px-2 py-1 text-[8px] tracking-[0.3em]"
      style={{ color: 'rgb(var(--r-legendary))', borderColor: 'rgb(var(--r-legendary) / 0.5)' }}
    >
      R&D
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Agent-tracker terminal                                              */
/* ------------------------------------------------------------------ */

function AgentTerminal() {
  const live = useStageLive()
  const [count, setCount] = useState(AGENT_TERMINAL_LINES.length)
  const [typed, setTyped] = useState('')
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => {
    if (!live || prefersReducedMotion()) return
    setCount(0)
    setTyped('')
    const cmd = AGENT_TERMINAL_LINES[0].text

    // type the command character by character, then reveal output lines
    let ci = 0
    const typeNext = () => {
      ci++
      setTyped(cmd.slice(0, ci))
      if (ci < cmd.length) {
        timers.current.push(setTimeout(typeNext, 34 + Math.random() * 40))
      } else {
        timers.current.push(setTimeout(() => setCount(1), 320))
        for (let i = 2; i <= AGENT_TERMINAL_LINES.length; i++) {
          timers.current.push(setTimeout(() => setCount(i), 320 + (i - 1) * 430))
        }
      }
    }
    timers.current.push(setTimeout(typeNext, 700))

    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [live])

  const done = count >= AGENT_TERMINAL_LINES.length
  const reduced = typeof window !== 'undefined' && prefersReducedMotion()

  // The terminal is a fixed dark artifact (like the plates): its surface
  // never flips with the theme, so every hue inside is a literal — themed
  // zinc classes would invert to near-black text on the dark pane.
  // Chrome stays neutral like a real terminal; green is reserved for the
  // prompt, the live agents and the total — the parts that are alive.
  const INK = {
    bright: '#f4f4f5',
    row: '#e4e4e7',
    label: '#a1a1aa',
    sys: '#8a8a93',
    dim: '#5b5b64',
    green: '#ccff00',
    up: 'rgb(74 222 128)',
    edge: 'rgb(255 255 255 / 0.09)'
  }

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: '#050505',
        border: '1px solid rgb(255 255 255 / 0.12)',
        boxShadow: '0 24px 60px -28px rgb(0 0 0 / 0.9)'
      }}
    >
      {/* title bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: `1px solid ${INK.edge}` }}
      >
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: '#ff5f57' }} />
          <span className="h-2 w-2 rounded-full" style={{ background: '#febc2e' }} />
          <span className="h-2 w-2 rounded-full" style={{ background: '#28c840' }} />
        </span>
        <span className="text-[9px] tracking-[0.3em]" style={{ color: INK.sys }}>
          CRIBBLE AGENT · PREVIEW BUILD
        </span>
        <span className="text-[9px]" style={{ color: INK.dim }}>⌥⌘T</span>
      </div>

      <div className="min-h-[236px] px-4 py-4 font-mono text-[11px] leading-[1.9] sm:text-[11.5px]">
        {/* typed command */}
        <div>
          <span style={{ color: INK.green }}>$ </span>
          <span style={{ color: INK.bright }}>
            {live && !reduced ? typed.replace(/^\$ /, '') : AGENT_TERMINAL_LINES[0].text.replace(/^\$ /, '')}
          </span>
          {!done && <span className="rm-caret ml-0.5 inline-block h-3 w-[6px] align-middle" />}
        </div>

        {AGENT_TERMINAL_LINES.slice(1).map((line, i) => {
          const visible = count >= i + 2 || count >= AGENT_TERMINAL_LINES.length
          return (
            <div
              key={i}
              className="rm-term-line"
              style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(3px)' }}
            >
              {line.tone === 'sys' && (
                <span className="whitespace-pre-wrap" style={{ color: INK.sys }}>
                  {line.text}
                </span>
              )}
              {line.tone === 'dim' && (
                <span className="whitespace-pre" style={{ color: INK.dim }}>
                  {line.text}
                </span>
              )}
              {line.tone === 'row' && (
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate whitespace-pre">
                    <span style={{ color: INK.green }}>● </span>
                    <span style={{ color: INK.row }}>{line.text.slice(2)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: INK.up }}>
                    +{line.pts}
                  </span>
                </span>
              )}
              {line.tone === 'total' && (
                <span
                  className="mt-1 flex items-baseline justify-between gap-3 pt-2"
                  style={{ borderTop: `1px solid ${INK.edge}` }}
                >
                  <span className="tracking-[0.14em]" style={{ color: INK.label }}>
                    SESSION TOTAL
                  </span>
                  <span
                    className="tabular-nums"
                    style={{ color: INK.green, textShadow: '0 0 12px rgb(204 255 0 / 0.5)' }}
                  >
                    1,369 pts → global board
                  </span>
                </span>
              )}
            </div>
          )
        })}
        {done && (
          <div className="mt-1">
            <span style={{ color: INK.green }}>$ </span>
            <span className="rm-caret ml-0.5 inline-block h-3 w-[6px] align-middle" />
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Phase node                                                          */
/* ------------------------------------------------------------------ */

function PhaseNode({
  phase,
  index,
  children
}: {
  phase: RoadmapPhase
  index: number
  children?: React.ReactNode
}) {
  const rnd = phase.status === 'R&D'
  return (
    <div
      className="st relative pl-12 sm:pl-16"
      style={{ '--d': `${300 + index * 160}ms` } as CSSProperties}
    >
      {/* node marker on the trajectory */}
      <span
        aria-hidden
        className="absolute left-[11px] top-1 flex h-[22px] w-[22px] items-center justify-center sm:left-[27px]"
        style={{ transform: 'translateX(-50%)' }}
      >
        <span
          className={`h-[10px] w-[10px] rotate-45 ${phase.status === 'LIVE' ? 'rm-node-live' : ''}`}
          style={{
            background:
              phase.status === 'LIVE'
                ? 'var(--accent)'
                : rnd
                  ? 'rgb(var(--r-legendary) / 0.85)'
                  : 'rgb(var(--z600))',
            boxShadow:
              phase.status === 'LIVE'
                ? '0 0 14px rgb(var(--accent-rgb) / 0.8)'
                : rnd
                  ? '0 0 12px rgb(var(--r-legendary) / 0.5)'
                  : 'none'
          }}
        />
      </span>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] tracking-[0.35em] text-zinc-500">
          {phase.phase}
        </span>
        <span className="text-[10px] tracking-[0.3em] text-zinc-700">
          {phase.code}
        </span>
        <StatusChip status={phase.status} />
      </div>

      <h3 className="mt-3 font-display text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
        {phase.headline}
      </h3>

      {phase.items.length > 0 && (
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {phase.items.map((item) => (
            <li
              key={item.title}
              className="rm-item rounded-xl border border-zinc-800/70 bg-[color:var(--panel)] px-4 py-3.5"
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-1 w-1 rounded-full"
                  style={{
                    background: phase.status === 'LIVE' ? 'var(--accent)' : 'rgb(var(--z500))'
                  }}
                />
                <span className="font-display text-[13px] font-semibold text-zinc-100">
                  {item.title}
                </span>
              </span>
              <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-zinc-500 sm:text-[12px]">
                {item.detail}
              </p>
            </li>
          ))}
        </ul>
      )}

      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function RoadmapBody() {
  return (
    <>
      <Seam alt="00 KM" note="TOUCHDOWN · FLIGHT PLAN LOADED" />

      <div className="mt-10 sm:mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SectionHeader
            index="05"
            code="FLIGHT_PLAN"
            title={
              <>
                Where this
                <br />
                is heading.
              </>
            }
            serif={<>the browser was the warm-up lap.</>}
            body={
              <>
                Today Cribble scores the browser. Next it scores the
                terminal: a native tracker that meters Cursor, Claude
                Code, Codex and every other CLI agent in your stack, then
                folds them into the same global rank. Prompts, tool
                calls, the six-hour run you left cooking overnight. All
                of it counts.
              </>
            }
            annotation="TRAJECTORY · PLOTTED"
          />

          {/* the future fleet */}
          <div className="mt-9">
            <span
              className="st block text-[9px] tracking-[0.35em] text-zinc-600"
              style={{ '--d': '380ms' } as CSSProperties}
            >
              AGENT FLEET · PHASE 03 TARGETS
            </span>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {AGENT_CHIPS.map((chip, i) => (
                <span
                  key={chip.name}
                  className="st rm-chip flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-zinc-300"
                  style={{ '--d': `${440 + i * 80}ms` } as CSSProperties}
                >
                  <ToolIcon name={chip.icon} size={13} className="text-zinc-400" />
                  <span className="font-display font-medium">{chip.name}</span>
                </span>
              ))}
              <span
                className="st flex items-center rounded-lg border border-dashed border-zinc-800 px-3 py-2 text-[10px] tracking-[0.2em] text-zinc-600"
                style={{ '--d': '840ms' } as CSSProperties}
              >
                + YOURS
              </span>
            </div>
          </div>
        </div>

        {/* trajectory + phases */}
        <div className="relative">
          {/* the line draws downward as you scroll through the section */}
          <span
            aria-hidden
            className="rm-track absolute bottom-2 left-[11px] top-1 w-px sm:left-[27px]"
          />
          <div className="flex flex-col gap-14">
            {ROADMAP_PHASES.map((phase, i) => (
              <PhaseNode key={phase.phase} phase={phase} index={i}>
                {phase.status === 'R&D' && (
                  <div className="mt-6">
                    <AgentTerminal />
                    <p className="mt-3 text-[9px] tracking-[0.3em] text-zinc-700">
                      {'// CONCEPT CAPTURE · THE CLI IS IN R&D, THE AMBITION IS NOT'}
                    </p>
                  </div>
                )}
              </PhaseNode>
            ))}
          </div>
        </div>
      </div>

      <style jsx global>{`
        .rm-track {
          background: linear-gradient(
            180deg,
            rgb(var(--accent-rgb) / 0.85),
            rgb(var(--accent-rgb) / 0.35) 38%,
            rgb(var(--z700) / 0.7) 70%,
            rgb(var(--r-legendary) / 0.55)
          );
          transform: scaleY(clamp(0, calc(var(--p, 1) * 2.1), 1));
          transform-origin: top center;
          will-change: transform;
        }
        .rm-live-dot {
          box-shadow: 0 0 8px rgb(var(--accent-rgb) / 0.8);
          animation: rm-live-pulse 1.6s ease-in-out infinite;
        }
        .rm-node-live {
          animation: rm-node-throb 2.4s ease-in-out infinite;
        }
        @keyframes rm-node-throb {
          0%,
          100% {
            box-shadow: 0 0 10px rgb(var(--accent-rgb) / 0.7);
          }
          50% {
            box-shadow: 0 0 22px rgb(var(--accent-rgb) / 1);
          }
        }
        @keyframes rm-live-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }
        .rm-item {
          transition: border-color 240ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (hover: hover) and (pointer: fine) {
          .rm-item:hover {
            border-color: rgb(var(--accent-rgb) / 0.35);
            transform: translateY(-2px);
          }
        }
        .rm-chip {
          background: rgb(var(--lb-panel-edge) / 0.04);
          border: 1px solid rgb(var(--lb-panel-edge) / 0.1);
          transition: border-color 240ms ease;
        }
        .rm-chip:hover {
          border-color: rgb(var(--accent-rgb) / 0.4);
        }
        .rm-term-line {
          transition: opacity 380ms ease, transform 380ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .rm-caret {
          /* lives inside the theme-fixed terminal pane — hue is literal */
          background: rgb(204 255 0 / 0.85);
          animation: rm-caret-blink 1.05s steps(1) infinite;
        }
        @keyframes rm-caret-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .rm-track {
            transform: none;
          }
          .rm-live-dot,
          .rm-node-live,
          .rm-caret {
            animation: none;
          }
        }
      `}</style>
    </>
  )
}

export function RoadmapSection() {
  return (
    <section id="descent-roadmap" data-sec="roadmap" className="relative">
      <Stage
        scrub
        className="page-zoom-out mx-auto w-full max-w-6xl px-6 py-16 sm:py-24 md:py-32"
      >
        <RoadmapBody />
      </Stage>
    </section>
  )
}
