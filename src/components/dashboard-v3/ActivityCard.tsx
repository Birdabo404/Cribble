'use client'

import { Fragment, useMemo, type CSSProperties } from 'react'
import { useTheme } from 'next-themes'
import { formatNumber } from '@/components/dashboard-v2/format'
import { BAYER, CELL } from '@/components/dither-kit/dither-paint'
import type { ActivityDay } from '@/lib/activity'
import {
  PUNCH_CARD_DAYS,
  buildActivityPunchCard,
  type PunchCardCell
} from '@/lib/activityHeatmap'
import { EMBER_HEX, emberA } from '@/lib/theme'
import { animDelay } from './anim'
import { IconGrid } from './DashIcons'
import { Panel, PanelHeader } from './Panel'

// Intensity tiers: the fraction of the 4×4 Bayer grid that lights up —
// 4, 8, 12, then all 16 pixels (the solid top tier keeps the ember glow).
const TIER_DENSITY = [0.25, 0.5, 0.75, 1] as const

const TOP_TIER_GLOW = 'shadow-[0_0_6px_rgb(var(--ember-rgb)/0.45)]'

// Day-of-month markers in the ruler row above the punch card.
const RULER_DAYS = [1, 15, 31] as const

/**
 * One 4×4 ordered-dither pass as a data-URI SVG tile: a pixel is lit where
 * the tier's density clears the Bayer threshold, in the theme's ember hex
 * (SVG data URIs can't resolve CSS variables). Tiled at CELL css px per
 * dither pixel and rendered `pixelated`, it reproduces the dither-kit
 * scatter as a static cell background.
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

function buildTierStyles(hex: string): CSSProperties[] {
  return TIER_DENSITY.map(
    (density): CSSProperties => ({
      // Faint ember tint under the pattern (the kit's "off tier" idea), so
      // gaps between lit pixels read as dim ember instead of letting the
      // background show through as holes — matters on the light theme.
      backgroundColor: emberA(0.18),
      backgroundImage: bayerTile(hex, density),
      backgroundSize: `${4 * CELL}px ${4 * CELL}px`,
      imageRendering: 'pixelated'
    })
  )
}

function MiniStat({
  label,
  value,
  hint,
  delayMs
}: {
  label: string
  value: string
  hint?: string
  delayMs: number
}) {
  return (
    <div className="anim-rise rounded-lg liquid-glass-inset px-3 py-2.5" style={animDelay(delayMs)}>
      <div className="font-data text-[9px] tracking-[0.3em] text-zinc-500">{label}</div>
      <div className="mt-1 font-display text-base font-semibold tracking-tight text-zinc-100 tabular-nums">
        {value}
      </div>
      {hint && <div className="text-[10px] text-zinc-500 mt-0.5">{hint}</div>}
    </div>
  )
}

/**
 * Full-year activity punch card: the last 12 calendar months as rows by 31
 * day columns, with fluid aspect-square cells, ragged month ends, a
 * per-month active-days readout, and Bayer-dithered ember fills per
 * intensity tier. Grid math and window stats live in lib/activityHeatmap.
 */
