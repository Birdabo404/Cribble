import type { ReactNode } from 'react'

/**
 * Dashboard micro icon set — hand-drawn on a 16px grid, 1.25px squared
 * strokes, currentColor. One glyph per instrument: crosshair (rank),
 * waveform (activity), timer (time), gauge (efficiency), flame (streak),
 * antenna (sync), grid (heatmap), chip (tools), clock (season).
 */
function IconBase({
  size = 16,
  className,
  children
}: {
  size?: number
  className?: string
  children: ReactNode
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  )
}

type IconProps = { size?: number; className?: string }

export function IconCrosshair(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="4.6" />
      <path d="M8 1v2.3M8 12.7V15M1 8h2.3M12.7 8H15" />
      <circle cx="8" cy="8" r="0.7" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function IconWaveform(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M1 8h2.4l1.4-3.6L7.2 12 9 3.6l1.4 6 1-1.6H15" />
    </IconBase>
  )
}

export function IconTimer(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="9.2" r="4.8" />
      <path d="M8 4.4V1.6M6.3 1.6h3.4M8 9.2l2.4-2.4" />
    </IconBase>
  )
}

export function IconGauge(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.2 11.5a5.8 5.8 0 0 1 11.6 0" />
      <path d="M2.2 11.5v1.8M13.8 11.5v1.8M8 11.5l3.4-4.2" />
      <circle cx="8" cy="11.5" r="0.7" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function IconFlame(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 1.6C9.9 4 11.7 5.7 11.7 8.7a3.7 3.7 0 0 1-7.4 0C4.3 5.7 6.1 4 8 1.6Z" />
      <path d="M6.4 10.6a1.6 1.6 0 0 0 3.2 0c0-1-.7-1.6-1.6-2.6-.9 1-1.6 1.6-1.6 2.6Z" />
    </IconBase>
  )
}

export function IconAntenna(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <path d="M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6" />
      <path d="M3 3a7.1 7.1 0 0 0 0 10M13 3a7.1 7.1 0 0 1 0 10" />
    </IconBase>
  )
}

export function IconGrid(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.6 2.6H7v4.4H2.6zM9 2.6h4.4v4.4H9zM2.6 9H7v4.4H2.6zM9 9h4.4v4.4H9z" />
    </IconBase>
  )
}

export function IconChip(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.6 4.6h6.8v6.8H4.6z" />
      <path d="M7 7h2v2H7z" />
      <path d="M6.2 4.6V2.2M9.8 4.6V2.2M6.2 13.8v-2.4M9.8 13.8v-2.4M4.6 6.2H2.2M4.6 9.8H2.2M13.8 6.2h-2.4M13.8 9.8h-2.4" />
    </IconBase>
  )
}

export function IconClock(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 4.6V8l2.6 1.6" />
    </IconBase>
  )
}
