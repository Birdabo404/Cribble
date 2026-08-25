'use client'

// The rotating fourth slot in the hero's tool list.
// Extracted verbatim from src/app/page.tsx.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// The fourth slot in the tool list cycles through the rest of the roster so
// the paragraph reads as live inventory instead of static marketing copy.
const ROTATING_TOOLS = [
  'Gemini',
  'Perplexity',
  'Copilot',
  'v0',
  'Windsurf',
  'DeepSeek',
  'Grok',
  'Lovable'
]

const ROTATE_HOLD_MS = 2400
const ROTATE_SWAP_MS = 240

export function RotatingTool() {
  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [width, setWidth] = useState<number | null>(null)
  const measureRef = useRef<HTMLSpanElement | null>(null)

  // Measure each word so the sentence reflows smoothly instead of jumping.
  // offsetWidth (layout px), not getBoundingClientRect (visual px): the
  // hero sits under `zoom: 0.9`, and a rect-based measure gets shrunk a
  // second time when written back as style.width — clipping every word.
  useLayoutEffect(() => {
    if (measureRef.current) {
      setWidth(measureRef.current.offsetWidth + 1)
    }
  }, [index])

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return

    let cancelled = false
    const timers: Array<ReturnType<typeof setTimeout>> = []

    const tick = () => {
      timers.push(
        setTimeout(() => {
          if (cancelled) return
          setLeaving(true)
          timers.push(
            setTimeout(() => {
              if (cancelled) return
              setIndex((v) => (v + 1) % ROTATING_TOOLS.length)
              setLeaving(false)
              tick()
            }, ROTATE_SWAP_MS)
          )
        }, ROTATE_HOLD_MS)
      )
    }
    tick()

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <span
      className="rt-wrap"
      style={{ width: width != null ? `${width}px` : 'auto' }}
    >
      <span ref={measureRef} aria-hidden className="rt-measure">
        {ROTATING_TOOLS[index]}
      </span>
      <span className={`rt-word ${leaving ? 'is-out' : ''}`}>
        {ROTATING_TOOLS[index]}
      </span>

      <style jsx>{`
        .rt-wrap {
          position: relative;
          display: inline-block;
          vertical-align: baseline;
          white-space: nowrap;
          transition: width ${ROTATE_SWAP_MS + 80}ms
            cubic-bezier(0.22, 1, 0.36, 1);
        }
        .rt-measure {
          position: absolute;
          left: 0;
          top: 0;
          visibility: hidden;
          pointer-events: none;
          font-weight: 500;
        }
        .rt-word {
          display: inline-block;
          font-weight: 500;
          color: var(--accent);
          border-bottom: 1px dashed rgb(var(--accent-rgb) / 0.45);
          transition:
            opacity ${ROTATE_SWAP_MS}ms ease,
            transform ${ROTATE_SWAP_MS}ms ease,
            filter ${ROTATE_SWAP_MS}ms ease;
        }
        .rt-word.is-out {
          opacity: 0;
          transform: translateY(-5px);
          filter: blur(3px);
        }
        @media (prefers-reduced-motion: reduce) {
          .rt-wrap,
          .rt-word {
            transition: none;
          }
        }
      `}</style>
    </span>
  )
}
