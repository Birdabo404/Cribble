// Shared visual language for the Burn Board's token personas.
//
// The five spend tiers read as flame temperature — physically, flames go
// red → orange → gold → white → blue-white as they get hotter, so higher
// burn = hotter hue and red becomes the *entry* tier instead of a wall of
// identical danger chips. Behavior personas keep their existing tone hues.
//
// Every visual carries a bright triplet for dark panels and a deeper ink
// for light panels. Styles author --pv-hue/--pv-ink (and --pv2-*) inline;
// consumers read rgb(var(--pv)) etc., and the `lbt-pv` class in
// TokenBoard's global CSS maps --pv to the hue by default and to the ink
// under html.light. The indirection matters: an inline --pv could never
// lose to a stylesheet override, so the theme swap has to happen in CSS.
// Text-shadow glows ride --lb-glow, which light mode zeroes. The scrim
// variant is for chips sitting on the player card's dark banner scrim,
// which stays dark in both themes.

import type { CSSProperties } from 'react'
import type { TokenPersona, TokenPersonaTone } from '@/lib/tokenLeaderboard'

export interface TokenPersonaVisual {
  /** 'R G B' triplet — bright hue for dark panels */
  rgb: string
  /** 'R G B' triplet — deeper ink so the hue holds on light panels */
  ink: string
  /** second hue for the top-tier gradient border, or null for a flat border */
  rgb2: string | null
  /** light-mode ink for rgb2 */
  ink2: string | null
  /** text-shadow glow alpha — scales up the tier ladder; rides --lb-glow */
  glow: number
  /** spend tiers wear the tiny flame glyph on their chips */
  flame: boolean
}

type SpendTierId = Extract<
  TokenPersona['id'],
  'whale' | 'financial-incident' | 'payroll-expense' | 'audit-risk' | 'compute-baron'
>

/** The ladder, $100 → $25k+: ember red → orange flame → gold/amber →
 *  white-hot platinum → blue-white plasma. Glow strength climbs with it. */
const SPEND_TIER_VISUALS: Record<SpendTierId, TokenPersonaVisual> = {
  whale: {
    rgb: '239 68 68',
    ink: '185 28 28',
    rgb2: null,
    ink2: null,
    glow: 0,
    flame: true
  },
  'financial-incident': {
    rgb: '251 146 60',
    ink: '194 65 12',
    rgb2: null,
    ink2: null,
    glow: 0.22,
    flame: true
  },
  'payroll-expense': {
    rgb: '251 191 36',
    ink: '161 98 7',
    rgb2: null,
    ink2: null,
    glow: 0.34,
    flame: true
  },
  'audit-risk': {
    rgb: '237 242 248',
    ink: '71 85 105',
    rgb2: '216 228 242',
    ink2: '100 116 139',
    glow: 0.55,
    flame: true
  },
  'compute-baron': {
    rgb: '125 211 252',
    ink: '29 78 216',
    rgb2: '224 242 254',
    ink2: '2 132 199',
    glow: 0.72,
    flame: true
  }
}

const TONE_VISUALS: Record<TokenPersonaTone, TokenPersonaVisual> = {
  danger: { rgb: '248 113 113', ink: '185 28 28', rgb2: null, ink2: null, glow: 0, flame: false },
  hot: { rgb: '251 146 60', ink: '194 65 12', rgb2: null, ink2: null, glow: 0, flame: false },
  cache: { rgb: '52 211 153', ink: '4 120 87', rgb2: null, ink2: null, glow: 0, flame: false },
  output: { rgb: '192 132 252', ink: '126 34 206', rgb2: null, ink2: null, glow: 0, flame: false },
  neutral: { rgb: '161 161 170', ink: '82 82 91', rgb2: null, ink2: null, glow: 0, flame: false }
}

function isSpendTier(id: TokenPersona['id']): id is SpendTierId {
  return id in SPEND_TIER_VISUALS
}

export function tokenPersonaVisual(persona: TokenPersona): TokenPersonaVisual {
  return isSpendTier(persona.id) ? SPEND_TIER_VISUALS[persona.id] : TONE_VISUALS[persona.tone]
}

/** Chip style for board rows — theme-aware via the `lbt-pv` var swap. */
export function personaChipStyle(visual: TokenPersonaVisual): CSSProperties {
  return {
    ['--pv-hue' as string]: visual.rgb,
    ['--pv-ink' as string]: visual.ink,
    color: 'rgb(var(--pv))',
    background: 'linear-gradient(135deg, rgb(var(--pv) / 0.13), rgb(var(--pv) / 0.03))',
    borderWidth: 1,
    borderStyle: 'solid',
    ...(visual.rgb2
      ? {
          ['--pv2-hue' as string]: visual.rgb2,
          ['--pv2-ink' as string]: visual.ink2 ?? visual.ink,
          borderColor: 'transparent',
          borderImageSource:
            'linear-gradient(135deg, rgb(var(--pv) / 0.75), rgb(var(--pv2) / 0.95))',
          borderImageSlice: 1
        }
      : { borderColor: 'rgb(var(--pv) / 0.38)' }),
    ...(visual.glow > 0
      ? { textShadow: `0 0 9px rgb(var(--pv) / calc(${visual.glow} * var(--lb-glow, 1)))` }
      : null)
  }
}

/** Chip style for the player card's dark banner scrim — the scrim stays
 *  dark in both themes (like the rank plate beside it), so this uses the
 *  bright hues literally and pins the glow instead of riding --lb-glow. */
export function personaChipScrimStyle(visual: TokenPersonaVisual): CSSProperties {
  return {
    color: `rgb(${visual.rgb})`,
    background: 'rgb(0 0 0 / 0.58)',
    borderWidth: 1,
    borderStyle: 'solid',
    ...(visual.rgb2
      ? {
          borderColor: 'transparent',
          borderImageSource: `linear-gradient(135deg, rgb(${visual.rgb} / 0.8), rgb(${visual.rgb2} / 0.95))`,
          borderImageSlice: 1
        }
      : { borderColor: `rgb(${visual.rgb} / 0.5)` }),
    ...(visual.glow > 0 ? { textShadow: `0 0 8px rgb(${visual.rgb} / ${visual.glow})` } : null)
  }
}

/** The mobile rows' 5px persona dot — same var swap as the chips. */
export function personaDotStyle(visual: TokenPersonaVisual): CSSProperties {
  return {
    ['--pv-hue' as string]: visual.rgb,
    ['--pv-ink' as string]: visual.ink,
    background: 'rgb(var(--pv))',
    ...(visual.glow > 0
      ? { boxShadow: `0 0 6px rgb(var(--pv) / calc(${visual.glow} * var(--lb-glow, 1)))` }
      : null)
  }
}
