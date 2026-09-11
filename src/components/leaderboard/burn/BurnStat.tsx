// One cell of the stat strip above the board — PLAYERS / TOKENS TORCHED /
// EST. BURN / TOP BURNER on CLI, AGENTS RUN in EST. BURN's seat on CURSOR.
// A tracked mono label with its glyph, the pixel-font figure, and a
// caption under it; the strip (.bb-stats) draws the hairlines between
// cells, two-up on phones and four across from md.

import type { CSSProperties, ReactNode } from 'react'

export function BurnStat({
  icon,
  label,
  hint,
  valueStyle,
  children
}: {
  icon: ReactNode
  label: string
  hint?: string
  valueStyle?: CSSProperties
  children: ReactNode
}) {
  return (
    <div className="bb-stat">
      <div className="bb-stat-label">
        {icon}
        {label}
      </div>
      <div className="bb-stat-value" style={valueStyle}>
        {children}
      </div>
      {hint && <div className="bb-stat-hint">{hint}</div>}
    </div>
  )
}
