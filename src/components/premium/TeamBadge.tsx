// The pixelated gold check — the Team account mark, rendered wherever an
// approved company's name shows (profile, player card, board). Same
// crisp-rect seal as VerifiedBadge, re-toned: the seal burns leaderboard
// gold on every theme, the check stays white. Gate at call sites with
// isApprovedTeam(user) from @/lib/entitlements — tier TEAM alone means
// "paid, awaiting review" and must NOT light this badge.

/** Leaderboard gold (--lb-gold). Teams share the arena's merchandising
 *  hue — gold is the tier color, blue stays Pro's. */
export const TEAM_GOLD = '#FFD644'

const CHECK_WHITE = '#FFFFFF'

// 12x12 seal, identical geometry to VerifiedBadge so the two marks sit
// on the same optical grid next to names: points at the four cardinals
// suggest the scalloped badge, '#' = gold seal, 'x' = white check,
// '.' = transparent.
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

export function TeamBadge({
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
          fill={ch === 'x' ? CHECK_WHITE : TEAM_GOLD}
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
      style={{ filter: `drop-shadow(0 0 4px ${TEAM_GOLD}66)` }}
      role="img"
      aria-label="Verified Team — Cribble"
    >
      <title>Cribble Team</title>
      {cells}
    </svg>
  )
}
