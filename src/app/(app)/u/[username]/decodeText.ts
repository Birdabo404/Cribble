// Frame function for the GSAP-driven decode: the same left-to-right
// glyph scramble as lib/useDecode (which runs on its own interval), lifted
// out as a pure (text, progress, frame) -> string so the boot timeline can
// drive it from a tweened proxy and stay in step with the unfold. Same
// glyph set, same 1.12 resolve rate, spaces never scrambled.

export const DECODE_GLYPHS = '█▓▒░<>/[]{}=+*#'

/** Characters resolved per unit of progress, relative to the text length
 *  — a little over 1 so the tail locks in before the tween ends. */
export const DECODE_RESOLVE_RATE = 1.12

/**
 * The text as it reads at `progress` (0..1) on animation `frame`. Frame
 * only picks which glyph fills an unresolved slot, so two calls with the
 * same arguments are identical; a caller advancing `frame` each tick
 * gets the flicker. Returns the exact text once progress reaches 1 (or
 * once the resolve rate has covered every character).
 */
export function scrambleFrame(text: string, progress: number, frame: number): string {
  if (progress >= 1) return text
  const p = progress > 0 ? progress : 0
  const resolved = Math.floor(p * text.length * DECODE_RESOLVE_RATE)
  if (resolved >= text.length) return text
  const f = Number.isFinite(frame) ? Math.abs(Math.trunc(frame)) : 0
  let s = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (i < resolved || ch === ' ') s += ch
    else s += DECODE_GLYPHS[(i * 31 + f * 7) % DECODE_GLYPHS.length]
  }
  return s
}
