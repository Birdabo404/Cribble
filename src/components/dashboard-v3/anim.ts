import type { CSSProperties } from 'react'

/**
 * Per-element stagger for the .anim-* entrance utilities (globals.css).
 * The delay is added on top of the card's page-level cascade delay
 * (--ad-base), so `animDelay(200)` means "200ms after my card lands".
 */
export const animDelay = (ms: number): CSSProperties =>
  ({ '--ad': `${ms}ms` }) as CSSProperties
