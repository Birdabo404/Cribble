'use client'

// THE AI LEADERBOARD — the arena's second board. Not pilots but the
// machines themselves, ranked by every pilot's combined verified usage
// (via /api/leaderboard/ai, one cached site-wide aggregate). Per spec
// it is deliberately barer than the global board: no plates, no player
// cards, no search, no pagination — the score IS the show. The payload
// is identical for every viewer and refreshes server-side every 5
// minutes, so there is no 15s poll either: fetch on mount and when the
// tab regains focus. It embeds BOTH ranking windows (current season +
// all-time); the SEASON/ALL-TIME pills toggle locally with no refetch.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import {
  formatCompact,
  formatDuration,
  formatNumber,
  formatScore
} from '@/components/dashboard-v2/format'
import {
  IconCrown,
  IconRefresh,
  IconSwords,
  IconTrophy,
  IconUsers,
  ToolIcon
} from '@/components/leaderboard/icons'
import { medalA, medalFor, medalGlow } from '@/components/leaderboard/types'
import type { AiBoards, AiToolRow } from '@/lib/aiLeaderboard'
import { usdDisplayParts } from '@/lib/tokenLeaderboard'

const ROW_GRID =
  'grid grid-cols-[3.6rem_minmax(0,1fr)_auto] md:grid-cols-[4.2rem_minmax(0,1fr)_6.5rem_6.5rem_5.5rem_6.5rem_10.5rem] items-center gap-3 px-4 md:px-5'

/** The two embedded ranking windows. SEASON only exists while a season
 *  is live — the API sends boards.season: null otherwise. */
type AiWindowId = 'season' | 'alltime'

const AI_WINDOWS: { id: AiWindowId; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: 'alltime', label: 'ALL-TIME' }
]

