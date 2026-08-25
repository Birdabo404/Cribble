'use client'

// The rotating fourth slot in the hero's tool list, rebuilt on the shared
// GSAP runtime. The old version transitioned `width` (layout work every
// frame of every swap), blurred on exit, and re-measured in a layout effect
// per swap; now the word holds static ("Gemini") until the runtime arms,
// each swap is a whole-word transform+opacity tween, and the sentence
// reflows exactly once per swap — a single discrete layout change made
// while the word is invisible, which reads better mid-sentence than
// reserving the widest word's box ("Perplexity") behind "v0".
//
// The still tier never publishes the runtime, so reduced motion keeps the
// first word with zero animation — same as before.

import { useEffect, useRef } from 'react'
import {
  CRIBBLE_EASE_NAME,
  landingTier,
  onLandingRuntime,
  type LandingMotion
} from '@/lib/landingMotion'

type GsapCore = LandingMotion['gsap']
type TimelineInstance = ReturnType<GsapCore['timeline']>
type DelayedCallInstance = ReturnType<GsapCore['delayedCall']>

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

const HOLD_S = 2.4
const OUT_S = 0.16
const IN_S = 0.24

export function RotatingTool() {
  const wordRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (landingTier() === 'still') return
    const wordEl = wordRef.current
    if (!wordEl) return
    const word: HTMLSpanElement = wordEl

    let index = 0
    let swap: TimelineInstance | null = null
    let hold: DelayedCallInstance | null = null
    let gsapRef: GsapCore | null = null

    const off = onLandingRuntime(({ motion }) => {
      if (gsapRef) return
      const { gsap } = motion
      gsapRef = gsap

      // GSAP owns this span's text directly — React renders the first word
      // once and never re-renders it, so there is no state/tween race.
      function cycle() {
        swap = gsap.timeline({ onComplete: queueNext })
        swap.to(word, {
          autoAlpha: 0,
          y: -6,
          duration: OUT_S,
          ease: 'power2.in'
        })
        swap.add(() => {
          index = (index + 1) % ROTATING_TOOLS.length
          word.textContent = ROTATING_TOOLS[index]
        })
        swap.fromTo(
          word,
          { autoAlpha: 0, y: 7 },
          { autoAlpha: 1, y: 0, duration: IN_S, ease: CRIBBLE_EASE_NAME }
        )
      }
      function queueNext() {
        hold = gsap.delayedCall(HOLD_S, cycle)
      }
      queueNext()
    })

    return () => {
      off()
      hold?.kill()
      swap?.kill()
      gsapRef?.set(word, { clearProps: 'all' })
    }
  }, [])

  return (
    <span
      ref={wordRef}
      className="inline-block whitespace-nowrap border-b border-dashed font-medium"
      style={{
        color: 'var(--accent)',
        borderColor: 'rgb(var(--accent-rgb) / 0.45)'
      }}
    >
      {ROTATING_TOOLS[0]}
    </span>
  )
}
