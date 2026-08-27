'use client'

import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { useTheme } from 'next-themes'
import { formatCompact, formatRelative } from '@/components/dashboard-v2/format'
import { DashboardTabs } from '@/components/dashboard-v3/DashboardTabs'
import { useSettingsModal } from '@/components/settings/SettingsModalContext'
import { Area } from '@/components/dither-kit/area'
import { AreaChart } from '@/components/dither-kit/area-chart'
import type { ChartConfig, Margins } from '@/components/dither-kit/chart-context'
import { BAYER, CELL } from '@/components/dither-kit/dither-paint'
import { setDitherTheme } from '@/components/dither-kit/palette'
import { Tooltip } from '@/components/dither-kit/tooltip'
import {
  compareExactIntegers,
  exactDecimal,
  formatExactInteger
} from '@/lib/tokenLeaderboard'
import { addCalendarDays, calendarDateInTimeZone } from '@/lib/timeZone'
import type {
  TokenUsageBreakdown,
  TokenUsageBreakdownItem,
  TokenUsageClientSummary,
  TokenUsageResponse,
  TokenUsageTotals,
  TokenUsageTrendPoint
} from '@/lib/userTokenUsage'

const RANGE_OPTIONS = [
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
  { days: 366, label: '366D' }
] as const

type RangeDays = (typeof RANGE_OPTIONS)[number]['days']
type ViewState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: TokenUsageResponse }

// Token identity color — TokenBoard's orange burn, fixed across themes.
const ORANGE = 'rgb(251 146 60)'
const orangeA = (alpha: number) => `rgb(251 146 60 / ${alpha})`
const ORANGE_TILE_HEX = '#fb923c'
const ORANGE_GLOW = '0 0 12px rgb(249 115 22 / 0.35)'
const BANNER_GLOW = '0 0 10px rgb(249 115 22 / 0.35), 0 0 28px rgb(249 115 22 / 0.14)'
// Signal lime — exclusively the $ glyph in USD figures (TokenBoard convention).
const LIME = '#39ff88'

// "TOKEN USAGE" in ANSI Shadow, matching the DASHBOARD/BAG/SHOP wordmarks.
// All six rows are exactly 107 characters so the glyphs stay column-aligned.
const ASCII_TOKEN_USAGE = String.raw`████████╗   ██████╗   ██╗  ██╗  ███████╗  ███╗   ██╗     ██╗   ██╗  ███████╗   █████╗    ██████╗   ███████╗
╚══██╔══╝  ██╔═══██╗  ██║ ██╔╝  ██╔════╝  ████╗  ██║     ██║   ██║  ██╔════╝  ██╔══██╗  ██╔════╝   ██╔════╝
   ██║     ██║   ██║  █████╔╝   █████╗    ██╔██╗ ██║     ██║   ██║  ███████╗  ███████║  ██║  ███╗  █████╗  
   ██║     ██║   ██║  ██╔═██╗   ██╔══╝    ██║╚██╗██║     ██║   ██║  ╚════██║  ██╔══██║  ██║   ██║  ██╔══╝  
   ██║     ╚██████╔╝  ██║  ██╗  ███████╗  ██║ ╚████║     ╚██████╔╝  ███████║  ██║  ██║  ╚██████╔╝  ███████╗
   ╚═╝      ╚═════╝   ╚═╝  ╚═╝  ╚══════╝  ╚═╝  ╚═══╝      ╚═════╝   ╚══════╝  ╚═╝  ╚═╝   ╚═════╝   ╚══════╝`

// Single orange series; module-level so identities stay stable across renders.
const TREND_CONFIG: ChartConfig = { tokens: { label: 'TOKENS', color: 'orange' } }
const TREND_MARGINS: Partial<Margins> = { top: 18, right: 0, bottom: 0, left: 0 }
const formatTrendTokens = (value: number) => formatCompact(Math.round(value))

function formatExactUsdDigits(value: string): string {
  const [whole, fraction = ''] = exactDecimal(value).split('.')
  const grouped = formatExactInteger(whole)
  return fraction ? `${grouped}.${fraction}` : grouped
}

function Usd({ value }: { value: string }) {
  return (
    <>
      <span style={{ color: LIME }}>$</span>
      {formatExactUsdDigits(value)}
    </>
  )
}

function readableDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

