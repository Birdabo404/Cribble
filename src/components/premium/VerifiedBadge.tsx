// The pixelated blue check — Cribble Premium's verified mark, rendered
// wherever a Pro pilot's callsign shows (profile, player card, board).
// Same crisp-rect technique as achievements/PixelIcon, but two-tone with
// fixed colors: the badge stays X-blue on every theme, the check stays
// white. Gate at call sites with isProTier(tier) from @/lib/entitlements.

/** X-blue. The check is the only Pro surface that uses it — amber stays
 *  the merchandising hue everywhere else. */
export const VERIFIED_BLUE = '#1D9BF0'

const CHECK_WHITE = '#FFFFFF'

// 12x12 seal: points at the four cardinals suggest the scalloped badge,
// '#' = blue seal, 'x' = white check, '.' = transparent.
const GRID = [
  '.....##.....',
  '...######...',
  '..########..',
  '.#######x##.',
  '.######xx##.',
  '##x###xx####',
  '##xx#xx#####',
  '.##xxx#####.',
  '.###x######.',
  '..########..',
  '...######...',
  '.....##.....'
] as const

export function VerifiedBadge({
  size = 14,
  className = ''
}: {
  size?: number
  className?: string
}) {
  const cells: JSX.Element[] = []

  GRID.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === '.') return
      cells.push(
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={ch === 'x' ? CHECK_WHITE : VERIFIED_BLUE}
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
      className={`shrink-0 ${className}`}
      style={{ filter: `drop-shadow(0 0 4px ${VERIFIED_BLUE}66)` }}
      role="img"
      aria-label="Verified — Cribble Premium"
    >
      <title>Cribble Premium</title>
      {cells}
    </svg>
  )
}
