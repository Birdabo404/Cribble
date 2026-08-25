'use client'

// The hero's rotating "worldwide" word, rebuilt on the shared GSAP runtime.
// The old version transitioned `width` (layout work every animated frame),
// declared will-change: width, blurred on every fade, ran a per-character
// CSS keyframe entrance, and re-measured via getBoundingClientRect in a
// layout effect on every swap plus its own resize listener. Now:
//
//  · English "worldwide" renders statically until the runtime arms; the
//    still tier (reduced motion) never publishes it, so that word simply
//    stays — zero animation, matching the old reduced-motion behavior.
//  · Every swap is a whole-word transform+opacity tween. Whole-word on
//    purpose: the roster spans RTL scripts (Arabic, Hebrew) and grapheme
//    clusters (Hindi), where per-character animation is exactly the
//    fragile path — so the grapheme splitter is gone with it.
//  · Width gets ONE discrete write per swap, taken while the word is
//    invisible, so the accent underline on .worldwide-anchor keeps
//    tracking the word's box. Words wider than the column scale down via
//    transform, replacing the old --ww-scale plumbing. No resize listener:
//    the next swap (≤6s) re-measures anyway.

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
  { text: 'दुनिया भर में', font: 'font-hindi' }
]

const HOLD_ENGLISH_S = 6
const HOLD_OTHER_S = 3
const OUT_S = 0.3
const IN_S = 0.46

export default function WorldwideText() {
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const wordRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (landingTier() === 'still') return
    const wrap = wrapRef.current
    const word = wordRef.current
    if (!wrap || !word) return

    let index = 0
    let currentFont = languages[0].font
    let swap: TimelineInstance | null = null
    let hold: DelayedCallInstance | null = null
    let gsapRef: GsapCore | null = null

    // Swaps the text/font/direction and performs the single discrete width
    // write of the cycle, all while the word is hidden. offsetWidth (layout
    // px), not getBoundingClientRect (visual px): the hero sits under
    // `zoom: 0.9`, and a rect-based measure gets shrunk a second time when
    // written back as style.width. Returns the glyph scale for words wider
    // than the column (the anchor's parent block).
    const applyLanguage = (lang: Language): number => {
      word.classList.remove(currentFont)
      word.classList.add(lang.font)
      currentFont = lang.font
      word.dir = lang.direction ?? 'ltr'
      word.textContent = lang.text
      const natural = word.offsetWidth + 1
      const available = wrap.parentElement?.parentElement?.clientWidth ?? natural
      wrap.style.width = `${Math.min(natural, available)}px`
      return natural > available ? available / natural : 1
    }

    const off = onLandingRuntime(({ motion }) => {
      if (gsapRef) return
      const { gsap } = motion
      gsapRef = gsap

      // GSAP owns this span's text and transforms directly — React renders
      // the English word once and never re-renders it, so nothing here can
      // race a render (the reason the pin also exits this block whole).
      function cycle() {
        const next = (index + 1) % languages.length
        swap = gsap.timeline({ onComplete: queueNext })
        swap.to(word, {
          autoAlpha: 0,
          y: -10,
          duration: OUT_S,
          ease: 'power2.in'
        })
        swap.add(() => {
          index = next
          const scale = applyLanguage(languages[next])
          gsap.set(word, { scale, transformOrigin: 'left center' })
        })
        swap.fromTo(
          word,
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: IN_S, ease: CRIBBLE_EASE_NAME }
        )
      }
      function queueNext() {
        hold = gsap.delayedCall(
          index === 0 ? HOLD_ENGLISH_S : HOLD_OTHER_S,
          cycle
        )
      }
      queueNext()
    })

    return () => {
      off()
      hold?.kill()
      swap?.kill()
      gsapRef?.set(word, { clearProps: 'all' })
      wrap.style.width = ''
    }
  }, [])

  return (
    <span ref={wrapRef} className="worldwide-wrap">
      <span ref={wordRef} className="worldwide-text font-english">
        worldwide
      </span>

      <style jsx global>{`
        .worldwide-wrap {
          position: relative;
          display: inline-block;
          vertical-align: baseline;
          max-width: 100%;
          line-height: 1.05;
          color: var(--accent);
          text-shadow: 0 0 14px rgb(var(--accent-rgb) / 0.18);
        }
        .worldwide-text {
          display: inline-block;
          white-space: nowrap;
          letter-spacing: -0.01em;
          transform-origin: left center;
        }

        /* English-specific tuning — editorial serif italic, the signature
           moment of the rotation. Deliberate contrast with the mono
           "cribble." wordmark above it. */
        .font-english {
          font-family: var(--font-serif-display), Georgia, serif;
          font-style: italic;
          font-weight: 400;
          letter-spacing: 0.005em;
        }
      `}</style>
    </span>
  )
}