/**
 * One 4×4 ordered-dither pass as a data-URI SVG tile (the ActivityCard
 * technique): a pixel lights where density clears the Bayer threshold.
 * Tiled at CELL css px per dither pixel and rendered `pixelated`.
 */
function bayerTile(hex: string, density: number): string {
  const pixels: string[] = []
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (density > BAYER[y][x]) {
        pixels.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${hex}"/>`)
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" shape-rendering="crispEdges">${pixels.join('')}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function Icon({
  name,
  className = 'h-4 w-4'
}: {
  name: 'calendar' | 'clients' | 'coins' | 'refresh' | 'spark' | 'tower'
  className?: string
}) {
  const paths = {
    calendar: 'M6 2v4m12-4v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z',
    clients: 'M4 5h16v11H4zM8 20h8m-4-4v4',
    coins: 'M12 6c4.42 0 8-1.12 8-2.5S16.42 1 12 1 4 2.12 4 3.5 7.58 6 12 6Zm-8-2.5V8c0 1.38 3.58 2.5 8 2.5S20 9.38 20 8V3.5M4 8v4.5c0 1.38 3.58 2.5 8 2.5s8-1.12 8-2.5V8M4 12.5V17c0 1.38 3.58 2.5 8 2.5s8-1.12 8-2.5v-4.5',
    refresh: 'M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7',
    spark: 'm12 2 1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2Z',
    tower: 'M12 21V9M8.5 21 12 9l3.5 12M8.5 6.5a5 5 0 0 1 7 0M5.5 3.8a9.2 9.2 0 0 1 13 0'
  } as const
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  )
}

function TokenBanner() {
  // Date stamp set post-mount: SSR renders with the server's locale/timezone,
  // which can differ from the client's and break hydration.
  const [stamp, setStamp] = useState('')
  useEffect(() => {
    setStamp(
      new Date()
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        .toUpperCase()
    )
  }, [])

  return (
    <section className="tu-banner mt-10 flex flex-col items-center gap-2">
      <div className="w-full overflow-x-auto py-1">
        <pre
          aria-label="TOKEN USAGE"
          className="mx-auto whitespace-pre text-center font-mono leading-[1]"
          style={{
            fontSize: 'clamp(4px, 0.72vw, 9px)',
            color: ORANGE,
            textShadow: BANNER_GLOW,
            letterSpacing: 0
          }}
        >
          {ASCII_TOKEN_USAGE}
        </pre>
      </div>
      {/* The leading slashes are the one accent-green echo on this page. */}
      <p className="text-center font-data text-[11px] tracking-[0.22em] text-zinc-400">
        <span className="text-accent/80">{'// '}</span>
        PRIVATE TELEMETRY
        <span className="mx-2 text-zinc-700" aria-hidden>·····</span>
        EXACT TOTALS
        <span className="hidden sm:inline">
          <span className="mx-2 text-zinc-700" aria-hidden>·····</span>
          {stamp}
        </span>
      </p>
    </section>
  )
}

function Panel({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`relative overflow-hidden rounded-2xl liquid-glass ${className}`}>
      {children}
    </section>
  )
}

