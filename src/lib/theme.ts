/**
 * Theme-aware accent colors. The underlying values live in globals.css:
 * dark mode = hacker green (#02fe01), light mode = neon orange (#ff5e00).
 *
 * Use ACCENT anywhere a CSS color string is accepted (inline styles,
 * styled-jsx). Use accentA(alpha) for translucent variants.
 * Canvas/WebGL code cannot resolve CSS variables — those components read
 * the resolved theme and pick concrete values from ACCENT_HEX instead.
 */
export const ACCENT = 'var(--accent)'

export const accentA = (alpha: number) => `rgb(var(--accent-rgb) / ${alpha})`

export const ACCENT_HEX = {
  dark: '#02fe01',
  light: '#ff5e00',
} as const

export const ACCENT_RGB = {
  dark: { r: 2, g: 254, b: 1 },
  light: { r: 255, g: 94, b: 0 },
} as const

/**
 * Dashboard duotone inks (globals.css defines the per-theme values).
 * Ember = "you / heat / activity" — series, heat ramp, streak, deltas.
 * Ice = "structure / world / rank" — grids, averages, gauge tracks,
 * corner brackets. Same usage pattern as ACCENT/accentA above.
 */
export const EMBER = 'var(--ember)'

export const emberA = (alpha: number) => `rgb(var(--ember-rgb) / ${alpha})`

export const ICE = 'var(--ice)'

export const iceA = (alpha: number) => `rgb(var(--ice-rgb) / ${alpha})`

export const EMBER_HEX = {
  dark: '#ff6a1a',
  light: '#ff5e00',
} as const

export const ICE_HEX = {
  dark: '#9bdcf5',
  light: '#0e7490',
} as const
