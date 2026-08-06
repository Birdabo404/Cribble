'use client'

import { useEffect, useMemo, useState } from 'react'
import { AdminShell } from '@/components/admin/AdminShell'
import { TOOL_CATEGORIES, type ToolCategory } from '@/lib/toolTaxonomy'

// Aggregate usage trends, staff-only. Everything on this page comes from
// /api/admin/trends, which reads ONLY daily_tool_aggregates and
// model_releases — no per-user rows ever reach the browser. A future
// public version of this view must go through an endpoint that enforces
// the k >= 50 distinct-users cohort floor per slice at read time; this
// page must never simply be opened up.

interface TrendsSeries {
  domain: string
  vendor: string
  category: string
  activeMs: number[]
}

interface TrendsTool {
  domain: string
  vendor: string
  category: string
  activeMs: number
  sessions: number
  visits: number
  peakDailyUsers: number
  medianSessionMs: number | null
  medianFocusRatio: number | null
}

interface TrendsRelease {
  vendor: string
  product: string
  releaseDate: string
  notes: string | null
}

interface TrendsData {
  days: number
  start: string
  end: string
  dates: string[]
  totalActiveMs: number[]
  series: TrendsSeries[]
  tools: TrendsTool[]
  releases: TrendsRelease[]
}

const WINDOW_OPTIONS = [30, 90, 180] as const

const CHART_TOOL_LIMIT = 8

/** Line palette tuned for the black dossier canvas. */
const SERIES_COLORS = [
  '#f97316',
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#22d3ee',
  '#a3e635'
]

function asCategory(value: string): ToolCategory {
  return (TOOL_CATEGORIES as readonly string[]).includes(value)
    ? (value as ToolCategory)
    : 'other'
}

function categoryChipClass(value: string): string {
  const category = asCategory(value)
  switch (category) {
    case 'chat':
      return 'text-sky-300 border-sky-400/30'
    case 'coding':
      return 'text-emerald-300 border-emerald-400/30'
    case 'image':
      return 'text-fuchsia-300 border-fuchsia-400/30'
    case 'video':
      return 'text-rose-300 border-rose-400/30'
    case 'audio':
      return 'text-amber-300 border-amber-400/30'
    case 'writing':
      return 'text-violet-300 border-violet-400/30'
    case 'agent':
      return 'text-orange-300 border-orange-400/30'
    case 'platform':
      return 'text-cyan-300 border-cyan-400/30'
    case 'other':
      return 'text-zinc-400 border-zinc-500/30'
    default: {
      const exhaustive: never = category
      throw new Error(`Unhandled tool category: ${exhaustive}`)
    }
  }
}

function formatDurationMs(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  if (hours > 0) return `${hours.toLocaleString()}h ${minutes}m`
  return `${minutes}m`
}

function formatSessionLength(ms: number | null): string {
  if (ms === null) return '—'
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatFocus(ratio: number | null): string {
  if (ratio === null) return '—'
  return `${Math.round(ratio * 100)}%`
}

function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  })
}

// Chart geometry: fixed viewBox, responsive via width; text keeps its
// aspect because preserveAspectRatio stays default.
const W = 720
const H = 260
const PAD_L = 40
const PAD_R = 10
const PAD_T = 22
const PAD_B = 22
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

interface ChartLine {
  domain: string
  vendor: string
  color: string
  windowSharePct: number
  path: string
}

function buildChartLines(data: TrendsData): ChartLine[] {
  const dayCount = data.dates.length
  if (dayCount === 0) return []
  const windowTotal = data.totalActiveMs.reduce((sum, ms) => sum + ms, 0)

  const shown = data.series.slice(0, CHART_TOOL_LIMIT)
  const shares = shown.map((tool) =>
    tool.activeMs.map((ms, day) => {
      const total = data.totalActiveMs[day] || 0
      return total > 0 ? (ms / total) * 100 : 0
    })
  )
  const maxShare = Math.max(10, ...shares.flat())
  const yMax = Math.min(100, Math.ceil(maxShare / 10) * 10)

  const xFor = (day: number) =>
    dayCount === 1
      ? PAD_L + PLOT_W / 2
      : PAD_L + (day / (dayCount - 1)) * PLOT_W
  const yFor = (share: number) =>
    PAD_T + PLOT_H - (Math.min(share, yMax) / yMax) * PLOT_H

  return shown.map((tool, idx) => {
    const points = shares[idx]
    const path = points
      .map((share, day) =>
        `${day === 0 ? 'M' : 'L'}${xFor(day).toFixed(2)},${yFor(share).toFixed(2)}`
      )
      .join(' ')
    const toolWindowMs = tool.activeMs.reduce((sum, ms) => sum + ms, 0)
    return {
      domain: tool.domain,
      vendor: tool.vendor,
      color: SERIES_COLORS[idx % SERIES_COLORS.length],
      windowSharePct: windowTotal > 0 ? (toolWindowMs / windowTotal) * 100 : 0,
      path
    }
  })
}

