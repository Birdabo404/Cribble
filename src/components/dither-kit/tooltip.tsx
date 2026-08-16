"use client"

import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"
import { useCommonChart } from "./common-context"
import { useReducedMotionLive } from "./dither-paint"
import { cn } from "./lib"

export type TooltipVariant = "default" | "frosted-glass"

// [Cribble patch] Restyled to Cribble's font-data chip idiom (harvested from
// the retired DitherGrowthCanvas tooltip): liquid-glass-inset surface, wide-
// tracked zinc date label, ember tabular score. The upstream bg-popover /
// text-muted-foreground / text-popover-foreground classes don't generate in
// this repo's Tailwind config; both variants now share the glass chip.
const VARIANT: Record<TooltipVariant, string> = {
  default: "liquid-glass-inset",
  "frosted-glass": "liquid-glass-inset",
}

/**
 * Floating hover tooltip. Reads the shared common context so it works in every
 * chart family. It glides between points and fades in/out (instead of snapping),
 * and dims unselected series/slices.
 */
export function Tooltip({
  labelKey,
  valueFormatter,
  variant = "default",
}: {
  labelKey?: string
  valueFormatter?: (value: number, name: string) => string
  variant?: TooltipVariant
}) {
  const chart = useCommonChart()
  // [Cribble patch] Snap (no glide/fade) when reduced motion is requested.
  const reducedMotion = useReducedMotionLive()
  const show = chart.ready && chart.hoverIndex != null

  // Retain the last hovered index so the card keeps its content while fading
  // out — adjust-state-during-render (no refs in render).
  const [lastIndex, setLastIndex] = useState(0)
  if (chart.hoverIndex != null && chart.hoverIndex !== lastIndex) {
    setLastIndex(chart.hoverIndex)
  }
  const index = chart.hoverIndex ?? lastIndex

  const heading = chart.heading(index, labelKey)
  const items = chart.itemsAt(index)

  return (
    <AnimatePresence>
      {show && items.length > 0 && (
        <motion.div
          key="dither-tooltip"
          initial={{
            opacity: 0,
            x: "-50%",
            y: "-115%",
            top: chart.tooltipTop,
            left: chart.tooltipLeft,
          }}
          animate={{
            opacity: 1,
            x: "-50%",
            y: "-115%",
            top: chart.tooltipTop,
            left: chart.tooltipLeft,
          }}
          exit={{ opacity: 0 }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : {
                  type: "spring",
                  stiffness: 520,
                  damping: 38,
                  mass: 0.6,
                }
          }
          className={cn(
            // [Cribble patch] Chip surface + type (was rounded-md border px-2
            // py-1 shadow-sm bg-popover with font-mono internals).
            "pointer-events-none absolute z-10 whitespace-nowrap rounded-md px-2 py-1 font-data text-[10px]",
            VARIANT[variant]
          )}
        >
          {heading && (
            <span className="tracking-[0.25em] text-zinc-400">{heading}</span>
          )}
          {items.map((item) => (
            <span
              key={item.name}
              className="ml-2 tabular-nums text-ember"
              style={{ opacity: item.dimmed ? 0.4 : 1 }}
            >
              {valueFormatter
                ? valueFormatter(item.value, item.name)
                : item.value.toLocaleString()}
            </span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

Tooltip.chartLayer = "dom" as const
