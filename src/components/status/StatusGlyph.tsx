// Severity glyph — shape-coded, not just color-coded: operational is a
// filled dot, degraded a diamond, outage a filled dot in the outage ink,
// unknown a hollow dashed ring (no signal is neither good news nor bad).
// `pulse` opts an operational lamp into the breathing glow (the Cribble
// probes row); every glow rides the scoped --status-glow multiplier so
// light mode can dim the neon the same way --lb-glow does.

import type { CSSProperties } from 'react'
import type { Severity } from '@/lib/status/types'
import { severityColor } from '@/components/status/severity'

type StatusGlyphProps = {
  severity: Severity
  /** Box edge in px. */
  size?: number
  /** Breathing glow — operational cockpit lamps only. */
  pulse?: boolean
  className?: string
}

export function StatusGlyph({
  severity,
  size = 9,
  pulse = false,
  className = ''
}: StatusGlyphProps) {
  const box: CSSProperties = { width: size, height: size }
  const glow = (alpha: number) =>
    `0 0 ${Math.max(6, size)}px ${severityColor(severity, `calc(${alpha} * var(--status-glow, 1))`)}`

  switch (severity) {
    case 'operational':
      return (
        <span
          aria-hidden
          className={`inline-block shrink-0 rounded-full ${pulse ? 'status-lamp-live' : ''} ${className}`}
          style={{ ...box, background: severityColor(severity), boxShadow: glow(0.55) }}
        />
      )
    case 'degraded':
      return (
        <span
          aria-hidden
          className={`inline-block shrink-0 rotate-45 rounded-[1px] ${className}`}
          style={{ ...box, background: severityColor(severity), boxShadow: glow(0.45) }}
        />
      )
    case 'outage':
      return (
        <span
          aria-hidden
          className={`inline-block shrink-0 rounded-full ${className}`}
          style={{ ...box, background: severityColor(severity), boxShadow: glow(0.7) }}
        />
      )
    case 'unknown':
      return (
        <span
          aria-hidden
          className={`inline-block shrink-0 rounded-full border border-dashed ${className}`}
          style={{ ...box, borderColor: 'rgb(var(--z500) / 0.7)' }}
        />
      )
    default: {
      const exhaustive: never = severity
      return exhaustive
    }
  }
}