export function AiBoard() {
  const [boards, setBoards] = useState<AiBoards | null>(null)
  const [windowId, setWindowId] = useState<AiWindowId>('season')
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // Once the player picks a window, focus-refetches must not yank the
  // toggle back to the default.
  const userPicked = useRef(false)

  // Monotonic guard, same as the global board: a slow response must
  // never overwrite a newer one.
  const fetchSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++fetchSeq.current
    try {
      const res = await fetch('/api/leaderboard/ai', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (seq !== fetchSeq.current) return
      if (!res.ok || !data?.success || !data.boards?.alltime) {
        setFailed(true)
        return
      }
      const nextBoards = data.boards as AiBoards
      setBoards(nextBoards)
      // SEASON is the default only while a live season board exists;
      // during intermission (or before a calendar) it disappears and
      // ALL-TIME fronts the page.
      setWindowId((current) => {
        if (!nextBoards.season) return 'alltime'
        return userPicked.current ? current : 'season'
      })
      setGeneratedAt(
        typeof data.generatedAt === 'string' ? data.generatedAt : null
      )
      setFailed(false)
    } catch {
      if (seq === fetchSeq.current) setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [load])

  // The active window's board. A stale 'season' pick after the season
  // board vanished falls back to all-time.
  const board =
    boards === null
      ? null
      : windowId === 'season' && boards.season
        ? boards.season
        : boards.alltime
  const activeWindow: AiWindowId =
    windowId === 'season' && boards?.season ? 'season' : 'alltime'
  const tools = board?.tools ?? null
  const totals = board?.totals ?? null

  const loading = boards === null && !failed
  const apex = tools?.[0] ?? null
  const topScore = apex?.score ?? 0

  return (
    <>
      {/* ---------- stat strip ---------- */}
      <section className="lbai-reveal">
        <div className="lb-panel grid grid-cols-2 overflow-hidden md:grid-cols-4">
          <StatCell divider={0} icon={<IconSwords size={11} className="text-zinc-600" />} label="TOOLS RANKED">
            <AnimatedCounter
              value={tools?.length ?? 0}
              duration={1100}
              formatter={(v) => formatNumber(Math.round(v))}
            />
          </StatCell>

          <StatCell divider={1} icon={<IconUsers size={11} className="text-zinc-600" />} label="PLAYERS TRACKED">
            <AnimatedCounter
              value={totals?.pilots ?? 0}
              duration={1100}
              formatter={(v) => formatNumber(Math.round(v))}
            />
          </StatCell>

          <StatCell
            divider={2}
            icon={<IconTrophy size={11} className="text-[rgb(var(--lb-gold)/0.8)]" />}
            label="COMBINED SCORE"
            valueStyle={{
              color: 'rgb(var(--lb-score))',
              textShadow: '0 0 14px rgb(var(--lb-score) / calc(0.4 * var(--lb-glow, 1)))'
            }}
            hint="every player, every tool"
          >
            <AnimatedCounter
              value={totals?.score ?? 0}
              duration={1100}
              formatter={(v) => formatCompact(Math.round(v))}
            />
          </StatCell>

          <StatCell
            divider={3}
            icon={<IconCrown size={11} className="text-[rgb(var(--lb-gold)/0.8)]" />}
            label="APEX TOOL"
            hint={apex ? `${apex.percent}% of the board` : undefined}
          >
            {apex ? (
              <span className="flex items-center justify-center gap-2">
                <ToolIcon name={apex.name} size={14} className="shrink-0 text-zinc-300" />
                <span className="truncate">{apex.name.toUpperCase()}</span>
              </span>
            ) : (
              <span className="text-zinc-700">—</span>
            )}
          </StatCell>
        </div>
      </section>

      {/* ---------- tool standings ---------- */}
      <section className="lbai-reveal relative" style={{ ['--rv' as string]: '120ms' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
              TOOL STANDINGS
            </h2>
            {!loading && !failed && (tools?.length ?? 0) > 0 && (
              <span className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums">
                {tools!.length} MACHINES
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* SEASON / ALL-TIME — same nested-pill dialect as the
                standings-window pills; toggles the embedded boards
                locally, no refetch. Hidden while no season is live. */}
            {boards?.season && (
              <div
                className="lb-inset flex items-center gap-0.5 rounded-lg p-0.5"
                role="tablist"
                aria-label="AI leaderboard window"
              >
                {AI_WINDOWS.map((item) => {
                  const active = activeWindow === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        userPicked.current = true
                        setWindowId(item.id)
                      }}
                      className={`rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.2em] transition-colors ${
                        active ? '' : 'text-zinc-600 hover:text-zinc-300'
                      }`}
                      style={
                        active
                          ? {
                              border: '1px solid rgb(var(--lb-gold) / 0.5)',
                              color: 'rgb(var(--lb-gold))',
                              background: 'rgb(var(--lb-gold) / 0.07)'
                            }
                          : { border: '1px solid transparent' }
                      }
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            )}
            <UpdatedStamp generatedAt={generatedAt} />
          </div>
        </div>

        <div className="lb-panel relative overflow-hidden">
          <div
            className={`${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.08)] py-3 text-[9px] tracking-[0.35em] text-zinc-500`}
          >
            <div>RANK</div>
            <div>TOOL</div>
            <div className="hidden text-right md:block">PLAYERS</div>
            <div className="hidden text-right md:block">TIME</div>
            <div className="hidden text-right md:block">7D</div>
            <div className="hidden text-right md:block">BURN</div>
            <div className="text-right text-zinc-300">SCORE</div>
          </div>

          <ul className="relative">
            {loading &&
              Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} index={i} />)}

            {failed && (
              <li className="flex flex-col items-center gap-4 py-14 text-center">
                <span className="text-xs tracking-[0.15em] text-zinc-500">
                  The machine standings failed to load.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFailed(false)
                    setBoards(null)
                    void load()
                  }}
                  className="lb-inset flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-100"
                >
                  <IconRefresh size={11} />
                  RETRY
                </button>
              </li>
            )}

            {!loading && !failed && (tools?.length ?? 0) === 0 && (
              <li className="py-14 text-center text-xs tracking-[0.15em] text-zinc-500">
                The machines await their first players.
              </li>
            )}

            {!loading &&
              !failed &&
              tools?.map((tool, i) => (
                <ToolRow key={tool.name} tool={tool} index={i} topScore={topScore} />
              ))}
          </ul>
        </div>

        <p className="mt-3 text-center text-[9px] tracking-[0.3em] text-zinc-600">
          {activeWindow === 'season'
            ? 'RANKED BY EVERY PLAYER’S COMBINED CURRENT-SEASON SCORE'
            : 'RANKED BY EVERY PLAYER’S COMBINED LIFETIME SCORE'}
        </p>
        <p className="mt-1 text-center text-[9px] tracking-[0.22em] text-zinc-700">
          BURN = OPT-IN AGENT ESTIMATES · NEVER RANKS A MACHINE
        </p>
      </section>

      <style jsx global>{`
        .lbai-reveal {
          animation: lbai-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        @keyframes lbai-reveal-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
        }
        .lbai-row-in {
          animation: lbai-row-enter 480ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rd, 0ms);
        }
        @keyframes lbai-row-enter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .lbai-reveal,
          .lbai-row-in {
            animation: none;
          }
        }
      `}</style>
    </>
  )
}

/* ================= stat strip cell ================= */

function StatCell({
  divider,
  icon,
  label,
  hint,
  valueStyle,
  children
}: {
  divider: number
  icon: React.ReactNode
  label: string
  hint?: string
  valueStyle?: React.CSSProperties
  children: React.ReactNode
}) {
  const divCls = (() => {
    if (divider === 0) return ''
    if (divider === 1) return 'border-l border-[rgb(var(--lb-panel-edge)/0.08)]'
    if (divider === 2)
      return 'border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:border-t-0 md:border-l'
    return 'border-t border-l border-[rgb(var(--lb-panel-edge)/0.08)] md:border-t-0'
  })()

  return (
    <div className={`flex min-w-0 flex-col items-center overflow-hidden px-4 py-4 text-center ${divCls}`}>
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[9px] tracking-[0.16em] sm:tracking-[0.28em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div
        className="mt-2.5 max-w-full text-[clamp(11px,2.6vw,16px)] text-zinc-50 tabular-nums [font-family:var(--font-pixel)]"
        style={valueStyle}
      >
        {children}
      </div>
      {hint && (
        <div className="mt-1 max-w-full truncate text-[9px] tracking-[0.2em] text-zinc-600">{hint}</div>
      )}
    </div>
  )
}

/* ================= burn read-out ================= */

/** Same USD markup the Burn Board uses: optional "<" for sub-cent
 *  values, green dollar mark, exact-decimal display parts. */
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

/* ================= standings rows ================= */

function ToolRow({
  tool,
  index,
  topScore
}: {
  tool: AiToolRow
  index: number
  topScore: number
}) {
  const medal = medalFor(tool.rank)
  const pct = topScore > 0 ? Math.max(2, Math.round((tool.score / topScore) * 100)) : 0

  return (
    <li
      className={`lbai-row-in ${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.05)] py-4 last:border-b-0`}
      style={{ ['--rd' as string]: `${Math.min(index, 12) * 34}ms` }}
    >
      {/* rank */}
      <div className="flex items-center">
        {medal ? (
          <span
            className="inline-flex h-8 w-8 items-center justify-center text-[11px] [font-family:var(--font-pixel)]"
            style={{
              color: medal.fg,
              border: `1px solid ${medalA(medal.rgb, 0.5)}`,
              background: medalA(medal.rgb, 0.08),
              textShadow: `0 0 10px ${medalGlow(medal.rgb, 0.55)}`
            }}
          >
            {tool.rank}
          </span>
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
            {tool.rank}
          </span>
        )}
      </div>

      {/* tool identity */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300">
          <ToolIcon name={tool.name} size={16} />
        </span>
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className="truncate font-display text-[13px] font-medium tracking-tight"
            style={{ color: 'rgb(var(--z100))' }}
          >
            {tool.name}
          </span>
          <span className="shrink-0 text-[9px] tabular-nums text-zinc-600">
            {tool.percent}%
          </span>
        </span>
      </div>

      {/* pilots */}
      <div className="hidden text-right text-[11px] tabular-nums text-zinc-400 md:block">
        {formatNumber(tool.pilots)}
      </div>

      {/* verified active time */}
      <div className="hidden text-right text-[11px] tabular-nums text-zinc-400 md:block">
        {tool.active_ms > 0 ? formatDuration(tool.active_ms) : <span className="text-zinc-700">·</span>}
      </div>

      {/* 7d gain */}
      <div className="hidden text-right text-[11px] tabular-nums md:block">
        {tool.weekScore > 0 ? (
          <span style={{ color: 'rgb(var(--lb-up))' }}>+{formatCompact(tool.weekScore)}</span>
        ) : (
          <span className="text-zinc-700">·</span>
        )}
      </div>

      {/* opt-in USD burn — display-only, never a rank input */}
      <div
        className="hidden text-right text-[11px] tabular-nums text-zinc-400 md:block"
        title="Estimated agent spend from opted-in players — display only"
      >
        {tool.burnUsd !== '0' ? (
          <BurnValue value={tool.burnUsd} />
        ) : (
          <span className="text-zinc-700">—</span>
        )}
      </div>

      {/* SCORE — the main thing */}
      <div className="text-right">
        <div
          className="text-[13px] leading-none tabular-nums [font-family:var(--font-pixel)]"
          style={{
            color: 'rgb(var(--lb-score))',
            textShadow: medal
              ? '0 0 12px rgb(var(--lb-score) / calc(0.4 * var(--lb-glow, 1)))'
              : '0 0 10px rgb(var(--lb-score) / calc(0.22 * var(--lb-glow, 1)))'
          }}
        >
          {formatScore(tool.score)}
        </div>
        <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.07)]">
          <div
            className="ml-auto h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: medal
                ? `linear-gradient(90deg, ${medalA(medal.rgb, 0.4)}, ${medal.fg})`
                : 'linear-gradient(90deg, rgb(var(--z700)), rgb(var(--z400)))'
            }}
          />
        </div>
      </div>
    </li>
  )
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <li
      className="lbai-row-in border-b border-[rgb(var(--lb-panel-edge)/0.05)]"
      style={{ ['--rd' as string]: `${index * 50}ms` }}
    >
      {/* shimmer blocks ride the panel-edge ink so they read on the white
          panel too */}
      <div className={`${ROW_GRID} animate-pulse py-4`}>
        <span className="h-8 w-8 bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        <span className="flex items-center gap-3">
          <span className="h-9 w-9 rounded-full bg-[rgb(var(--lb-panel-edge)/0.05)]" />
          <span className="h-3 w-28 rounded bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        </span>
        <span className="hidden h-3 w-10 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-3 w-12 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-3 w-10 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-3 w-12 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="h-3.5 w-20 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.06)]" />
      </div>
    </li>
  )
}

/* ================= freshness stamp ================= */

/** Self-ticking "updated Xm ago" so only this leaf re-renders. The board
 *  is a 5-minute server cache, so a 30s tick is plenty. */
function UpdatedStamp({ generatedAt }: { generatedAt: string | null }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!generatedAt) return
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [generatedAt])

  const label = (() => {
    if (!generatedAt) return 'connecting'
    const mins = Math.floor((Date.now() - new Date(generatedAt).getTime()) / 60_000)
    return mins <= 0 ? 'updated just now' : `updated ${mins}m ago`
  })()

  return (
    <span
      className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums"
      suppressHydrationWarning
    >
      {label}
      <span className="mx-2 text-zinc-800">·</span>
      refreshes every 5 min
    </span>
  )
}
