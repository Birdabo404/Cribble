// Bag manifest chrome — the class strings and one-liners the header, index
// rail, loadout strip and spec drawer share. Every string here is a literal
// so Tailwind's scanner sees each utility verbatim (nothing is templated
// per call); colors resolve only through the --bag-* tokens declared on
// .bag-manifest in globals.css. toneColor lives here for every bag file
// (register rows, sheet values, the strip); pad2 is bagModel's.

import type { StatusTone } from './bagModel'

/* ---- faces ---- */
export const DATA = '[font-family:var(--bag-font-data)]'
export const PIXEL = '[font-family:var(--bag-font-pixel)]'
export const DISPLAY = '[font-family:var(--bag-font-display)]'

/** 10px mono uppercase — the floor for every annotation on the sheet. */
export const MICRO = `${DATA} text-[length:var(--bag-fs-micro)] uppercase tracking-[0.18em] leading-none`
/** 11px mono uppercase — row labels, filter options. */
export const LABEL = `${DATA} text-[length:var(--bag-fs-label)] uppercase tracking-[0.12em] leading-none`

/* ---- inks + surfaces ---- */
export const INK = 'text-[color:var(--bag-ink)]'
export const MUTE = 'text-[color:var(--bag-mute)]'
export const PAPER_BG = 'bg-[color:var(--bag-paper)]'
export const LINE = 'border-[color:var(--bag-line)]'
/** Inverted block: ink slab, paper type (the active compartment row). */
export const INVERT = 'bg-[color:var(--bag-ink)] text-[color:var(--bag-paper)]'

/** Focus ring without box-shadow: a 1px dashed ink (--bag-focus) outline
 * drawn inside the target — selection is the same outline, solid. Never
 * the signal hue: that means "equipped" and nothing else. Buttons that
 * are themselves signal-filled use FOCUS_ON_SIGNAL. */
export const FOCUS =
  'focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--bag-focus)]'
export const FOCUS_ON_SIGNAL =
  'focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-offset-[-3px] focus-visible:outline-[color:var(--bag-on-signal)]'

/** Status glyph/label paint: equipped = signal-as-text, stowed = ink,
 * locked = mute. Signal text is the deeper light-mode orange, not the
 * fill hue — the fill is reserved for the EQUIP button. */
export function toneColor(tone: StatusTone): string {
  switch (tone) {
    case 'signal':
      return 'var(--bag-signal-text)'
    case 'ink':
      return 'var(--bag-ink)'
    case 'mute':
      return 'var(--bag-mute)'
    default: {
      const exhaustive: never = tone
      return exhaustive
    }
  }
}
