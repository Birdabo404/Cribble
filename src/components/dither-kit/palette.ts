// [Cribble patch] Ember/ice duotone entries are fed from src/lib/theme.ts —
// canvas paint can't resolve CSS variables, so the concrete hexes live there.
import { EMBER_HEX, ICE_HEX } from "@/lib/theme"

export type Rgb = [number, number, number]

export type DitherColor =
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "orange"
  | "red"
  | "grey"
  // [Cribble patch] Cribble duotone inks — theme-switchable via setDitherTheme.
  | "ember"
  | "ice"

export type Seed = { fill: Rgb; line: Rgb; star: Rgb }

// [Cribble patch] Helpers for the ember/ice seeds. The paint engine only reads
// `fill` (colour-vs-opacity rule in dither-paint.ts), so line/star reuse it.
const hexToRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

const seedOfHex = (hex: string): Seed => {
  const fill = hexToRgb(hex)
  return { fill, line: fill, star: fill }
}

export type DitherTheme = "dark" | "light"

const EMBER_SEEDS: Record<DitherTheme, Seed> = {
  dark: seedOfHex(EMBER_HEX.dark),
  light: seedOfHex(EMBER_HEX.light),
}

const ICE_SEEDS: Record<DitherTheme, Seed> = {
  dark: seedOfHex(ICE_HEX.dark),
  light: seedOfHex(ICE_HEX.light),
}

// Each seed: the area-fill hue, the bright series line, and the star sparkle.
export const PALETTE: Record<DitherColor, Seed> = {
  green: { fill: [40, 210, 110], line: [150, 255, 180], star: [200, 255, 220] },
  blue: { fill: [53, 143, 243], line: [150, 200, 255], star: [205, 228, 255] },
  purple: {
    fill: [150, 110, 255],
    line: [200, 175, 255],
    star: [225, 210, 255],
  },
  pink: { fill: [240, 90, 190], line: [255, 170, 220], star: [255, 205, 235] },
  orange: {
    fill: [255, 150, 50],
    line: [255, 195, 130],
    star: [255, 220, 175],
  },
  red: { fill: [240, 70, 70], line: [255, 150, 140], star: [255, 195, 185] },
  // No-data: a muted grey so empty metrics read as "nothing here".
  grey: { fill: [92, 92, 100], line: [140, 140, 150], star: [165, 165, 175] },
  // [Cribble patch] Duotone inks, defaulting dark; setDitherTheme swaps them.
  ember: EMBER_SEEDS.dark,
  ice: ICE_SEEDS.dark,
}

// [Cribble patch] Theme switch for the ember/ice entries. Callers (Sparkline)
// invoke it with next-themes' resolvedTheme and re-key the chart so remounted
// paint loops pick up the swapped seeds. Idempotent, safe to call in render.
let ditherTheme: DitherTheme = "dark"

export function setDitherTheme(theme: DitherTheme) {
  if (theme === ditherTheme) return
  ditherTheme = theme
  PALETTE.ember = EMBER_SEEDS[theme]
  PALETTE.ice = ICE_SEEDS[theme]
}

export const rgb = ([r, g, b]: Rgb, k = 1, a = 1) =>
  `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`

export const seedOfColor = (color: DitherColor): Seed => PALETTE[color]

export const isDitherColor = (value: unknown): value is DitherColor =>
  typeof value === "string" && value in PALETTE