function ShareChart({ data }: { data: TrendsData }) {
  const lines = useMemo(() => buildChartLines(data), [data])
  const dayCount = data.dates.length

  const shares = data.series.slice(0, CHART_TOOL_LIMIT).flatMap((tool) =>
    tool.activeMs.map((ms, day) => {
      const total = data.totalActiveMs[day] || 0
      return total > 0 ? (ms / total) * 100 : 0
    })
  )
  const yMax = Math.min(100, Math.ceil(Math.max(10, ...shares) / 10) * 10)

  const xFor = (day: number) =>
    dayCount === 1
      ? PAD_L + PLOT_W / 2
      : PAD_L + (day / (dayCount - 1)) * PLOT_W

  const gridShares = [0, yMax / 2, yMax]
  const labelDays = dayCount > 1 ? [0, Math.floor((dayCount - 1) / 2), dayCount - 1] : [0]

  const markers = data.releases.flatMap((release) => {
    const day = data.dates.indexOf(release.releaseDate)
    if (day === -1) return []
    return [{ ...release, x: xFor(day) }]
  })

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Share of active minutes per tool over time">
        {gridShares.map((share) => {
          const y = PAD_T + PLOT_H - (share / yMax) * PLOT_H
          return (
            <g key={share}>
              <line
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
              />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#52525b">
                {Math.round(share)}%
              </text>
            </g>
          )
        })}

        {markers.map((release) => (
          <g key={`${release.vendor}-${release.product}-${release.releaseDate}`}>
            <line
              x1={release.x}
              y1={PAD_T - 8}
              x2={release.x}
              y2={PAD_T + PLOT_H}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={release.x + 3}
              y={PAD_T - 10}
              fontSize="8"
              fill="#a1a1aa"
              transform={`rotate(-90 ${release.x + 3} ${PAD_T - 10})`}
              textAnchor="end"
            >
              {release.vendor} {release.product}
            </text>
            <title>
              {`${release.releaseDate} — ${release.vendor} ${release.product}${release.notes ? `: ${release.notes}` : ''}`}
            </title>
          </g>
        ))}

        {lines.map((line) => (
          <path
            key={line.domain}
            d={line.path}
            fill="none"
            stroke={line.color}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {labelDays.map((day) => (
          <text
            key={day}
            x={xFor(day)}
            y={H - 6}
            textAnchor={day === 0 ? 'start' : day === dayCount - 1 ? 'end' : 'middle'}
            fontSize="9"
            fill="#52525b"
          >
            {formatDay(data.dates[day])}
          </text>
        ))}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {lines.map((line) => (
          <span key={line.domain} className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: line.color }}
            />
            {line.domain}
            <span className="text-zinc-600">{line.windowSharePct.toFixed(1)}%</span>
          </span>
        ))}
      </div>

      {markers.length > 0 && (
        <ul className="space-y-1">
          {markers.map((release) => (
            <li
              key={`list-${release.vendor}-${release.product}-${release.releaseDate}`}
              className="text-[10px] text-zinc-500"
            >
              <span className="text-zinc-600">{release.releaseDate}</span>{' '}
              <span className="text-zinc-300">
                {release.vendor} {release.product}
              </span>
              {release.notes && <span className="text-zinc-600"> — {release.notes}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SessionDepthTable({ tools }: { tools: TrendsTool[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[9px] tracking-[0.2em] text-zinc-600">
            <th className="py-2 pr-3 font-normal">TOOL</th>
            <th className="py-2 pr-3 font-normal">CATEGORY</th>
            <th className="py-2 pr-3 font-normal text-right">ACTIVE</th>
            <th className="py-2 pr-3 font-normal text-right">SESSIONS</th>
            <th className="py-2 pr-3 font-normal text-right">MED SESSION</th>
            <th className="py-2 pr-3 font-normal text-right">MED FOCUS</th>
            <th className="py-2 font-normal text-right">PEAK USERS/D</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {tools.map((tool) => (
            <tr key={tool.domain}>
              <td className="py-2 pr-3">
                <span className="text-zinc-100">{tool.vendor}</span>{' '}
                <span className="text-zinc-500">{tool.domain}</span>
              </td>
              <td className="py-2 pr-3">
                <span
                  className={`rounded border px-1.5 py-0.5 text-[9px] tracking-[0.15em] uppercase ${categoryChipClass(tool.category)}`}
                >
                  {tool.category}
                </span>
              </td>
              <td className="py-2 pr-3 text-right text-zinc-200">
                {formatDurationMs(tool.activeMs)}
              </td>
              <td className="py-2 pr-3 text-right text-zinc-400">
                {tool.sessions.toLocaleString()}
              </td>
              <td className="py-2 pr-3 text-right text-zinc-400">
                {formatSessionLength(tool.medianSessionMs)}
              </td>
              <td className="py-2 pr-3 text-right text-zinc-400">
                {formatFocus(tool.medianFocusRatio)}
              </td>
              <td className="py-2 text-right text-zinc-400">
                {tool.peakDailyUsers.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TrendsPanel() {
  const [days, setDays] = useState<number>(90)
  const [data, setData] = useState<TrendsData | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    const load = async () => {
      try {
        const res = await fetch(`/api/admin/trends?days=${days}`, {
          credentials: 'include',
          cache: 'no-store'
        })
        const body = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !body?.success) {
          setLoadState('error')
          return
        }
        setData(body as TrendsData)
        setLoadState('ready')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [days])

  const hasData =
    !!data &&
    data.dates.length > 0 &&
    data.totalActiveMs.some((ms) => ms > 0)

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Usage trends</h1>
        <p className="text-sm text-gray-400">
          Aggregate view of tool usage across all users who have not opted
          out. Built entirely from nightly rollups — no individual rows.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {WINDOW_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => setDays(option)}
            className={`rounded border px-3 py-1 text-[10px] tracking-[0.2em] transition-colors ${
              days === option
                ? 'border-accent/50 text-zinc-100'
                : 'border-white/10 text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {option}D
          </button>
        ))}
        {data && (
          <span className="ml-auto text-[10px] tracking-[0.2em] text-zinc-600">
            {data.start} → {data.end}
          </span>
        )}
      </div>

      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
        <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">
          SHARE_OF_ACTIVE_MINUTES
        </h2>
        {loadState === 'loading' ? (
          <p className="text-xs text-zinc-600">Loading…</p>
        ) : loadState === 'error' ? (
          <p className="text-xs text-red-400">Failed to load trends.</p>
        ) : !hasData ? (
          <p className="text-xs text-zinc-600">
            NO AGGREGATE DATA YET — rollup runs nightly.
          </p>
        ) : (
          <ShareChart data={data} />
        )}
      </section>

      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
        <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">SESSION_DEPTH</h2>
        {loadState === 'loading' ? (
          <p className="text-xs text-zinc-600">Loading…</p>
        ) : loadState === 'error' ? (
          <p className="text-xs text-red-400">Failed to load trends.</p>
        ) : !data || data.tools.length === 0 ? (
          <p className="text-xs text-zinc-600">
            NO AGGREGATE DATA YET — rollup runs nightly.
          </p>
        ) : (
          <SessionDepthTable tools={data.tools} />
        )}
      </section>

      <p className="text-[10px] leading-relaxed text-zinc-600">
        Data comes exclusively from daily_tool_aggregates — per-user rows
        never leave the database. Session-depth medians are session-weighted
        medians of the daily medians. A public version of this view must
        enforce a minimum cohort of 50 distinct users per slice at read time.
      </p>
    </>
  )
}

export default function AdminTrendsPage() {
  return <AdminShell section="TRENDS">{() => <TrendsPanel />}</AdminShell>
}
