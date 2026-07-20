'use client'

// THE AI LEADERBOARD — the arena's second board. Not pilots but the
// machines themselves, ranked by every pilot's combined verified usage
// (via /api/leaderboard/ai, one cached site-wide aggregate). Per spec
// it is deliberately barer than the global board: no plates, no player
// cards, no search, no pagination — the score IS the show. The payload
// is identical for every viewer and refreshes server-side every 5
// minutes, so there is no 15s poll either: fetch on mount and when the
// tab regains focus.

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
import { medalA, medalFor } from '@/components/leaderboard/types'
import type { AiBoardTotals, AiToolRow } from '@/lib/aiLeaderboard'

const ROW_GRID =
  'grid grid-cols-[3.4rem_minmax(0,1fr)_auto] md:grid-cols-[4.2rem_minmax(0,1fr)_6.5rem_6.5rem_5.5rem_10.5rem] items-center gap-3 px-4 md:px-5'

export function AiBoard() {
  const [tools, setTools] = useState<AiToolRow[] | null>(null)
  const [totals, setTotals] = useState<AiBoardTotals | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // Monotonic guard, same as the global board: a slow response must
  // never overwrite a newer one.
  const fetchSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++fetchSeq.current
    try {
      const res = await fetch('/api/leaderboard/ai', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (seq !== fetchSeq.current) return
      if (!res.ok || !data?.success) {
        setFailed(true)
        return
      }
      setTools(Array.isArray(data.data) ? (data.data as AiToolRow[]) : [])
      setTotals((data.totals as AiBoardTotals) ?? null)
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

  const loading = tools === null && !failed
  const apex = tools?.[0] ?? null
  const topScore = apex?.score ?? 0

  return (
    <>
      {/* ---------- stat strip ---------- */}
      <section className="lbai-reveal">
        <div className="lb-panel grid grid-cols-2 overflow-hidden rounded-2xl md:grid-cols-4">
          <StatCell divider={0} icon={<IconSwords size={11} className="text-zinc-600" />} label="TOOLS RANKED">
            <AnimatedCounter
              value={tools?.length ?? 0}
              duration={1100}
              formatter={(v) => formatNumber(Math.round(v))}
            />
          </StatCell>

          <StatCell divider={1} icon={<IconUsers size={11} className="text-zinc-600" />} label="PILOTS TRACKED">
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
              textShadow: '0 0 14px rgb(var(--lb-score) / 0.4)'
            }}
            hint="every pilot, every tool"
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
              <span className="flex items-center gap-2">
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
          <UpdatedStamp generatedAt={generatedAt} />
        </div>

        <div className="lb-panel relative overflow-hidden rounded-2xl">
          <div
            className={`${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.08)] py-3 text-[9px] tracking-[0.35em] text-zinc-500`}
          >
            <div>RANK</div>
            <div>TOOL</div>
            <div className="hidden text-right md:block">PILOTS</div>
            <div className="hidden text-right md:block">TIME</div>
            <div className="hidden text-right md:block">7D</div>
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
                    setTools(null)
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
                The machines await their first pilots.
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
          RANKED BY EVERY PILOT&apos;S COMBINED LIFETIME SCORE
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
    <div className={`px-4 py-4 ${divCls}`}>
      <div className="flex items-center gap-1.5 text-[9px] tracking-[0.35em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div
        className="mt-2.5 text-sm text-zinc-50 tabular-nums [font-family:var(--font-pixel)] md:text-base"
        style={valueStyle}
      >
        {children}
      </div>
      {hint && (
        <div className="mt-1 truncate text-[9px] tracking-[0.2em] text-zinc-600">{hint}</div>
      )}
    </div>
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[11px] [font-family:var(--font-pixel)]"
            style={{
              color: medal.fg,
              border: `1px solid ${medalA(medal.rgb, 0.5)}`,
              background: medalA(medal.rgb, 0.08),
              textShadow: `0 0 10px ${medalA(medal.rgb, 0.55)}`
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

      {/* SCORE — the main thing */}
      <div className="text-right">
        <div
          className="text-[13px] leading-none tabular-nums [font-family:var(--font-pixel)]"
          style={{
            color: 'rgb(var(--lb-score))',
            textShadow: medal
              ? '0 0 12px rgb(var(--lb-score) / 0.4)'
              : '0 0 10px rgb(var(--lb-score) / 0.22)'
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
      <div className={`${ROW_GRID} animate-pulse py-4`}>
        <span className="h-8 w-8 rounded-lg bg-white/[0.05]" />
        <span className="flex items-center gap-3">
          <span className="h-9 w-9 rounded-full bg-white/[0.05]" />
          <span className="h-3 w-28 rounded bg-white/[0.05]" />
        </span>
        <span className="hidden h-3 w-10 justify-self-end rounded bg-white/[0.04] md:block" />
        <span className="hidden h-3 w-12 justify-self-end rounded bg-white/[0.04] md:block" />
        <span className="hidden h-3 w-10 justify-self-end rounded bg-white/[0.04] md:block" />
        <span className="h-3.5 w-20 justify-self-end rounded bg-white/[0.06]" />
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
