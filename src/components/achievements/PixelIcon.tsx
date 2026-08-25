import type { AchievementIcon } from '@/lib/achievements'
import { PIXEL_GRIDS } from './pixelIcons'
import { rampVar, type RampName, type RampStep } from './palette'

/**
 * Renders a 16x16 multi-ramp pixel sprite as crisp SVG rects. Every fill
 * is a --px-* CSS variable, so trophies re-theme live in light mode.
 * `locked` maps each cell's tone step onto the SAME step of the void
 * ramp — the internal shading survives, so the silhouette reads as an
 * engraved relief instead of a flat blob.
 */

/** Slot chars in ramp order: index/4 → ramp slot, index%4 + 1 → step. */
const SLOT_CHARS = '123456789abc'

interface Run {
  x: number
  y: number
  w: number
  fill: string
}

function fillFor(ch: string, ramps: RampName[], locked: boolean): string | null {
  const i = SLOT_CHARS.indexOf(ch)
  if (i === -1) return null
  const step = ((i % 4) + 1) as RampStep
  return rampVar(locked ? 'void' : ramps[Math.floor(i / 4)], step)
}

/* The achievements wall renders 32 sprites at once; a raw 16x16 grid is
   up to 256 rects each. Horizontal runs of one resolved fill collapse
   into single rects, and since grids are static the runs are cached per
   (name, locked). */
const runCache = new Map<string, Run[]>()

function runsFor(name: AchievementIcon, locked: boolean): Run[] {
  const key = `${name}:${locked ? 'v' : 'c'}`
  const cached = runCache.get(key)
  if (cached) return cached

  const { ramps, grid } = PIXEL_GRIDS[name]
  const runs: Run[] = []
  grid.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const fill = fillFor(row[x], ramps, locked)
      if (!fill) {
        x += 1
        continue
      }
      let end = x + 1
      while (end < row.length && fillFor(row[end], ramps, locked) === fill) end += 1
      runs.push({ x, y, w: end - x, fill })
      x = end
    }
  })
  runCache.set(key, runs)
  return runs
}

export function PixelIcon({
  name,
  size = 36,
  className = '',
  locked = false
}: {
  name: AchievementIcon
  size?: number
  className?: string
  locked?: boolean
}) {
  const runs = runsFor(name, locked)

  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden
    >
      {runs.map((run, i) => (
        <rect key={i} x={run.x} y={run.y} width={run.w} height={1} fill={run.fill} />
      ))}
    </svg>
  )
}
