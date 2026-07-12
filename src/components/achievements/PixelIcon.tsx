import type { AchievementIcon } from '@/lib/achievements'
import { PIXEL_GRIDS } from './pixelIcons'

/**
 * Renders a 12x12 pixel bitmap as crisp SVG rects. Both tones derive from
 * currentColor — the parent sets the hue (rarity color / locked gray) via
 * CSS `color`, keeping every badge on the site's theme palette.
 */
export function PixelIcon({
  name,
  size = 36,
  className = ''
}: {
  name: AchievementIcon
  size?: number
  className?: string
}) {
  const grid = PIXEL_GRIDS[name]
  const cells: JSX.Element[] = []

  grid.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === '.') return
      cells.push(
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill="currentColor"
          opacity={ch === 'o' ? 0.45 : 1}
        />
      )
    })
  })

  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden
    >
      {cells}
    </svg>
  )
}
