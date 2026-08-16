"use client"

import { useChartPart } from "./chart-context"

/**
 * A horizontal marker line at a value on the y-axis — most useful as the zero
 * baseline for diverging data (`<ReferenceLine y={0} />`), or to mark a target
 * / threshold. Renders in the front SVG layer so it stays visible over the
 * dither fill; pass an optional `label` to annotate it at the right edge.
 */
export function ReferenceLine({
  y = 0,
  label,
  strokeDasharray = "4 4",
  // [Cribble patch] stroke-muted-foreground doesn't generate here; zinc flips
  // per theme.
  className = "stroke-zinc-500/60",
}: {
  y?: number
  label?: string
  strokeDasharray?: string
  className?: string
}) {
  const ctx = useChartPart("ReferenceLine")
  if (!ctx.ready) return null

  const { width } = ctx.plot
  const py = ctx.y(y)

  return (
    <g>
      <line
        x1={0}
        x2={width}
        y1={py}
        y2={py}
        className={className}
        strokeDasharray={strokeDasharray}
      />
      {label ? (
        <text
          x={width - 2}
          y={py - 3}
          textAnchor="end"
          // [Cribble patch] fill-muted-foreground doesn't generate here.
          className="fill-zinc-500 font-mono text-[10px]"
        >
          {label}
        </text>
      ) : null}
    </g>
  )
}
