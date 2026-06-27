'use client'

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

interface Language {
  text: string
  font: string
  direction?: 'ltr' | 'rtl'
}

// English first so it always renders on initial paint.
const languages: Language[] = [
  { text: 'worldwide', font: 'font-english' },
  { text: 'عالميًا', font: 'font-arabic', direction: 'rtl' },
  { text: '世界的に', font: 'font-japanese' },
  { text: '전 세계적으로', font: 'font-korean' },
  { text: '全球', font: 'font-chinese' },
  { text: 'weltweit', font: 'font-german' },
  { text: 'världsomspännande', font: 'font-swedish' },
  { text: 'в мире', font: 'font-russian' },
  { text: 'mondialmente', font: 'font-italian' },
  { text: 'mondialement', font: 'font-french' },
  { text: 'mundialmente', font: 'font-spanish' },
  { text: 'wereldwijd', font: 'font-dutch' },
  { text: 'παγκοσμίως', font: 'font-greek' },
  { text: 'ברחבי העולם', font: 'font-hebrew', direction: 'rtl' },
  { text: 'दुनिया भर में', font: 'font-hindi' },
]

// Hold times (steady-state, between transitions)
const HOLD_ENGLISH_MS = 6000
const HOLD_OTHER_MS = 3000

// Transition window — snappy fade
const FADE_OUT_MS = 420
const SWAP_GAP_MS = 90
const FADE_IN_MS = 520

// Kinetic per-character entrance (non-English only)
const KIN_CHAR_DUR_MS = 520
const KIN_CHAR_STAGGER_MS = 28

// Grapheme-aware splitter — keeps Hindi/Arabic clusters intact.
function getGraphemes(text: string): string[] {
  const I =
    typeof Intl !== 'undefined'
      ? (Intl as unknown as { Segmenter?: typeof Intl.Segmenter })
      : null
  if (I && I.Segmenter) {
    try {
      const seg = new I.Segmenter(undefined, { granularity: 'grapheme' })
      return Array.from(seg.segment(text), (s) => s.segment)
    } catch {
      // fall through
    }
  }
  return Array.from(text)
}

export default function WorldwideText() {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  // Kinetic plays on the first reveal of each non-English language only.
  // English (index 0) always fades like the standard transition.
  const [kinetic, setKinetic] = useState(false)
  const [width, setWidth] = useState<number | null>(null)

  const measureRef = useRef<HTMLSpanElement | null>(null)
  const indexRef = useRef(0)
  const seenRef = useRef<Set<number>>(new Set([0]))

  // Measure each rendered text so the wrap animates between exact widths.
  useLayoutEffect(() => {
    if (measureRef.current) {
      const w = measureRef.current.getBoundingClientRect().width
      setWidth(Math.ceil(w))
    }
  }, [index])

  useEffect(() => {
    let cancelled = false
    const timers: Array<ReturnType<typeof setTimeout>> = []
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms)
        timers.push(t)
      })

    const loop = async () => {
      while (!cancelled) {
        const holdMs =
          indexRef.current === 0 ? HOLD_ENGLISH_MS : HOLD_OTHER_MS
        await wait(holdMs)
        if (cancelled) return

        setPhase('out')
        await wait(FADE_OUT_MS)
        if (cancelled) return

        const next = (indexRef.current + 1) % languages.length
        // Kinetic is exclusive to non-English languages on first reveal.
        const isFirst = next !== 0 && !seenRef.current.has(next)
        indexRef.current = next
        seenRef.current.add(next)
        setIndex(next)
        setKinetic(isFirst)

        await wait(SWAP_GAP_MS)
        if (cancelled) return

        setPhase('in')
        await wait(FADE_IN_MS)
      }
    }
    loop()

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  const lang = languages[index]
  const graphemes = useMemo(() => getGraphemes(lang.text), [lang.text])
  const showKinetic = kinetic && phase === 'in'

  return (
    <span
      className="worldwide-wrap"
      style={{
        width: width != null ? `${width}px` : 'auto',
        transition: `width ${FADE_IN_MS + SWAP_GAP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      }}
    >
      {/* hidden measurement node — lays out the next-rendered text */}
      <span
        ref={measureRef}
        aria-hidden
        className={`worldwide-measure ${lang.font}`}
        dir={lang.direction ?? 'ltr'}
      >
        {lang.text}
      </span>

      <span
        className={`worldwide-text ${lang.font} ${
          phase === 'in' ? 'is-in' : 'is-out'
        } ${kinetic ? 'is-kinetic' : ''}`}
        dir={lang.direction ?? 'ltr'}
      >
        {showKinetic ? (
          <>
            <span aria-hidden className="kin-row">
              {graphemes.map((g, i) => (
                <span
                  key={`${index}-${i}`}
                  className="kin-char"
                  style={{
                    animationDelay: `${i * KIN_CHAR_STAGGER_MS}ms`,
                  }}
                >
                  {g === ' ' ? '\u00A0' : g}
                </span>
              ))}
            </span>
            {/* keeps the word announced as a single token to AT */}
            <span className="sr-only">{lang.text}</span>
          </>
        ) : (
          lang.text
        )}
      </span>

      <style jsx>{`
        .worldwide-wrap {
          position: relative;
          display: inline-block;
          vertical-align: baseline;
          line-height: 1.05;
          color: #02fe01;
          text-shadow: 0 0 14px rgba(2, 254, 1, 0.18);
          will-change: width;
        }
        .worldwide-measure {
          position: absolute;
          visibility: hidden;
          white-space: nowrap;
          pointer-events: none;
          left: 0;
          top: 0;
          letter-spacing: -0.01em;
        }
        .worldwide-text {
          display: inline-block;
          white-space: nowrap;
          letter-spacing: -0.01em;
          transform-origin: left center;
          transition:
            opacity ${FADE_IN_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
            transform ${FADE_IN_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
            filter ${FADE_IN_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .is-in:not(.is-kinetic) {
          opacity: 1;
          transform: translateY(0) scale(1);
          filter: blur(0);
        }
        .is-out {
          opacity: 0;
          transform: translateY(2px) scale(0.985);
          filter: blur(2px);
          transition-duration: ${FADE_OUT_MS}ms;
        }
        /* Kinetic mode: parent stays fully visible so per-char animation
           drives the entrance, not a parent fade. */
        .is-in.is-kinetic {
          opacity: 1;
          transform: none;
          filter: none;
          transition: none;
        }

        /* English-specific tuning — Inter at a confident display weight
           with a touch of negative tracking so it harmonises with the
           "cribble." wordmark above it. */
        :global(.font-english) {
          font-family: 'Inter', system-ui, sans-serif;
          font-weight: 600;
          letter-spacing: -0.018em;
        }

        .kin-row {
          display: inline-block;
        }
        .kin-char {
          display: inline-block;
          /* keyframe handles the entrance; "both" pins start + end states. */
          animation: kin-in ${KIN_CHAR_DUR_MS}ms
            cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity, filter;
        }
        @keyframes kin-in {
          0% {
            opacity: 0;
            transform: translateY(0.55em) skewX(-7deg) scale(0.92);
            filter: blur(6px);
          }
          55% {
            opacity: 1;
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translateY(0) skewX(0) scale(1);
            filter: blur(0);
          }
        }

        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        @media (prefers-reduced-motion: reduce) {
          .worldwide-text {
            transition: none;
          }
          .worldwide-wrap {
            transition: none;
          }
          .kin-char {
            animation: none;
          }
        }
      `}</style>
    </span>
  )
}