function PanelTitle({
  title,
  subtitle,
  icon,
  action
}: {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 font-display text-[11px] font-medium tracking-[0.4em] text-zinc-200">
          {icon && <span className="text-ice/70">{icon}</span>}
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1.5 font-data text-xs leading-5 text-zinc-400">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  )
}

const SYNC_TONES = {
  emerald: {
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
    ping: 'bg-emerald-400/60',
    hex: '#34d399'
  },
  amber: { text: 'text-amber-300', dot: 'bg-amber-400', ping: 'bg-amber-400/60', hex: '#fbbf24' },
  zinc: { text: 'text-zinc-400', dot: 'bg-zinc-500', ping: 'bg-zinc-500/60', hex: '#a1a1aa' },
  rose: { text: 'text-rose-300', dot: 'bg-rose-400', ping: 'bg-rose-400/60', hex: '#fb7185' }
} as const

interface SyncReading {
  word: string
  tone: keyof typeof SYNC_TONES
  /** Lit bars on the 5-bar signal meter. */
  litBars: number
  /** Fresh link — the only state that earns the LED ping. */
  live: boolean
  guidance: string
}

function readSyncState(data: TokenUsageResponse): SyncReading {
  const keyStatus = data.keys.status
  switch (keyStatus) {
    case 'none':
      return {
        word: 'NO KEY',
        tone: 'amber',
        litBars: 0,
        live: false,
        guidance:
          'Create a private Agent key before this dashboard can receive token usage.'
      }
    case 'all-revoked':
      return {
        word: 'REVOKED',
        tone: 'rose',
        litBars: 0,
        live: false,
        guidance: 'New syncs require an active key. Historical usage stays visible.'
      }
    case 'expired':
    case 'inactive':
      return {
        word: 'NO KEY',
        tone: 'amber',
        litBars: 0,
        live: false,
        guidance: 'Create an active Agent key to receive another sync.'
      }
    case 'active':
      break
    default: {
      const exhaustive: never = keyStatus
      return exhaustive
    }
  }
  const freshness = data.sync.freshness
  switch (freshness) {
    case 'stale':
      return {
        word: 'STALE',
        tone: 'amber',
        litBars: 2,
        live: false,
        guidance:
          'The newest sync is outside the freshness window; background tracking is unverified.'
      }
    case 'never':
      return {
        word: 'WAITING',
        tone: 'zinc',
        litBars: 1,
        live: false,
        guidance: 'An Agent key exists, but no successful usage sync has been received yet.'
      }
    case 'healthy':
      return {
        word: 'LINKED',
        tone: 'emerald',
        litBars: 5,
        live: true,
        guidance: 'Sync received within the window — confirms receipt only, not live tracking.'
      }
    default: {
      const exhaustive: never = freshness
      return exhaustive
    }
  }
}

const METER_HEIGHTS = [6, 9, 12, 15, 18] as const

function SyncLinkPanel({ data }: { data: TokenUsageResponse }) {
  const reading = readSyncState(data)
  const tone = SYNC_TONES[reading.tone]
  const litTile = bayerTile(tone.hex, 0.85)
  const dimTile = bayerTile('#71717a', 0.18)
  return (
    <Panel className="col-span-12 p-5 sm:p-6 lg:col-span-4">
      <PanelTitle title="SYNC LINK" icon={<Icon name="tower" className="h-3 w-3" />} />

      <div className="mt-5 flex items-end justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-1.5 w-1.5">
            {reading.live && (
              <span
                className={`absolute inline-flex h-full w-full rounded-full motion-safe:animate-ping [animation-duration:2.4s] ${tone.ping}`}
              />
            )}
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          </span>
          <span
            className={`text-base leading-none [font-family:var(--font-pixel)] ${tone.text}`}
          >
            {reading.word}
          </span>
        </div>
        <div className="flex items-end gap-1" aria-hidden>
          {METER_HEIGHTS.map((height, index) => (
            <span
              key={height}
              className="w-2.5 rounded-[1px] bg-zinc-900"
              style={{
                height,
                backgroundImage: index < reading.litBars ? litTile : dimTile,
                backgroundSize: `${4 * CELL}px ${4 * CELL}px`,
                imageRendering: 'pixelated'
              }}
            />
          ))}
        </div>
      </div>

      <dl className="mt-5 space-y-2 font-data text-[10px] tracking-[0.22em] text-zinc-400">
        <div className="flex items-baseline justify-between gap-3">
          <dt>LAST SYNC</dt>
          <dd className="text-zinc-200">{formatRelative(data.sync.lastSyncedAt)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt>WINDOW</dt>
          <dd className="text-zinc-200">{data.sync.staleAfterHours}H</dd>
        </div>
      </dl>

      <p className="mt-4 text-xs leading-5 text-zinc-400">{reading.guidance}</p>
    </Panel>
  )
}

function MetricCell({
  label,
  hint,
  icon,
  className = '',
  children
}: {
  label: string
  hint: React.ReactNode
  icon: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex min-w-0 flex-col items-center px-3 py-5 text-center sm:px-4 ${className}`}>
      <div className="flex items-center justify-center gap-2 font-data text-[10px] tracking-[0.3em] text-zinc-400">
        <span className="text-ice/70">{icon}</span>
        {label}
      </div>
      {/* Fixed-height slot so all four values share one optical baseline. */}
      <div className="mt-2.5 flex h-10 items-center justify-center">{children}</div>
      <div className="mt-1.5 font-data text-[11px] leading-4 text-zinc-400">{hint}</div>
    </div>
  )
}

// Bar segments and legend share one density ramp: heavier dither = rawer
// token category. Shares come from Number() (display-only approximation);
// every printed value stays on the exact decimal-string helpers.
const COMPOSITION_SEGMENTS = [
  { key: 'inputTokens', label: 'INPUT', density: 1 },
  { key: 'outputTokens', label: 'OUTPUT', density: 0.7 },
  { key: 'cacheCreationTokens', label: 'CACHE CREATE', density: 0.45 },
  { key: 'cacheReadTokens', label: 'CACHE READ', density: 0.25 }
] as const

function CompositionPanel({ totals }: { totals: TokenUsageTotals }) {
  const parts = COMPOSITION_SEGMENTS.map((segment) => ({
    ...segment,
    amount: Number(totals[segment.key])
  }))
  const total = parts.reduce((sum, part) => sum + part.amount, 0)
  return (
    <Panel className="col-span-12 p-5 sm:p-6 lg:col-span-4">
      <PanelTitle
        title="COMPOSITION"
        subtitle="Category share of the total · bar is approximate, values stay exact"
        icon={<Icon name="coins" className="h-3 w-3" />}
      />

      <div className="mt-5 flex h-2.5 overflow-hidden rounded-[2px] bg-zinc-900" aria-hidden>
        {total > 0 &&
          parts.map((part) => (
            <div
              key={part.label}
              style={{
                width: `${(part.amount / total) * 100}%`,
                backgroundImage: bayerTile(ORANGE_TILE_HEX, part.density),
                backgroundSize: `${4 * CELL}px ${4 * CELL}px`,
                imageRendering: 'pixelated'
              }}
            />
          ))}
      </div>

      <ul className="mt-4 space-y-2.5">
        {parts.map((part) => (
          <li key={part.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-data text-[10px] tracking-[0.2em] text-zinc-400">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-[1px] bg-zinc-900"
                style={{
                  backgroundImage: bayerTile(ORANGE_TILE_HEX, part.density),
                  backgroundSize: `${4 * CELL}px ${4 * CELL}px`,
                  imageRendering: 'pixelated'
                }}
              />
              {part.label}
            </span>
            <span className="text-right font-data text-xs tabular-nums text-zinc-200">
              {formatExactInteger(totals[part.key])}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function DailyTrend({ points }: { points: TokenUsageTrendPoint[] }) {
  const { resolvedTheme } = useTheme()
  // Client-only mount (page is behind auth) — resolvedTheme is only undefined
  // for the first frames; default dark, the app's base theme.
  const theme = resolvedTheme === 'light' ? 'light' : 'dark'
  // Swap the kit's palette seeds before the chart subtree renders; key={theme}
  // below remounts the chart so its paint loop re-reads them.
  setDitherTheme(theme)

  const peak = useMemo(
    () =>
      points.reduce(
        (current, point) =>
          compareExactIntegers(point.totalTokens, current) > 0 ? point.totalTokens : current,
        '0'
      ),
    [points]
  )
  // Plot data only — Number() is a display approximation (safe below 2^53);
  // every visible readout stays on the exact decimal-string helpers.
  const chartData = useMemo(
    () =>
      points.map((point) => ({
        label: readableDate(point.date),
        tokens: Number(point.totalTokens)
      })),
    [points]
  )
  const middle = points[Math.floor((points.length - 1) / 2)]

  return (
    <Panel className="col-span-12 p-5 sm:p-6 lg:col-span-8">
      <PanelTitle
        title="DAILY TOKEN TREND"
        subtitle="Zero-filled source days · plot is approximate, readouts stay exact"
        icon={<Icon name="spark" className="h-3 w-3" />}
      />

      <div className="relative mt-5 h-56 w-full">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgb(var(--star-rgb) / 0.09) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--star-rgb) / 0.09) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
            backgroundPosition: 'center bottom',
            WebkitMaskImage:
              'radial-gradient(130% 105% at 50% 100%, black 30%, transparent 98%)',
            maskImage:
              'radial-gradient(130% 105% at 50% 100%, black 30%, transparent 98%)'
          }}
        />

        {/* Interactive dither area — must NOT be pointer-events-none; the
            kit's scrub crosshair and tooltip live inside it. */}
        <div
          role="img"
          aria-label="Daily total tokens over the selected source-day range"
          className="absolute inset-0"
        >
          <AreaChart
            key={theme}
            data={chartData}
            config={TREND_CONFIG}
            bloom="aura"
            margins={TREND_MARGINS}
            className="cursor-crosshair touch-pan-y"
          >
            <Area dataKey="tokens" variant="gradient" />
            <Tooltip labelKey="label" valueFormatter={formatTrendTokens} />
          </AreaChart>
        </div>

        {/* corner readouts — pointer-events-none so scrubbing never snags */}
        <span className="pointer-events-none absolute right-4 top-1.5 text-right font-data text-[10px] tracking-[0.3em] text-zinc-400">
          EXACT PEAK{' '}
          <span className="tabular-nums text-orange-300">{formatExactInteger(peak)}</span>
        </span>
        <span className="pointer-events-none absolute bottom-2 left-4 font-data text-[10px] tracking-[0.3em] text-zinc-500">
          {points[0] ? readableDate(points[0].date) : '—'}
        </span>
        <span className="pointer-events-none absolute bottom-2 left-1/2 hidden -translate-x-1/2 font-data text-[10px] tracking-[0.3em] text-zinc-500 sm:block">
          {middle ? readableDate(middle.date) : '—'}
        </span>
        <span className="pointer-events-none absolute bottom-2 right-4 font-data text-[10px] tracking-[0.3em] text-zinc-500">
          {points.at(-1) ? readableDate(points.at(-1)!.date) : '—'}
        </span>
      </div>
    </Panel>
  )
}

function BreakdownPanel({
  kind,
  breakdown,
  activeDays,
  primaryEligibleDays = 0
}: {
  kind: 'agents' | 'models'
  breakdown: TokenUsageBreakdown
  activeDays: number
  primaryEligibleDays?: number
}) {
  const shown = breakdown.items.slice(0, 8)
  return (
    <Panel className="col-span-12 p-5 sm:p-6 lg:col-span-6">
      <PanelTitle
        title={kind === 'agents' ? 'REPORTED AGENTS' : 'REPORTED MODELS'}
        subtitle="Presence on active source days · not token share"
        action={
          !breakdown.complete ? (
            <span className="rounded border border-amber-400/25 bg-amber-400/[0.06] px-2 py-1 font-data text-[9px] tracking-[0.2em] text-amber-300">
              PARTIAL
            </span>
          ) : undefined
        }
      />

      {shown.length > 0 ? (
        <ol className="mt-5 space-y-4">
          {shown.map((item) => (
            <BreakdownRow
              key={item.name}
              item={item}
              activeDays={activeDays}
              showPrimary={kind === 'models'}
            />
          ))}
        </ol>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center font-data text-[11px] leading-5 text-zinc-500">
          NO {kind.toUpperCase()} WERE REPORTED IN THIS RANGE
        </div>
      )}

      <p className="mt-5 border-t border-white/[0.07] pt-4 font-data text-[10px] leading-5 text-zinc-500">
        {kind === 'models'
          ? `PRIMARY-MODEL DAYS USE THE FIRST ORDERED MODEL FROM AGENT V1.2+ DATA (${primaryEligibleDays} ELIGIBLE ACTIVE DAYS).`
          : 'AN AGENT COUNTS ONCE PER ACTIVE SOURCE DAY WHEN IT APPEARS IN ANY CLIENT REPORT.'}
        {!breakdown.complete ? ' SOME DAILY REPORTS HAD NO BREAKDOWN.' : ''}
        {breakdown.truncated ? ` ${breakdown.omittedItems} ADDITIONAL LABELS OMITTED.` : ''}
      </p>
    </Panel>
  )
}

function BreakdownRow({
  item,
  activeDays,
  showPrimary
}: {
  item: TokenUsageBreakdownItem
  activeDays: number
  showPrimary: boolean
}) {
  const share = activeDays > 0 ? item.reportedActiveDays / activeDays : 0
  const width = activeDays > 0 ? Math.max(2, share * 100) : 0
  const barStyle = useMemo(
    (): CSSProperties => ({
      width: `${Math.min(100, width)}%`,
      backgroundColor: orangeA(0.15),
      backgroundImage: bayerTile(ORANGE_TILE_HEX, Math.min(1, Math.max(0.25, share))),
      backgroundSize: `${4 * CELL}px ${4 * CELL}px`,
      imageRendering: 'pixelated'
    }),
    [share, width]
  )
  return (
    <li>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] text-zinc-100" title={item.name}>
          {item.name}
        </span>
        <span className="shrink-0 text-right font-data text-[10px] leading-4 tabular-nums text-zinc-400">
          reported on {item.reportedActiveDays} active {item.reportedActiveDays === 1 ? 'day' : 'days'}
          {showPrimary && (item.primaryModelDays ?? 0) > 0 && (
            <span className="block text-ice/70">
              primary model on {item.primaryModelDays} {item.primaryModelDays === 1 ? 'day' : 'days'}
            </span>
          )}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-[2px] bg-zinc-900">
        <div className="h-full" style={barStyle} />
      </div>
    </li>
  )
}

function ClientsPanel({
  clients,
  totalCount
}: {
  clients: TokenUsageClientSummary[]
  totalCount: number
}) {
  return (
    <Panel className="col-span-12">
      <div className="border-b border-white/[0.07] p-5 sm:p-6">
        <PanelTitle
          title="CLIENT SUMMARIES"
          subtitle="Anonymous window totals · raw client IDs and machine names are not exposed"
          icon={<Icon name="clients" className="h-3 w-3" />}
        />
      </div>
      {clients.length > 0 ? (
        <div className="divide-y divide-white/[0.06]">
          {clients.map((client) => (
            <div
              key={client.label}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:px-6"
            >
              <div>
                <div className="text-[13px] text-zinc-100">{client.label}</div>
                <div className="mt-1 font-data text-[10px] tracking-[0.15em] text-zinc-500">
                  {client.activeDays} ACTIVE {client.activeDays === 1 ? 'DAY' : 'DAYS'}
                </div>
              </div>
              <div className="text-right">
                <div className="font-data text-[9px] tracking-[0.18em] text-zinc-500 sm:hidden">
                  TOKENS
                </div>
                <div className="break-all font-data text-xs tabular-nums text-orange-300">
                  {formatExactInteger(client.totalTokens)}
                </div>
              </div>
              <div className="hidden break-all text-right font-data text-xs tabular-nums text-zinc-300 sm:block">
                <Usd value={client.storedCostUsd} /> stored
              </div>
              <div className="col-span-2 font-data text-[10px] text-zinc-500 sm:col-span-1 sm:text-right">
                received {formatRelative(client.lastSyncedAt)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-5 py-10 text-center font-data text-[11px] tracking-[0.18em] text-zinc-500">
          NO CLIENTS REPORTED IN THIS RANGE
        </div>
      )}
      {totalCount > clients.length && (
        <div className="border-t border-white/[0.07] px-5 py-3 font-data text-[10px] text-zinc-500 sm:px-6">
          {totalCount - clients.length} additional client summaries omitted.
        </div>
      )}
    </Panel>
  )
}

function EmptyUsage({ data }: { data: TokenUsageResponse }) {
  const { openSettings } = useSettingsModal()
  const noKey = data.keys.status === 'none'
  const noUsageAnywhere = data.availableBounds === null
  return (
    <Panel className="col-span-12 px-6 py-10 text-center sm:px-10 lg:col-span-8">
      <div
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border bg-white/[0.025]"
        style={{ borderColor: orangeA(0.25), color: ORANGE }}
      >
        <Icon name="coins" className="h-5 w-5" />
      </div>
      <h2 className="mt-5 font-display text-sm font-semibold tracking-[0.28em] text-zinc-200">
        {noKey
          ? 'CREATE AN AGENT KEY'
          : noUsageAnywhere
            ? 'KEY READY · NO USAGE YET'
            : 'NO USAGE IN THIS RANGE'}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-xs leading-5 text-zinc-400">
        {noKey
          ? 'Create a key in Account Settings, configure Cribble Agent, then send your first usage snapshot.'
          : noUsageAnywhere
            ? 'The server has not received a successful token-usage sync for this account yet.'
            : `Usage is available from ${readableDate(data.availableBounds!.from)} to ${readableDate(data.availableBounds!.to)}. Choose a wider source-day range.`}
      </p>
      {noKey && (
        <button
          type="button"
          onClick={() => openSettings('account')}
          className="mt-6 inline-flex items-center rounded-lg border border-accent/30 bg-accent/[0.06] px-4 py-2.5 font-data text-[11px] tracking-[0.22em] text-accent transition-colors hover:bg-accent/[0.1]"
        >
          OPEN AGENT SETTINGS
        </button>
      )}
    </Panel>
  )
}

function LoadingState() {
  // Mirrors the ready grid (4+8 row, then 8+4 row) so load → ready
  // doesn't reflow; the real control bar already renders above.
  return (
    <div
      className="col-span-12 grid grid-cols-12 gap-5"
      aria-label="Loading private token usage"
    >
      <div className="col-span-12 h-48 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-950/70 lg:col-span-4" />
      <div className="col-span-12 h-48 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-950/70 lg:col-span-8" />
      <div className="col-span-12 h-72 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-950/70 lg:col-span-8" />
      <div className="col-span-12 h-72 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-950/70 lg:col-span-4" />
    </div>
  )
}

function FailureState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <Panel className="col-span-12 px-6 py-10 text-center">
      <div className="font-display text-sm tracking-[0.28em] text-zinc-200">
        TOKEN USAGE UNAVAILABLE
      </div>
      <p className="mx-auto mt-3 max-w-md text-xs leading-5 text-zinc-400">
        {message} No historical failed-ingest diagnostics are available because failed attempts are
        not persisted.
      </p>
      <button
        type="button"
        onClick={retry}
        className="liquid-glass-inset mt-6 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 font-data text-[11px] tracking-[0.22em] text-zinc-300 transition-colors hover:text-zinc-50"
      >
        <Icon name="refresh" className="h-3.5 w-3.5" />
        RETRY
      </button>
    </Panel>
  )
}

export function TokenUsageDashboard() {
  const router = useRouter()
  const requestSequence = useRef(0)
  const [rangeDays, setRangeDays] = useState<RangeDays>(30)
  const [timezone, setTimezone] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ phase: 'loading' })
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  }, [])

  const load = useCallback(async () => {
    if (!timezone) return
    const sequence = ++requestSequence.current
    // Never leave a previous range labelled as the newly selected range
    // while its request is in flight.
    setState({ phase: 'loading' })
    try {
      const to = calendarDateInTimeZone(Date.now(), timezone)
      const from = addCalendarDays(to, -(rangeDays - 1))
      const query = new URLSearchParams({ from, to, timezone })
      const response = await fetch(`/api/user/token-usage?${query}`, {
        credentials: 'include',
        cache: 'no-store'
      })
      if (response.status === 401) {
        router.replace('/login?next=/dashboard/tokens')
        return
      }
      const body = (await response.json().catch(() => null)) as
        | TokenUsageResponse
        | { success?: false; error?: string }
        | null
      if (sequence !== requestSequence.current) return
      if (!response.ok || !body || body.success !== true) {
        setState({
          phase: 'error',
          message:
            body && 'error' in body && typeof body.error === 'string'
              ? body.error
              : 'The private endpoint did not return usage data.'
        })
        return
      }
      setState({ phase: 'ready', data: body })
    } catch {
      if (sequence === requestSequence.current) {
        setState({ phase: 'error', message: 'The private endpoint could not be reached.' })
      }
    }
  }, [rangeDays, router, timezone])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const data = state.phase === 'ready' ? state.data : null

  return (
    <div className="token-usage-reveal page-zoom-out relative mx-auto max-w-6xl px-6 pb-12 pt-6">
      <TokenBanner />

      <div className="tu-tabs mt-6">
        <DashboardTabs />
      </div>

      <div className="tu-content mt-8 grid grid-cols-12 gap-5">
        <div className="col-span-12 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="font-data text-[10px] leading-5 tracking-[0.12em] text-zinc-500">
            {data ? (
              <>
                RANGE {readableDate(data.range.from)} — {readableDate(data.range.to)} · TZ{' '}
                {data.range.timezone}
                <span className="hidden md:inline">
                  {' · '}
                  {data.availableBounds
                    ? `AVAILABLE ${readableDate(data.availableBounds.from)} — ${readableDate(data.availableBounds.to)}`
                    : 'NO STORED USAGE BOUNDS'}
                </span>
              </>
            ) : (
              <>RANGE {rangeDays}D</>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="Token usage source-day range"
              className="liquid-glass-inset flex items-center gap-0.5 rounded-lg p-0.5"
            >
              {RANGE_OPTIONS.map((option) => {
                const active = rangeDays === option.days
                return (
                  <button
                    key={option.days}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setRangeDays(option.days)}
                    className={`rounded-md px-3 py-2 font-data text-[10px] tracking-[0.18em] transition-colors ${
                      active ? 'text-orange-300' : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                    style={
                      active
                        ? { border: `1px solid ${orangeA(0.35)}`, background: orangeA(0.06) }
                        : { border: '1px solid transparent' }
                    }
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing || !timezone}
              aria-label="Refresh token usage"
              className="liquid-glass-inset flex h-[38px] w-[38px] items-center justify-center rounded-lg text-zinc-500 transition-colors hover:text-zinc-100 disabled:cursor-wait disabled:opacity-50"
            >
              <Icon name="refresh" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {state.phase === 'loading' && <LoadingState />}
        {state.phase === 'error' && (
          <FailureState message={state.message} retry={() => void load()} />
        )}
        {data && (
          <>
            <SyncLinkPanel data={data} />

            {!data.hasData ? (
              <EmptyUsage data={data} />
            ) : (
              <>
                <Panel className="col-span-12 grid grid-cols-2 lg:col-span-8">
                  <MetricCell
                    label="TOTAL TOKENS"
                    icon={<Icon name="spark" className="h-3.5 w-3.5" />}
                    className="border-b border-r border-white/[0.07]"
                    hint={
                      <span className="tabular-nums">
                        {formatExactInteger(data.totals.totalTokens)}
                      </span>
                    }
                  >
                    {/* Compact form is display-only; the exact figure lives in the hint. */}
                    <span
                      className="text-2xl leading-none tabular-nums [font-family:var(--font-pixel)]"
                      style={{ color: ORANGE, textShadow: ORANGE_GLOW }}
                    >
                      {formatCompact(Number(data.totals.totalTokens))}
                    </span>
                  </MetricCell>
                  <MetricCell
                    label="STORED COST"
                    hint="stored self-reported estimate"
                    icon={<Icon name="coins" className="h-3.5 w-3.5" />}
                    className="border-b border-white/[0.07]"
                  >
                    <span className="font-display text-2xl font-semibold tabular-nums text-zinc-50">
                      <Usd value={data.totals.storedCostUsd} />
                    </span>
                  </MetricCell>
                  <MetricCell
                    label="ACTIVE DAYS"
                    hint={`${data.range.inclusiveDays} source days selected`}
                    icon={<Icon name="calendar" className="h-3.5 w-3.5" />}
                    className="border-r border-white/[0.07]"
                  >
                    <span className="font-display text-2xl font-semibold tabular-nums text-zinc-50">
                      {String(data.activeDays)}
                    </span>
                  </MetricCell>
                  <MetricCell
                    label="CLIENTS"
                    hint="anonymous summaries in range"
                    icon={<Icon name="clients" className="h-3.5 w-3.5" />}
                  >
                    <span className="font-display text-2xl font-semibold tabular-nums text-zinc-50">
                      {String(data.clients.count)}
                    </span>
                  </MetricCell>
                </Panel>

                <DailyTrend points={data.dailyTrend} />

                <CompositionPanel totals={data.totals} />

                <BreakdownPanel
                  kind="agents"
                  breakdown={data.breakdowns.agents}
                  activeDays={data.activeDays}
                />
                <BreakdownPanel
                  kind="models"
                  breakdown={data.breakdowns.models}
                  activeDays={data.activeDays}
                  primaryEligibleDays={data.breakdowns.primaryModelEligibleActiveDays}
                />

                <ClientsPanel clients={data.clients.items} totalCount={data.clients.count} />
              </>
            )}
          </>
        )}
      </div>

      <style jsx global>{`
        .token-usage-reveal > .tu-banner,
        .token-usage-reveal > .tu-tabs,
        .token-usage-reveal .tu-content > * {
          animation: token-usage-enter 620ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        .token-usage-reveal > .tu-tabs { animation-delay: 60ms; }
        /* Grid rows: control bar, then SYNC LINK + KPI, then trend + composition. */
        .token-usage-reveal .tu-content > * { animation-delay: 100ms; }
        .token-usage-reveal .tu-content > *:nth-child(2),
        .token-usage-reveal .tu-content > *:nth-child(3) { animation-delay: 130ms; }
        .token-usage-reveal .tu-content > *:nth-child(4),
        .token-usage-reveal .tu-content > *:nth-child(5) { animation-delay: 160ms; }
        .token-usage-reveal .tu-content > *:nth-child(n + 6) { animation-delay: 190ms; }
        @keyframes token-usage-enter {
          from { opacity: 0; transform: translateY(12px); filter: blur(5px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .token-usage-reveal > .tu-banner,
          .token-usage-reveal > .tu-tabs,
          .token-usage-reveal .tu-content > * { animation: none; }
        }
      `}</style>
    </div>
  )
}
