'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  AdminTable,
  type AdminChipTone
} from '@/components/admin'
import { SegmentedControl, type SegmentedOption } from '@/components/settings/SegmentedControl'
import { Skeleton } from '@/components/settings/Skeleton'
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

type WindowValue = '30' | '90' | '180'

const WINDOW_SEGMENTS: readonly SegmentedOption<WindowValue>[] = [
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '180', label: '180d' }
]

const CHART_TOOL_LIMIT = 8

/** Line palette at Tailwind's 600 weight — the same mid-saturation level
 *  the chip kit uses, so every hue reads on both the dark #0a0a0b canvas
 *  and the light #ffffff one without a per-theme palette swap. */
const SERIES_COLORS = [
  '#ea580c', // orange-600
  '#0284c7', // sky-600
  '#7c3aed', // violet-600
  '#059669', // emerald-600
  '#d97706', // amber-600
  '#db2777', // pink-600
  '#0891b2', // cyan-600
  '#65a30d' // lime-600
]

function asCategory(value: string): ToolCategory {
  return (TOOL_CATEGORIES as readonly string[]).includes(value)
    ? (value as ToolCategory)
    : 'other'
}

/** Tool category → chip tone. Only the active-work categories carry a
 *  hue (color means state, and 9 taxonomy colors would be noise): chat
 *  reads informational, coding healthy-green, agent amber; media,
 *  writing and platform surfaces stay neutral. */
function categoryChipTone(value: string): AdminChipTone {
  const category = asCategory(value)
  switch (category) {
    case 'chat':
      return 'info'
    case 'coding':
      return 'good'
    case 'agent':
      return 'warn'
    case 'image':
    case 'video':
    case 'audio':
    case 'writing':
    case 'platform':
    case 'other':
      return 'neutral'
    default: {
      const exhaustive: never = category
      return exhaustive
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
                stroke="var(--st-border)"
                strokeWidth="1"
              />
              <text
                x={PAD_L - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill="var(--st-text-muted)"
              >
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
              stroke="var(--st-border-strong)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={release.x + 3}
              y={PAD_T - 10}
              fontSize="8"
              fill="var(--st-text-muted)"
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
            fill="var(--st-text-muted)"
          >
            {formatDay(data.dates[day])}
          </text>
        ))}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {lines.map((line) => (
          <span
            key={line.domain}
            className="inline-flex items-center gap-1.5 text-[12px] leading-4 text-[color:var(--st-text-muted)]"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: line.color }}
            />
            {line.domain}
            <span className="font-data text-[11px] tabular-nums text-[color:var(--st-text-faint)]">
              {line.windowSharePct.toFixed(1)}%
            </span>
          </span>
        ))}
      </div>

      {markers.length > 0 && (
        <ul className="space-y-1">
          {markers.map((release) => (
            <li
              key={`list-${release.vendor}-${release.product}-${release.releaseDate}`}
              className="text-[12px] leading-5 text-[color:var(--st-text-muted)]"
            >
              <span className="font-data text-[11px] text-[color:var(--st-text-faint)]">
                {release.releaseDate}
              </span>{' '}
              <span className="text-[color:var(--st-text)]">
                {release.vendor} {release.product}
              </span>
              {release.notes && (
                <span className="text-[color:var(--st-text-faint)]"> — {release.notes}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Chart-shaped placeholder so the panel doesn't jump when data lands. */
function ChartSkeleton() {
  return (
    <div aria-hidden className="space-y-3">
      <Skeleton className="h-56 w-full rounded-lg" />
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-3 w-24 rounded" />
        ))}
      </div>
    </div>
  )
}

function SessionDepthTable({ tools }: { tools: TrendsTool[] }) {
  return (
    <AdminTable
      columns={[
        { label: 'Tool' },
        { label: 'Category' },
        { label: 'Active', align: 'right' },
        { label: 'Sessions', align: 'right' },
        { label: 'Med session', align: 'right' },
        { label: 'Med focus', align: 'right' },
        { label: 'Peak users/d', align: 'right' }
      ]}
    >
      {tools.map((tool) => (
        <tr key={tool.domain}>
          <td>
            <span className="text-[color:var(--st-text)]">{tool.vendor}</span>{' '}
            <span className="text-[color:var(--st-text-muted)]">{tool.domain}</span>
          </td>
          <td>
            <AdminChip tone={categoryChipTone(tool.category)}>{tool.category}</AdminChip>
          </td>
          <td className="text-right tabular-nums text-[color:var(--st-text)]">
            {formatDurationMs(tool.activeMs)}
          </td>
          <td className="text-right tabular-nums text-[color:var(--st-text-muted)]">
            {tool.sessions.toLocaleString()}
          </td>
          <td className="text-right tabular-nums text-[color:var(--st-text-muted)]">
            {formatSessionLength(tool.medianSessionMs)}
          </td>
          <td className="text-right tabular-nums text-[color:var(--st-text-muted)]">
            {formatFocus(tool.medianFocusRatio)}
          </td>
          <td className="text-right tabular-nums text-[color:var(--st-text-muted)]">
            {tool.peakDailyUsers.toLocaleString()}
          </td>
        </tr>
      ))}
    </AdminTable>
  )
}

export default function AdminTrendsPage() {
  const [windowValue, setWindowValue] = useState<WindowValue>('90')
  const [data, setData] = useState<TrendsData | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    const load = async () => {
      try {
        const res = await fetch(`/api/admin/trends?days=${windowValue}`, {
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
  }, [windowValue, retryToken])

  const hasData =
    !!data &&
    data.dates.length > 0 &&
    data.totalActiveMs.some((ms) => ms > 0)

  const loadError = (
    <AdminNotice tone="danger">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>Failed to load trends.</span>
        <AdminButton variant="ghost" onClick={() => setRetryToken((token) => token + 1)}>
          Retry
        </AdminButton>
      </div>
    </AdminNotice>
  )

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Usage trends"
        description="Aggregate view of tool usage across all users who have not opted out. Built entirely from nightly rollups — no individual rows."
      />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          options={WINDOW_SEGMENTS}
          value={windowValue}
          onChange={setWindowValue}
          aria-label="Time window"
        />
        {data && (
          <span className="ml-auto font-data text-[11px] tabular-nums text-[color:var(--st-text-muted)]">
            {data.start} → {data.end}
          </span>
        )}
      </div>

      <AdminSection title="Share of active minutes">
        {loadState === 'loading' ? (
          <ChartSkeleton />
        ) : loadState === 'error' ? (
          loadError
        ) : !hasData ? (
          <AdminEmpty title="No aggregate data yet" hint="The rollup runs nightly." />
        ) : (
          <ShareChart data={data} />
        )}
      </AdminSection>

      <AdminSection title="Session depth" flush>
        {loadState === 'loading' ? (
          <AdminSkeletonList rows={5} />
        ) : loadState === 'error' ? (
          <div className="p-4">{loadError}</div>
        ) : !data || data.tools.length === 0 ? (
          <AdminEmpty title="No aggregate data yet" hint="The rollup runs nightly." />
        ) : (
          <SessionDepthTable tools={data.tools} />
        )}
      </AdminSection>

      <p className="text-[12px] leading-5 text-[color:var(--st-text-faint)]">
        Data comes exclusively from daily_tool_aggregates — per-user rows
        never leave the database. Session-depth medians are session-weighted
        medians of the daily medians. A public version of this view must
        enforce a minimum cohort of 50 distinct users per slice at read time.
      </p>
    </div>
  )
}
