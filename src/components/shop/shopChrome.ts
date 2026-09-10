// Shop floor chrome — the class strings and one-liners the masthead,
// ticker, catalog index, stage, cards and spec drawer share. Every string
// here is a literal so Tailwind's scanner sees each utility verbatim
// (nothing is templated per call); colors resolve only through the
// --shop-* tokens declared on .shop-floor in globals.css. rarityColor lives
// here for every shop file (card ticks, spec rows, the stage kicker).

import type { PlateRarity } from '@/lib/cosmetics/plates'

/* ---- faces ---- */
export const DATA = '[font-family:var(--shop-font-data)]'
export const PIXEL = '[font-family:var(--shop-font-pixel)]'
export const DISPLAY = '[font-family:var(--shop-font-display)]'
export const JP = '[font-family:var(--shop-font-jp)]'

/** 10px mono uppercase — the floor for every annotation on the floor:
 * indices, telemetry, dl terms, rarity labels. */
export const MICRO = `${DATA} text-[length:var(--shop-fs-micro)] uppercase tracking-[0.18em] leading-none`
/** 11px mono uppercase — section kickers, chip text, the catalog index. */
export const LABEL = `${DATA} text-[length:var(--shop-fs-label)] uppercase tracking-[0.12em] leading-none`
/** 12.5px Inter — taglines, scene notes. The body face is Inter already
 * (root layout), so this only sets size and leading. */
export const COPY = 'text-[length:var(--shop-fs-copy)] leading-[1.55]'
/** Japanese kicker — always paired with its English word, 10px, wide set. */
export const JP_KICKER = `${JP} text-[length:var(--shop-fs-micro)] tracking-[0.2em] leading-none`

/* ---- inks + surfaces ---- */
export const INK = 'text-[color:var(--shop-ink)]'
export const MUTE = 'text-[color:var(--shop-mute)]'
export const PAPER_BG = 'bg-[color:var(--shop-paper)]'
export const WELL_BG = 'bg-[color:var(--shop-well)]'
export const LINE = 'border-[color:var(--shop-line)]'
export const LINE_SOFT = 'border-[color:var(--shop-line-soft)]'
/** Inverted block: ink slab, paper type (the hovered price chip, the
 * active index item). */
export const INVERT = 'bg-[color:var(--shop-ink)] text-[color:var(--shop-paper)]'

/* ---- the two filled hues (one meaning each) ---- */
/** Plate action: the stage BUY. Signal fill, dark type riding it. */
export const SIGNAL_FILL = 'bg-[color:var(--shop-signal)] text-[color:var(--shop-on-signal)]'
/** Subscription action: Pro YEARLY. Gold fill, paper type riding it. */
export const GOLD_FILL = 'bg-[color:var(--shop-gold)] text-[color:var(--shop-on-gold)]'
/** Signal as text or a thin mark — the deeper light-mode orange, not the
 * fill hue; the fill is reserved for BUY. */
export const SIGNAL_TEXT = 'text-[color:var(--shop-signal-text)]'
/** Gold as text — Pro tier readouts and the vault band's numerals only. */
export const GOLD_TEXT = 'text-[color:var(--shop-gold-text)]'
/** Ownership mark — OWNED ✓ and the EQUIP door. */
export const OWNED_TEXT = 'text-[color:var(--shop-owned)]'

/** Focus ring without box-shadow: a 1px dashed ink (--shop-focus) outline
 * drawn inside the target — selection is the same outline, solid. Never
 * the signal hue: that means "buy" and nothing else. Buttons that are
 * themselves signal-filled use FOCUS_ON_SIGNAL. */
export const FOCUS =
  'focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--shop-focus)]'
export const FOCUS_ON_SIGNAL =
  'focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-offset-[-3px] focus-visible:outline-[color:var(--shop-on-signal)]'

/** Tap floor for every interactive element (44px, pre-divided at md). */
export const TAP = 'min-h-[var(--shop-tap)]'

/** Rarity paint for the tick and its 10px label — the --r-* tokens, which
 * html.light .shop-floor re-pins deeper for RARE and LEGENDARY. Never a
 * fill: rarity is a fact on the card, not an action. */
export function rarityColor(rarity: PlateRarity): string {
  switch (rarity) {
    case 'common':
      return 'rgb(var(--r-common))'
    case 'rare':
      return 'rgb(var(--r-rare))'
    case 'epic':
      return 'rgb(var(--r-epic))'
    case 'legendary':
      return 'rgb(var(--r-legendary))'
    case 'mythic':
      return 'rgb(var(--r-mythic))'
    default: {
      const exhaustive: never = rarity
      return exhaustive
    }
  }
}