export function ActivityCard({ activity }: { activity: ActivityDay[] }) {
  const { resolvedTheme } = useTheme()
  // Client-only mount (dashboard is behind auth) — resolvedTheme is only
  // undefined for the first frames; default dark, the app's base theme.
  const theme = resolvedTheme === 'light' ? 'light' : 'dark'
  const tierStyles = useMemo(() => buildTierStyles(EMBER_HEX[theme]), [theme])

  const { months, activeDays, maxScore, longestStreak, bestDay, avgPerDay } =
    useMemo(() => buildActivityPunchCard(activity), [activity])

  const tierOf = (cell: PunchCardCell): number | null => {
    if (cell.isFuture || cell.score <= 0) return null
    const ratio = cell.score / maxScore
    if (ratio < 0.25) return 0
    if (ratio < 0.5) return 1
    if (ratio < 0.75) return 2
    return 3
  }

  // Grid row per month (row 1 is the ruler). Wherever consecutive months
  // change year, one extra short spacer row separates the year blocks —
  // at most one boundary in a 12-month window.
  let nextGridRow = 2
  const monthGridRows = months.map((month, i) => {
    if (i > 0 && month.year !== months[i - 1].year) nextGridRow += 1
    return nextGridRow++
  })

  return (
    <Panel className="dash-frame col-span-12 lg:col-span-8 p-6 flex flex-col">
      <PanelHeader
        title="ACTIVITY"
        icon={<IconGrid size={12} />}
        subtitle={`Last 12 months · ${activeDays} active ${activeDays === 1 ? 'day' : 'days'}`}
        action={
          <div className="hidden sm:flex items-center gap-1.5 font-data text-[9px] tracking-[0.3em] text-zinc-500">
            <span>LESS</span>
            <span className="h-[11px] w-[11px] rounded-[2px] bg-zinc-900" />
            {tierStyles.map((style, tier) => (
              <span
                key={tier}
                className={`h-[11px] w-[11px] rounded-[2px] ${
                  tier === TIER_DENSITY.length - 1 ? TOP_TIER_GLOW : ''
                }`}
                style={style}
              />
            ))}
            <span>MORE</span>
          </div>
        }
      />

      {/* flex-1 + centering absorbs the vertical slack the panel gains from
          matching the taller ToolsCard, instead of pooling it below the
          stats (which pin to the bottom of the flex column). */}
      <div className="mt-5 flex flex-1 flex-col justify-center">
        <div className="overflow-x-auto pb-1">
          {/* One grid holds the month gutter (max-content), the ruler row,
              the 31 fluid day columns, and the active-days readout column,
              so everything stays aligned at any width. The min-w keeps a
              cell-size floor on phones; the wrapper above scrolls. */}
          <div
            className="grid min-w-[480px] gap-[3px]"
            style={{
              gridTemplateColumns: `max-content repeat(${PUNCH_CARD_DAYS}, minmax(0, 1fr)) max-content`
            }}
          >
            {RULER_DAYS.map((rulerDay) => (
              <div
                key={rulerDay}
                className="pb-1 font-data text-[9px] leading-none tracking-[0.2em] text-zinc-600 whitespace-nowrap"
                style={{ gridColumn: rulerDay + 1, gridRow: 1 }}
              >
                {String(rulerDay).padStart(2, '0')}
              </div>
            ))}

            {months.map((month, rowIndex) => {
              const gridRow = monthGridRows[rowIndex]
              const isYearBreak =
                rowIndex > 0 && month.year !== months[rowIndex - 1].year
              // Year marker on the first row and each January row.
              const yearMark =
                rowIndex === 0 || month.monthIndex === 0
                  ? `'${String(month.year % 100).padStart(2, '0')}`
                  : null
              return (
                <Fragment key={`${month.year}-${month.monthIndex}`}>
                  {isYearBreak && (
                    // Empty spacer row between year blocks: 6px + the two
                    // 3px gaps around it = 12px of clean air vs the usual 3.
                    <div aria-hidden className="h-1.5" style={{ gridColumn: 1, gridRow: gridRow - 1 }} />
                  )}
                  {/* The label is absolutely positioned so its 10px line
                      height can't inflate the fluid aspect-square rows. */}
                  <div className="relative w-12" style={{ gridColumn: 1, gridRow }}>
                    <span className="absolute inset-0 flex items-center font-data text-[10px] leading-none text-zinc-500 whitespace-nowrap">
                      {month.label}
                      {yearMark && <span className="ml-1 text-zinc-600">{yearMark}</span>}
                    </span>
                  </div>

                  {month.cells.map((cell) => {
                    const tier = tierOf(cell)
                    return (
                      <div
                        key={cell.dateKey}
                        className={`anim-cell relative aspect-square rounded-[2px] transition-transform duration-150 hover:z-10 hover:scale-[1.5] hover:ring-1 hover:ring-ember/70 ${
                          cell.isFuture
                            ? 'border border-zinc-800 bg-transparent'
                            : tier === null
                              ? 'bg-zinc-900'
                              : ''
                        } ${tier === 3 ? TOP_TIER_GLOW : ''} ${
                          cell.isToday ? 'ring-1 ring-ice/80' : ''
                        }`}
                        style={{
                          gridColumn: cell.day + 1,
                          gridRow,
                          // Diagonal wave sweeping left → right down the
                          // month rows.
                          ...animDelay(160 + (cell.day - 1) * 6 + rowIndex * 14),
                          ...(tier !== null ? tierStyles[tier] : undefined)
                        }}
                        title={
                          cell.isFuture
                            ? ''
                            : `${cell.dateKey} · ${formatNumber(Math.round(cell.score))} pts`
                        }
                      />
                    )
                  })}

                  <div
                    className="flex items-center justify-end pl-1 font-data text-[9px] leading-none tabular-nums text-zinc-500"
                    style={{ gridColumn: PUNCH_CARD_DAYS + 2, gridRow }}
                  >
                    {month.activeDays > 0 ? `${month.activeDays}d` : '—'}
                  </div>
                </Fragment>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="LONGEST" value={`${longestStreak}d`} hint="streak" delayMs={520} />
        <MiniStat label="ACTIVE" value={`${activeDays}d`} hint="this window" delayMs={600} />
        <MiniStat label="BEST" value={formatNumber(Math.round(bestDay))} hint="single day" delayMs={680} />
        <MiniStat label="AVG" value={formatNumber(avgPerDay)} hint="per active day" delayMs={760} />
      </div>
    </Panel>
  )
}
