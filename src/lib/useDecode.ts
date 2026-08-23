// Terminal-scramble decode: glyph noise resolving left to right into the
// real text. Extracted from landing/scrollFx's DecodeText so the
// billboard's hype announcement can drive the same effect off the
// ticker's arm signal instead of a scroll Stage — the interval/frame
// logic and timing are unchanged. Unarmed (and SSR) renders show the
// resolved text; `decoding` is true only while the scramble runs, for
// callers that tint or class the mid-decode state.

import { useEffect, useState } from 'react'

const DECODE_GLYPHS = '█▓▒░<>/[]{}=+*#'

export function useDecode(
  text: string,
  armed: boolean,
  delay = 0
): { out: string; decoding: boolean } {
  const [out, setOut] = useState(text)
  const [decoding, setDecoding] = useState(false)

  useEffect(() => {
    if (!armed) return
    let interval: ReturnType<typeof setInterval> | null = null
    let frame = 0
    // ~2.2 scramble frames per character reads as a lock-in, not a slot machine.
    const frames = Math.max(8, Math.round(text.length * 2.2))

    const timer = setTimeout(() => {
      setDecoding(true)
      interval = setInterval(() => {
        frame++
        const resolved = Math.floor((frame / frames) * text.length * 1.12)
        if (resolved >= text.length) {
          if (interval) clearInterval(interval)
          setOut(text)
          setDecoding(false)
          return
        }
        let s = ''
        for (let i = 0; i < text.length; i++) {
          const ch = text[i]
          if (i < resolved || ch === ' ') s += ch
          else s += DECODE_GLYPHS[(i * 31 + frame * 7) % DECODE_GLYPHS.length]
        }
        setOut(s)
      }, 30)
    }, delay)

    return () => {
      clearTimeout(timer)
      if (interval) clearInterval(interval)
    }
  }, [armed, text, delay])

  return { out, decoding }
}
