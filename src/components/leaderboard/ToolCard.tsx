'use client'

// Holographic faction card for one machine on the AI board. Opens from
// any standings row or podium throne with the season card's zoom-in
// spring, then tilts like the trading cards. Everything renders off the
// AiToolRow + the window's full list — tools have no profile endpoint,
// so nothing hydrates and nothing fetches. Modal chrome (portal, tilt,
// escape, scroll-lock, close animation) mirrors TokenPlayerCard.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AnimatedCounter from '@/components/AnimatedCounter'
import {
  formatCompact,
  formatDuration,
  formatNumber,
  formatScore
} from '@/components/dashboard-v2/format'
import type { AiToolRow } from '@/lib/aiLeaderboard'
import { identityForTool, toolInkRgb } from '@/lib/aiToolIdentity'
import { prefersReducedMotion } from '@/lib/motion'
import { usdDisplayParts } from '@/lib/tokenLeaderboard'
import { IconClose, IconCrown, IconFlame, ToolIcon } from './icons'
import { medalA, medalFor } from './types'

const CLOSE_MS = 220

function BurnValue({ value }: { value: string }) {
  const display = usdDisplayParts(value)
  return (
    <>
      {display.tiny ? '<' : null}
      <span className="text-[#39ff88]">$</span>
      {display.number}
    </>
  )
}

/** Theme-aware house hue: paints rgb(var(--sh) / a); html.light pins
 *  --sh to the ink triplet so bright brands survive the white panel. */
const hueVars = (rgb: string) => ({
  ['--sd' as string]: rgb,
  ['--si' as string]: toolInkRgb(rgb)
})

