'use client'

// Descent stage 02 — THE COCKPIT. A working mock of the pilot dashboard:
// score odometer, sparkline that draws itself, a 12-week heatmap that
// ignites cell by cell, tool split bars, and a sync feed that streams in
// scored sessions. The whole console docks in from below on scroll.

import { CSSProperties, useEffect, useState } from 'react'
import { formatNumber } from '@/components/dashboard-v2/format'
import { ToolIcon } from '@/components/leaderboard/icons'
import { prefersReducedMotion } from '@/lib/motion'
import { COCKPIT, heatLevel, SYNC_FEED } from './data'
import { CountUp, Seam, SectionHeader, Stage, useStageLive } from './scrollFx'

const WEEKS = 12
const DAYS = 7

function Heatmap() {
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: WEEKS }).map((_, w) => (
        <div key={w} className="flex flex-col gap-[3px]">
          {Array.from({ length: DAYS }).map((_, d) => {
            const level = heatLevel(w, d)
            return (
              <span
                key={d}
                className="st-cell h-[9px] w-[9px] rounded-[2px]"
                style={
                  {
                    // column-major ripple: the quarter lights up week by week
                    '--d': `${520 + (w * DAYS + d) * 9}ms`,
                    background:
                      level === 0
                        ? 'rgb(var(--z900) / 0.9)'
                        : `rgb(var(--accent-rgb) / ${0.16 + level * 0.21})`,
                    boxShadow:
                      level >= 3
                        ? `0 0 7px rgb(var(--accent-rgb) / ${level * 0.14})`
                        : undefined
                  } as CSSProperties
                }
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Sparkline() {
  const pts = COCKPIT.spark
  const max = Math.max(...pts)
  const W = 320
  const H = 72
  const step = W / (pts.length - 1)
  const path = pts
    .map(
      (v, i) =>
        `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - (v / max) * (H - 6) - 2).toFixed(1)}`
    )
    .join(' ')
  const last = pts[pts.length - 1]
  const lastY = H - (last / max) * (H - 6) - 2

  return (
    <div className="st-sweep relative" style={{ '--d': '620ms' } as CSSProperties}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[72px] w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="ck-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent-rgb) / 0.28)" />
            <stop offset="100%" stopColor="rgb(var(--accent-rgb) / 0)" />
          </linearGradient>
        </defs>
        <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#ck-fill)" />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
          style={{ filter: 'drop-shadow(0 0 6px rgb(var(--accent-rgb) / 0.5))' }}
        />
      </svg>
      {/* live cursor riding the newest sample */}
      <span
        className="ck-cursor absolute h-2 w-2 rounded-full"
        style={{
          right: '-3px',
          top: `${(lastY / H) * 100}%`,
          background: 'var(--accent)',
          boxShadow: '0 0 10px rgb(var(--accent-rgb) / 0.9)'
        }}
      />
    </div>
  )
}

function SyncFeed() {
  const live = useStageLive()
  const [shown, setShown] = useState(SYNC_FEED.length)

  useEffect(() => {
    if (!live || prefersReducedMotion()) return
    setShown(0)
    let i = 0
    const iv = setInterval(() => {
      i++
      setShown(i)
      if (i >= SYNC_FEED.length) clearInterval(iv)
    }, 620)
    return () => clearInterval(iv)
  }, [live])

  return (
    <div className="flex flex-col gap-1.5 font-mono text-[10.5px] leading-relaxed">
      {SYNC_FEED.map((row, i) => (
        <div
          key={row.site}
          className="ck-feed-row flex items-baseline justify-between gap-3"
          style={{
            opacity: i < shown ? 1 : 0,
            transform: i < shown ? 'none' : 'translateY(4px)'
          }}
        >
          <span className="truncate">
            <span style={{ color: 'rgb(var(--accent-rgb) / 0.75)' }}>▸ </span>
            <span className="text-zinc-300">{row.site}</span>
            <span className="text-zinc-600"> · {row.note}</span>
          </span>
          <span className="shrink-0 tabular-nums" style={{ color: 'rgb(var(--lb-up))' }}>
            +{row.pts}
          </span>
        </div>
      ))}
      <div
        className="mt-1 flex items-center gap-1 text-zinc-500"
        style={{ opacity: shown >= SYNC_FEED.length ? 1 : 0, transition: 'opacity 300ms ease' }}
      >
        <span style={{ color: 'var(--accent)' }}>▸</span>
        <span className="tracking-[0.2em]">EXTENSION SYNCED</span>
        <span className="ck-caret ml-0.5 inline-block h-3 w-[6px]" />
      </div>
    </div>
  )
}

function Panel({
  className = '',
  delay,
  children
}: {
  className?: string
  delay: number
  children: React.ReactNode
}) {
  return (
    <div
      className={`st lx-mod relative overflow-hidden rounded-xl border border-zinc-800/80 bg-[color:var(--panel)] ${className}`}
      style={{ '--d': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  )
}

const PANEL_LABEL = 'text-[8px] tracking-[0.35em] text-zinc-600'

function CockpitBody() {
  return (
    <>
      <Seam alt="34 KM" note="STRATOSPHERE · COCKPIT PRESSURIZED" />

      <div className="mt-10 sm:mt-14 grid grid-cols-1 gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
        {/* the console — scroll-scrubbed dock-in, headers on the right.
            lx-hw: dark emissive hardware in both themes (see Descent). */}
        <div className="ck-console lx-hw order-2 lg:order-1">
          <div className="grid grid-cols-2 gap-3">
            {/* score hero */}
            <Panel delay={160} className="col-span-2 p-5">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-[0.13] blur-3xl"
                style={{
                  background: 'radial-gradient(circle, var(--accent), transparent 70%)'
                }}
              />
              <div className="relative flex flex-wrap items-end justify-between gap-6">
                <div>
                  <span className={PANEL_LABEL}>TOTAL SCORE</span>
                  <div
                    className="cribble-score-glow mt-3 leading-none tabular-nums [font-family:var(--font-pixel)] text-[30px] sm:text-[36px]"
                    style={{ color: 'var(--accent)' }}
                  >
                    <CountUp to={COCKPIT.score} duration={2100} delay={260} />
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-[10px] tabular-nums">
                    <span style={{ color: 'rgb(var(--lb-up))' }}>
                      ▲ +{formatNumber(COCKPIT.gain24h)} · 24H
                    </span>
                    <span className="text-zinc-600">
                      +{formatNumber(COCKPIT.gain7d)} · 7D
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={PANEL_LABEL}>GLOBAL RANK</span>
                  <div className="mt-2 flex items-baseline justify-end gap-2">
                    <span className="leading-none tabular-nums [font-family:var(--font-pixel)] text-[22px] text-zinc-100">
                      #<CountUp to={COCKPIT.rank} duration={1500} delay={420} />
                    </span>
                    <span className="text-[10px]" style={{ color: 'rgb(var(--lb-up))' }}>
                      ▲{COCKPIT.rankDelta}
                    </span>
                  </div>
                  <span className="mt-1 block text-[9px] tracking-[0.25em] text-zinc-600">
                    OF 2,104 PILOTS
                  </span>
                </div>
              </div>
              <div className="relative mt-5">
                <Sparkline />
              </div>
            </Panel>

            {/* activity heatmap */}
            <Panel delay={300} className="col-span-2 p-5 sm:col-span-1">
              <div className="flex items-center justify-between">
                <span className={PANEL_LABEL}>ACTIVITY · 12 WEEKS</span>
                <span className="text-[9px] tabular-nums text-zinc-600">UTC</span>
              </div>
              <div className="mt-4 overflow-x-auto pb-1">
                <Heatmap />
              </div>
              <div className="mt-3 flex items-center justify-between text-[9px] text-zinc-600">
                <span className="tracking-[0.2em]">
                  STREAK{' '}
                  <span style={{ color: 'var(--accent)' }} className="tabular-nums">
                    {COCKPIT.streakDays}D
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  {[0, 1, 2, 3, 4].map((l) => (
                    <span
                      key={l}
                      className="h-[7px] w-[7px] rounded-[2px]"
                      style={{
                        background:
                          l === 0
                            ? 'rgb(var(--z900))'
                            : `rgb(var(--accent-rgb) / ${0.16 + l * 0.21})`
                      }}
                    />
                  ))}
                </span>
              </div>
            </Panel>

            {/* tool split */}
            <Panel delay={380} className="col-span-2 p-5 sm:col-span-1">
              <span className={PANEL_LABEL}>ARSENAL SPLIT</span>
              <div className="mt-4 flex flex-col gap-2.5">
                {COCKPIT.tools.map((t, i) => (
                  <div key={t.name} className="grid grid-cols-[86px_1fr_30px] items-center gap-2">
                    <span className="flex items-center gap-1.5 text-zinc-300">
                      <ToolIcon name={t.name} size={11} />
                      <span className="truncate font-display text-[10.5px]">{t.name}</span>
                    </span>
                    <span className="h-[5px] overflow-hidden rounded-full bg-zinc-900">
                      <span
                        className="st-grow block h-full rounded-full"
                        style={
                          {
                            '--d': `${560 + i * 110}ms`,
                            width: `${t.pct}%`,
                            background: `linear-gradient(90deg, rgb(var(--accent-rgb) / ${0.9 - i * 0.14}), rgb(var(--accent-rgb) / ${0.45 - i * 0.06}))`,
                            boxShadow: '0 0 8px rgb(var(--accent-rgb) / 0.35)'
                          } as CSSProperties
                        }
                      />
                    </span>
                    <span className="text-right text-[10px] tabular-nums text-zinc-500">
                      {t.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* sync feed */}
            <Panel delay={460} className="col-span-2 p-5">
              <div className="flex items-center justify-between">
                <span className={PANEL_LABEL}>LIVE SYNC FEED</span>
                <span className="flex items-center gap-1.5 text-[8px] tracking-[0.3em]" style={{ color: 'var(--accent)' }}>
                  <span
                    className="ar-live-dot h-1 w-1 rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                  RECEIVING
                </span>
              </div>
              <div className="mt-3.5">
                <SyncFeed />
              </div>
            </Panel>
          </div>

          {/* KPI strip under the console */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {COCKPIT.kpis.map((k, i) => (
              <div
                key={k.label}
                className="st lx-mod rounded-xl border border-zinc-800/80 bg-[color:var(--panel)] px-4 py-3.5"
                style={{ '--d': `${560 + i * 80}ms` } as CSSProperties}
              >
                <span className={PANEL_LABEL}>{k.label}</span>
                <span className="mt-1.5 block leading-none tabular-nums [font-family:var(--font-pixel)] text-[13px] text-zinc-200">
                  {k.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="order-1 lg:order-2 lg:pt-6">
          <SectionHeader
            index="02"
            code="PILOT_DASHBOARD"
            title={
              <>
                Your cockpit.
                <br />
                Zero effort.
              </>
            }
            serif={<>the extension flies. you just read the gauges.</>}
            body={
              <>
                Install once and forget it exists. Every AI session you run
                lands here as score, streaks and a twelve-week heat trail —
                sessionized, deduped, and weighted toward deep work instead of
                tab-flicking. No timers to start. Nothing to log.
              </>
            }
            annotation="TELEMETRY · PASSIVE"
          />

          <ul className="mt-8 flex flex-col gap-3.5">
            {[
              ['SESSIONIZED', 'Heartbeats fuse into sessions; ten focused minutes outscore a hundred idle tabs.'],
              ['SEASONAL', `Season resets every quarter — ${COCKPIT.seasonDaysLeft} days left in Ignition.`],
              ['PRIVATE BY DEFAULT', 'Lurk mode hides your loadout while your rank keeps climbing.']
            ].map(([head, sub], i) => (
              <li
                key={head}
                className="st flex gap-3.5"
                style={{ '--d': `${360 + i * 90}ms` } as CSSProperties}
              >
                <span
                  className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-sm border"
                  style={{
                    borderColor: 'rgb(var(--accent-rgb) / 0.5)',
                    background: 'rgb(var(--accent-rgb) / 0.08)',
                    boxShadow: '0 0 10px rgb(var(--accent-rgb) / 0.2)'
                  }}
                />
                <span>
                  <span className="block text-[10px] tracking-[0.28em] text-zinc-200">
                    {head}
                  </span>
                  <span className="mt-0.5 block font-sans text-[14px] leading-relaxed text-zinc-500 sm:text-[13px]">
                    {sub}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <style jsx global>{`
        .ck-console {
          opacity: clamp(0, calc((var(--p, 1) - 0.03) * 4.2), 1);
          transform: perspective(1200px)
            rotateX(calc(max(0.4 - var(--p, 1), 0) * -22deg))
            scale(calc(1 - max(0.4 - var(--p, 1), 0) * 0.16))
            translateY(calc(max(0.4 - var(--p, 1), 0) * 70px));
          transform-origin: 50% 100%;
          will-change: transform;
        }
        .ck-cursor {
          animation: ck-cursor-pulse 1.4s ease-in-out infinite;
        }
        @keyframes ck-cursor-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.3;
          }
        }
        .ck-feed-row {
          transition: opacity 420ms ease, transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ck-caret {
          background: rgb(var(--accent-rgb) / 0.8);
          animation: ck-caret-blink 1.1s steps(1) infinite;
        }
        @keyframes ck-caret-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .ck-console {
            opacity: 1;
            transform: none;
          }
          .ck-cursor,
          .ck-caret {
            animation: none;
          }
        }
      `}</style>
    </>
  )
}

export function CockpitSection() {
  return (
    <section id="descent-cockpit" data-sec="cockpit" className="relative">
      <Stage
        scrub
        className="page-zoom-out mx-auto w-full max-w-6xl px-6 py-16 sm:py-24 md:py-32"
      >
        <CockpitBody />
      </Stage>
    </section>
  )
}
