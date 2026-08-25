// Shared tone ramps for the achievement trophy sprites. Each ramp is one
// material read in four steps (1 shadow · 2 base · 3 light · 4 highlight)
// under a single top-left light source. These hex values are the DARK
// theme source of truth and generate the --px-* CSS vars in globals.css;
// light-theme overrides live in globals.css only, so sprites re-theme
// live without touching this file.

/** Four tones, shadow → highlight. */
export type Ramp = readonly [string, string, string, string]

export const PIXEL_RAMPS = {
  /** Fire / heat — anchored on --ember. */
  ember: ['#7c2d12', '#ea580c', '#ff8a3d', '#ffc466'],
  /** Metal trophy gold — anchored on --r-legendary. */
  gold: ['#8a6512', '#d4a017', '#ffd644', '#fff3b0'],
  /** Cold light — anchored on --ice. */
  ice: ['#1e5f7a', '#4aa8cc', '#9bdcf5', '#e3f7ff'],
  /** Hacker green — anchored on --accent. */
  signal: ['#0b6e1f', '#05c414', '#02fe01', '#b8ffb0'],
  /** Synthwave pink — anchored on --r-epic. */
  plasma: ['#831051', '#d61a7f', '#ff2d95', '#ff9ecb'],
  /** Signal blue — anchored on --r-rare. */
  azure: ['#14547d', '#1e8ec2', '#38bdf8', '#bae9ff'],
  /** Near-black structure; also the locked-silhouette ramp. */
  void: ['#07080d', '#14161d', '#262a35', '#3d4250'],
  /** Zinc hardware. */
  steel: ['#3f3f46', '#71717a', '#a1a1aa', '#e4e4e7'],
  /** Warm off-white speculars. */
  bone: ['#8f8a7e', '#c9c3b4', '#ece7d9', '#fffdf5']
} as const satisfies Record<string, Ramp>

export type RampName = keyof typeof PIXEL_RAMPS

export type RampStep = 1 | 2 | 3 | 4

export function rampVar(ramp: RampName, step: RampStep): string {
  return `var(--px-${ramp}-${step})`
}