export function ToolCard({
  tool,
  tools,
  windowLabel,
  isYourTeam,
  onClose
}: {
  tool: AiToolRow
  /** Full current-window list — rivalry gaps + hottest-this-week. */
  tools: AiToolRow[]
  windowLabel: 'SEASON' | 'ALL-TIME'
  isYourTeam: boolean
  onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const tiltRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const identity = identityForTool(tool.name)
  const medal = medalFor(tool.rank)
  const topScore = tools[0]?.score ?? 0

  const above = tools.find((t) => t.rank === tool.rank - 1) ?? null
  const below = tools.find((t) => t.rank === tool.rank + 1) ?? null
  const maxWeek = tools.reduce((max, t) => Math.max(max, t.weekScore), 0)
  const hottest = tool.weekScore > 0 && tool.weekScore === maxWeek

  const requestClose = useCallback(() => {
    if (prefersReducedMotion()) onCloseRef.current()
    else setClosing(true)
  }, [])

  useEffect(() => {
    if (!closing) return
    const timeout = window.setTimeout(() => onCloseRef.current(), CLOSE_MS)
    return () => window.clearTimeout(timeout)
  }, [closing])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [requestClose])

  // ---- holographic tilt (same treatment as the player cards) ----
  // rAF-coalesced writes, pure transform, mouse only.
  const pointerPos = useRef<{ x: number; y: number } | null>(null)
  const tiltRaf = useRef(0)

  const onTiltMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    pointerPos.current = { x: e.clientX, y: e.clientY }
    if (tiltRaf.current) return
    tiltRaf.current = requestAnimationFrame(() => {
      tiltRaf.current = 0
      const el = tiltRef.current
      const p = pointerPos.current
      if (!el || !p || prefersReducedMotion()) return
      const r = el.getBoundingClientRect()
      const x = (p.x - r.left) / r.width
      const y = (p.y - r.top) / r.height
      el.style.setProperty('--rx', `${((0.5 - y) * 5).toFixed(2)}deg`)
      el.style.setProperty('--ry', `${((x - 0.5) * 7).toFixed(2)}deg`)
    })
  }, [])

  const onTiltLeave = useCallback(() => {
    if (tiltRaf.current) {
      cancelAnimationFrame(tiltRaf.current)
      tiltRaf.current = 0
    }
    const el = tiltRef.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }, [])

  useEffect(
    () => () => {
      if (tiltRaf.current) cancelAnimationFrame(tiltRaf.current)
    },
    []
  )

  if (typeof document === 'undefined') return null

  const sharePct = topScore > 0 ? Math.max(2, Math.round((tool.score / topScore) * 100)) : 0

  // Field composition: the top 5 by rank, plus this tool when it sits
  // below them — its segment must always be on the bar it stars in.
  const fieldTop = tools.slice(0, 5)
  const field = fieldTop.some((t) => t.name === tool.name)
    ? fieldTop
    : [...fieldTop, tool]
  const fieldPercent = field.reduce((sum, t) => sum + t.percent, 0)
  const restPercent = Math.max(0, 100 - fieldPercent)

  const statCells: { label: string; caption?: string; value: React.ReactNode }[] = [
    { label: 'PLAYERS', value: formatNumber(tool.pilots) },
    {
      label: 'TIME',
      value:
        tool.active_ms > 0 ? formatDuration(tool.active_ms) : <span className="text-zinc-700">—</span>
    },
    { label: 'VISITS', value: formatCompact(tool.visits) },
    {
      label: '7D',
      value:
        tool.weekScore > 0 ? (
          <span style={{ color: 'rgb(var(--lb-up))' }}>+{formatCompact(tool.weekScore)}</span>
        ) : (
          <span className="text-zinc-700">·</span>
        )
    },
    {
      label: 'BURN',
      caption: 'OPT-IN EST.',
      value:
        tool.burnUsd !== '0' ? <BurnValue value={tool.burnUsd} /> : <span className="text-zinc-700">—</span>
    },
    {
      label: 'PER PLAYER',
      value:
        tool.active_ms > 0 ? (
          formatDuration(tool.active_ms / Math.max(tool.pilots, 1))
        ) : (
          <span className="text-zinc-700">—</span>
        )
    }
  ]

  return createPortal(
    <div
      className="tc-root fixed inset-0 z-[72] flex items-end justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] font-mono sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Faction card — ${tool.name}`}
      data-closing={closing ? '' : undefined}
    >
      <button
        type="button"
        className="tc-backdrop absolute inset-0 cursor-default"
        onClick={requestClose}
        aria-label="Close faction card"
      />

      <div className="tc-card relative w-full max-w-[440px]">
        <div
          ref={tiltRef}
          className="tc-tilt relative max-h-[calc(100svh-1.5rem)] overflow-y-auto overscroll-contain rounded-3xl"
          onPointerMove={onTiltMove}
          onPointerLeave={onTiltLeave}
          style={{
            ['--tb-d' as string]: identity.rgb,
            ['--tb-i' as string]: toolInkRgb(identity.rgb),
            background: `linear-gradient(180deg, rgb(255 255 255 / 0.04), transparent 30%), rgb(var(--lb-panel-bg))`,
            // Brand tints the card; the medal keeps top billing on 1–3.
            border: `1px solid ${medal ? medalA(medal.rgb, 0.45) : `rgb(var(--tb) / 0.35)`}`,
            boxShadow: medal
              ? `0 30px 90px -30px ${medalA(medal.rgb, 0.4)}, 0 20px 60px -26px rgb(var(--tb) / 0.35), 0 24px 60px -28px rgb(0 0 0 / 0.9)`
              : `0 30px 90px -30px rgb(var(--tb) / 0.4), 0 24px 60px -28px rgb(0 0 0 / 0.9)`
          }}
        >
          {/* ---------- banner ---------- */}
          <div className="relative h-32 overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                // Washes ride the raw brand hue in BOTH themes (pastel on
                // white); only text/borders/fills flip to the light ink.
                background: [
                  `radial-gradient(120% 130% at 18% -10%, rgb(var(--tb-d) / ${medal ? 0.3 : 0.24}), transparent 56%)`,
                  medal
                    ? `radial-gradient(90% 120% at 95% 10%, ${medalA(medal.rgb, 0.16)}, transparent 60%)`
                    : `radial-gradient(90% 120% at 95% 10%, rgb(var(--tb-d) / 0.1), transparent 60%)`,
                  'repeating-linear-gradient(90deg, rgb(var(--lb-panel-edge) / 0.05) 0 1px, transparent 1px 22px)',
                  'repeating-linear-gradient(0deg, rgb(var(--lb-panel-edge) / 0.05) 0 1px, transparent 1px 22px)'
                ].join(', ')
              }}
            />
            <span
              aria-hidden
              className="absolute -bottom-2 right-4 select-none text-[50px] leading-none opacity-[0.12] [font-family:var(--font-pixel)]"
              style={{ color: 'rgb(var(--tb))' }}
            >
              #{tool.rank}
            </span>
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-16"
              style={{ background: 'linear-gradient(180deg, transparent, rgb(var(--lb-panel-bg)))' }}
            />

            <div className="absolute left-3 top-3 flex items-center gap-2">
              <span
                className="rounded-lg px-2.5 py-1.5 text-[13px] leading-none [font-family:var(--font-pixel)]"
                style={{
                  color: medal ? `rgb(${medal.plate})` : 'rgb(244 244 245)',
                  background: 'rgb(0 0 0 / 0.58)',
                  border: `1px solid ${medal ? `rgb(${medal.plate} / 0.5)` : 'rgb(255 255 255 / 0.14)'}`,
                  textShadow: medal ? `0 0 14px rgb(${medal.plate} / 0.6)` : undefined
                }}
              >
                #{tool.rank}
              </span>
              {hottest && (
                <span
                  className="flex items-center gap-1 border px-2 py-1 text-[8px] font-semibold tracking-[0.18em]"
                  style={{
                    color: 'rgb(255 95 31)',
                    borderColor: 'rgb(255 95 31 / 0.38)',
                    background: 'rgb(0 0 0 / 0.58)'
                  }}
                  title="Biggest 7-day gain on the board"
                >
                  <IconFlame size={9} />
                  HEAT
                </span>
              )}
            </div>

            <div className="absolute right-3 top-3">
              <button
                type="button"
                onClick={requestClose}
                autoFocus
                aria-label="Close faction card"
                className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-white sm:h-8 sm:w-8"
                style={{ background: 'rgb(0 0 0 / 0.58)', border: '1px solid rgb(255 255 255 / 0.14)' }}
              >
                <IconClose size={14} />
              </button>
            </div>
          </div>

          {/* ---------- crest ---------- */}
          <div className="relative -mt-10 flex flex-col items-center px-6">
            <div className="relative">
              {tool.rank === 1 && (
                <span
                  aria-hidden
                  className="tc-crown absolute -top-7 left-1/2 -translate-x-1/2 text-[rgb(var(--lb-gold))]"
                >
                  <IconCrown size={20} />
                </span>
              )}
              {/* square crest, not an avatar — tools are houses, not people */}
              <div className="relative h-[84px] w-[84px]">
                {tool.rank === 1 && medal ? (
                  <span
                    aria-hidden
                    className="tc-ring-spin absolute -inset-[3px] rounded-2xl"
                    style={{
                      background: `conic-gradient(from 0deg, transparent 0deg, rgb(var(--tb) / 0.9) 80deg, rgb(var(--lb-gold-hi)) 120deg, transparent 200deg, ${medalA(medal.rgb, 0.55)} 300deg, transparent 360deg)`,
                      filter: `drop-shadow(0 0 10px ${medalA(medal.rgb, 0.55)})`
                    }}
                  />
                ) : (
                  <span
                    aria-hidden
                    className="absolute -inset-[3px] rounded-2xl"
                    style={{
                      background: medal
                        ? `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.9)}, rgb(var(--tb) / 0.4), ${medalA(medal.rgb, 0.9)})`
                        : 'linear-gradient(145deg, rgb(var(--tb) / 0.6), rgb(var(--lb-panel-edge) / 0.14))',
                      boxShadow: medal ? `0 0 18px ${medalA(medal.rgb, 0.3)}` : undefined
                    }}
                  />
                )}
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-2xl"
                  style={{ boxShadow: 'inset 0 0 0 3px rgb(var(--lb-panel-bg))' }}
                />
                <span
                  className="absolute inset-[3px] flex items-center justify-center rounded-[13px]"
                  style={{
                    color: 'rgb(var(--tb))',
                    background: `linear-gradient(180deg, rgb(var(--tb-d) / 0.12), rgb(var(--tb-d) / 0.05)), rgb(var(--lb-panel-bg))`,
                    border: '1px solid rgb(var(--tb) / 0.4)'
                  }}
                >
                  <ToolIcon name={tool.name} size={36} />
                </span>
              </div>
            </div>

            {/* ---------- identity ---------- */}
            <div className="mt-3 flex max-w-full items-center gap-2">
              <span className="truncate font-display text-lg font-semibold tracking-tight text-zinc-50">
                {tool.name}
              </span>
              {isYourTeam && (
                <span
                  className="shrink-0 border px-1.5 py-0.5 text-[8px] tracking-[0.2em]"
                  style={{
                    color: 'rgb(var(--tb))',
                    borderColor: 'rgb(var(--tb) / 0.4)',
                    background: 'rgb(var(--tb) / 0.08)'
                  }}
                >
                  YOUR TEAM
                </span>
              )}
            </div>
            <span
              className="mt-1 text-[9px] font-semibold tracking-[0.35em]"
              style={{ color: 'rgb(var(--tb))' }}
            >
              {identity.epithet}
            </span>
            <span className="mt-1.5 text-[9px] tracking-[0.25em] text-zinc-500 tabular-nums">
              {tool.percent}% OF THE FIELD
            </span>
          </div>

          {/* ---------- hero score ---------- */}
          <div className="mt-5 px-6 text-center">
            <div className="text-[9px] tracking-[0.36em] text-zinc-500">
              FACTION SCORE · {windowLabel}
            </div>
            <div
              className="mt-2 text-[30px] leading-none tabular-nums [font-family:var(--font-pixel)]"
              style={{
                color: 'rgb(var(--lb-score))',
                textShadow: medal
                  ? '0 0 18px rgb(var(--lb-score) / calc(0.55 * var(--lb-glow, 1))), 0 0 44px rgb(var(--lb-score) / calc(0.22 * var(--lb-glow, 1)))'
                  : '0 0 18px rgb(var(--lb-score) / calc(0.28 * var(--lb-glow, 1)))'
              }}
              title={`${formatNumber(tool.score)} pts`}
            >
              <AnimatedCounter
                value={tool.score}
                duration={900}
                formatter={(v) => formatScore(Math.round(v))}
              />
            </div>
            <div className="mx-auto mt-3 h-1 max-w-[240px] overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.07)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${sharePct}%`,
                  background: medal
                    ? `linear-gradient(90deg, ${medalA(medal.rgb, 0.4)}, ${medal.fg})`
                    : `linear-gradient(90deg, rgb(var(--tb) / 0.4), rgb(var(--tb)))`
                }}
              />
            </div>
          </div>

          {/* ---------- stat grid ---------- */}
          <div className="mt-5 grid grid-cols-3 border-y border-[rgb(var(--lb-panel-edge)/0.08)]">
            {statCells.map((cell, index) => (
              <div
                key={cell.label}
                className={`min-w-0 px-3 py-3.5 text-center ${
                  index % 3 > 0 ? 'border-l border-[rgb(var(--lb-panel-edge)/0.08)]' : ''
                } ${index >= 3 ? 'border-t border-[rgb(var(--lb-panel-edge)/0.08)]' : ''}`}
              >
                <div className="truncate text-[11px] tabular-nums text-zinc-200 [font-family:var(--font-pixel)]">
                  {cell.value}
                </div>
                <div className="mt-1 truncate text-[8px] tracking-[0.2em] text-zinc-600">
                  {cell.label}
                </div>
                {cell.caption && (
                  <div className="mt-0.5 truncate text-[7px] tracking-[0.14em] text-zinc-700">
                    {cell.caption}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ---------- rivalry ---------- */}
          {(above || below) && (
            <div className="mt-4 flex justify-center px-6">
              <div
                className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg px-3 py-1.5 text-[10px] tracking-[0.12em]"
                style={{
                  border: `1px solid ${medal ? medalA(medal.rgb, 0.3) : 'rgb(var(--tb) / 0.25)'}`,
                  background: medal ? medalA(medal.rgb, 0.05) : 'rgb(var(--tb-d) / 0.05)'
                }}
              >
                {tool.rank === 1 && below ? (
                  <span className="text-zinc-300 tabular-nums">
                    LEADING <span style={{ color: 'rgb(var(--tb))' }}>{below.name.toUpperCase()}</span> BY{' '}
                    <span className="text-zinc-100">{formatNumber(tool.score - below.score)}</span>
                  </span>
                ) : (
                  above && (
                    <>
                      <span className="text-zinc-400 tabular-nums">
                        <span className="text-zinc-100">
                          {formatNumber(Math.max(1, above.score - tool.score))}
                        </span>{' '}
                        TO CATCH <span className="text-zinc-200">{above.name.toUpperCase()}</span>
                      </span>
                      {below && (
                        <span className="text-zinc-500 tabular-nums">
                          · +{formatNumber(tool.score - below.score)} ON {below.name.toUpperCase()}
                        </span>
                      )}
                    </>
                  )
                )}
              </div>
            </div>
          )}

          {/* ---------- field composition ---------- */}
          <div className="mt-5 px-6 pb-5">
            <div className="flex items-center justify-between text-[9px] tracking-[0.35em] text-zinc-500">
              <span>THE FIELD</span>
              <span className="text-zinc-700">SHARE OF SCORE</span>
            </div>
            <div className="mt-2.5 flex h-2 gap-px overflow-hidden rounded-full">
              {field.map((entry) => {
                const self = entry.name === tool.name
                return (
                  <span
                    key={entry.name}
                    className="tc-hue h-full"
                    style={{
                      ...hueVars(identityForTool(entry.name).rgb),
                      flexGrow: Math.max(entry.percent, 1),
                      flexBasis: 0,
                      background: `rgb(var(--sh) / ${self ? 1 : 0.5})`,
                      // z50 flips with the theme, so the outline holds on
                      // both the dark and the white panel.
                      boxShadow: self ? 'inset 0 0 0 1px rgb(var(--z50) / 0.7)' : undefined
                    }}
                  />
                )
              })}
              {restPercent > 0 && (
                <span
                  className="h-full"
                  style={{
                    flexGrow: restPercent,
                    flexBasis: 0,
                    background: 'rgb(var(--lb-panel-edge) / 0.12)'
                  }}
                />
              )}
            </div>
            <div className="mt-2.5 space-y-1.5">
              {field.map((entry) => {
                const self = entry.name === tool.name
                return (
                  <div
                    key={entry.name}
                    className="tc-hue flex items-center gap-2 text-[10px]"
                    style={hueVars(identityForTool(entry.name).rgb)}
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{
                        background: `rgb(var(--sh) / ${self ? 1 : 0.6})`,
                        border: '1px solid rgb(var(--lb-panel-edge) / 0.2)'
                      }}
                    />
                    <span
                      className={`min-w-0 truncate font-display ${self ? 'font-semibold' : ''}`}
                      style={{ color: self ? 'rgb(var(--sh))' : 'rgb(var(--z400))' }}
                    >
                      {entry.name}
                    </span>
                    {self && isYourTeam && (
                      <span
                        className="shrink-0 border px-1 py-px text-[7px] tracking-[0.2em]"
                        style={{
                          color: 'rgb(var(--sh))',
                          borderColor: 'rgb(var(--sh) / 0.4)',
                          background: 'rgb(var(--sh) / 0.08)'
                        }}
                      >
                        YOU
                      </span>
                    )}
                    <span
                      className="ml-auto shrink-0 tabular-nums [font-family:var(--font-pixel)]"
                      style={{ color: self ? 'rgb(var(--sh))' : 'rgb(var(--z500))' }}
                    >
                      {entry.percent}%
                    </span>
                  </div>
                )
              })}
              {restPercent > 0 && (
                <div className="flex items-center gap-2 text-[10px]">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: 'rgb(var(--lb-panel-edge) / 0.14)' }}
                  />
                  <span className="text-zinc-600">THE REST</span>
                  <span className="ml-auto shrink-0 tabular-nums text-zinc-600 [font-family:var(--font-pixel)]">
                    {restPercent}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ---------- footer ---------- */}
          <div className="border-t border-[rgb(var(--lb-panel-edge)/0.08)] px-6 py-4 text-center text-[8px] leading-4 tracking-[0.18em] text-zinc-600">
            SCORE = VERIFIED TIME + VISITS · BURN NEVER RANKS
          </div>
        </div>
      </div>

      <style jsx global>{`
        .tc-tilt {
          --tb: var(--tb-d);
        }
        html.light .tc-tilt {
          --tb: var(--tb-i);
        }
        .tc-hue {
          --sh: var(--sd);
        }
        html.light .tc-hue {
          --sh: var(--si);
        }

        .tc-backdrop {
          background: rgb(0 0 0 / 0.78);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: tc-backdrop-in 260ms ease backwards;
        }
        html.light .tc-backdrop {
          /* white veil — matches the light canvas instead of dimming it */
          background: rgb(255 255 255 / 0.72);
        }
        @keyframes tc-backdrop-in {
          from {
            opacity: 0;
          }
        }

        /* zoom-in spring — the card grows out of the row you clicked */
        .tc-card {
          animation: tc-card-in 440ms cubic-bezier(0.26, 1.35, 0.45, 1) backwards;
        }
        @keyframes tc-card-in {
          from {
            opacity: 0;
            transform: scale(0.82) translateY(30px);
          }
        }
        @media (max-width: 639px) {
          .tc-card {
            animation: tc-card-in-mobile 420ms cubic-bezier(0.22, 1.1, 0.36, 1) backwards;
          }
        }
        @keyframes tc-card-in-mobile {
          from {
            opacity: 0;
            transform: translateY(24px) scale(0.98);
          }
        }

        /* graceful exit — mirrors the entrance, slightly faster */
        .tc-root[data-closing] {
          pointer-events: none;
        }
        .tc-root[data-closing] .tc-backdrop {
          animation: tc-backdrop-out ${CLOSE_MS}ms ease forwards;
        }
        .tc-root[data-closing] .tc-card {
          animation: tc-card-out ${CLOSE_MS}ms cubic-bezier(0.5, 0, 0.75, 0.4) forwards;
        }
        @keyframes tc-backdrop-out {
          to {
            opacity: 0;
          }
        }
        @keyframes tc-card-out {
          to {
            opacity: 0;
            transform: scale(0.92) translateY(16px);
          }
        }

        .tc-tilt {
          transform: perspective(1100px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
          transition: transform 220ms ease-out;
          will-change: transform;
          scrollbar-width: none;
        }
        .tc-tilt::-webkit-scrollbar {
          display: none;
        }

        .tc-crown {
          animation: tc-crown-bob 2.6s ease-in-out infinite;
          filter: drop-shadow(0 0 8px rgb(var(--lb-gold) / 0.7));
        }
        @keyframes tc-crown-bob {
          0%,
          100% {
            transform: translate(-50%, 0);
          }
          50% {
            transform: translate(-50%, -3px);
          }
        }

        .tc-ring-spin {
          animation: tc-ring-rotate 3.2s linear infinite;
        }
        @keyframes tc-ring-rotate {
          to {
            transform: rotate(360deg);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .tc-backdrop,
          .tc-card,
          .tc-crown,
          .tc-ring-spin {
            animation: none;
          }
          .tc-tilt {
            transform: none;
            transition: none;
            will-change: auto;
          }
        }
      `}</style>
    </div>,
    document.body
  )
}
