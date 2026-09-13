// One 20px share bar row for the player card's telemetry zone: icon chip,
// name, hairline track, percent. Reused for TOP TOOLS (neutral / medal fill)
// and AGENTIC (ember fill). No motion here — GSAP owns the bar reveal via
// the `data-pc="bar"` hook, and `late` marks fills that arrive on hydration.

import type { ReactNode } from 'react'
import { medalA } from '../types'

export type ShareFill =
  | 'neutral'
  | 'ember'
  | { medalRgb: string; medalFg: string }

export interface ShareRowProps {
  /** Rendered inside the 20x20 icon chip (e.g. <ToolIcon size={12}/>) */
  icon: ReactNode
  label: string
  percent: number
  fill: ShareFill
  /** CSS color for the icon chip glyph; defaults to rgb(var(--z300)) */
  iconColor?: string
  /** Mark the bar fill with data-pc-late so the GSAP hydrateIn beat animates
   *  it when it arrives after profile hydration (AGENTIC row). */
  late?: boolean
  title?: string
}

function fillBackground(fill: ShareFill): string {
  if (fill === 'neutral') return 'linear-gradient(90deg, rgb(var(--z600)), rgb(var(--z400)))'
  if (fill === 'ember') {
    return 'linear-gradient(90deg, rgb(var(--ember-rgb) / 0.55), rgb(var(--ember-rgb)))'
  }
  return `linear-gradient(90deg, ${medalA(fill.medalRgb, 0.55)}, ${fill.medalFg})`
}

export function ShareRow({
  icon,
  label,
  percent,
  fill,
  iconColor,
  late,
  title
}: ShareRowProps): JSX.Element {
  return (
    <div className="flex h-5 items-center gap-2" title={title}>
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px]"
        style={{
          background: 'rgb(var(--lb-panel-edge) / 0.045)',
          border: '1px solid rgb(var(--lb-panel-edge) / 0.1)',
          color: iconColor ?? 'rgb(var(--z300))'
        }}
      >
        {icon}
      </span>
      <span className="w-[76px] shrink-0 truncate font-display text-[12px] font-medium leading-none text-zinc-200">
        {label}
      </span>
      <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.06)]">
        <div
          data-pc="bar"
          {...(late ? { 'data-pc-late': '' } : {})}
          className="h-full origin-left rounded-full"
          style={{
            width: `${Math.max(3, Math.min(100, percent))}%`,
            background: fillBackground(fill)
          }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-[10.5px] leading-none tabular-nums text-zinc-500">
        {Math.round(percent)}%
      </span>
    </div>
  )
}
