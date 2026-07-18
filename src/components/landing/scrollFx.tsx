'use client'

// Shared scroll machinery for the landing page's below-the-fold "descent".
//
// Design constraints (match the rest of the codebase — no animation libs):
//  · One passive scroll listener + one rAF drives every scrub element.
//    Progress lands in the element's `--p` custom property, so all scrub
//    math stays in CSS (clamp/calc on transform + opacity only).
//  · Entrance choreography is progressive enhancement: SSR/no-JS renders
//    the final state; a pre-paint layout effect "arms" a stage (hides its
//    `.st` children), and an IntersectionObserver flips it "live", firing
//    the staggered entrance. prefers-reduced-motion never arms anything.
//  · Components that animate values (CountUp, DecodeText, live tickers)
//    read the surrounding Stage via context and start when it goes live.

import {
  createContext,
  CSSProperties,
  ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { prefersReducedMotion } from '@/lib/motion'

/* ------------------------------------------------------------------ */
/* Scroll-scrub manager                                                */
/* ------------------------------------------------------------------ */

type ScrubEntry = { el: HTMLElement }

const SCRUBS = new Set<ScrubEntry>()
let scrubRaf = 0
let scrubListening = false

function measureOne(el: HTMLElement, vh: number) {
  const r = el.getBoundingClientRect()
  const total = vh + r.height
  const raw = total > 0 ? (vh - r.top) / total : 1
  const p = raw < 0 ? 0 : raw > 1 ? 1 : raw
  el.style.setProperty('--p', p.toFixed(4))
}

function scrubMeasureAll() {
  scrubRaf = 0
  const vh = window.innerHeight
  SCRUBS.forEach((s) => measureOne(s.el, vh))
}

function scrubSchedule() {
  if (!scrubRaf) scrubRaf = requestAnimationFrame(scrubMeasureAll)
}

function scrubListen() {
  if (scrubListening) return
  scrubListening = true
  window.addEventListener('scroll', scrubSchedule, { passive: true })
  window.addEventListener('resize', scrubSchedule)
}

/* ------------------------------------------------------------------ */
/* Stage — arms/reveals a subtree, optionally scroll-scrubbed          */
/* ------------------------------------------------------------------ */

const StageCtx = createContext(false)

/** True once the nearest Stage has entered the viewport (and motion is
 * allowed). Value components use it as their "go" signal. */
export const useStageLive = () => useContext(StageCtx)

export function Stage({
  id,
  className = '',
  scrub = false,
  children,
  style
}: {
  id?: string
  className?: string
  /** Also feed scroll progress into this element's `--p` (0..1). */
  scrub?: boolean
  children: ReactNode
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<'idle' | 'armed' | 'live'>('idle')

  // Arm before first client paint so the entrance can't flash.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    setPhase('armed')

    let entry: ScrubEntry | null = null
    if (scrub) {
      // Seed --p synchronously — the first painted frame must already sit
      // at the correct scroll pose, not jump into it.
      measureOne(el, window.innerHeight)
      entry = { el }
      SCRUBS.add(entry)
      scrubListen()
    }

    // threshold 0 + a negative bottom rootMargin: fires once ~22% of the
    // viewport height of the section has scrolled in. A fractional
    // threshold would never fire for sections taller than the viewport.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase('live')
          io.disconnect()
        }
      },
      { threshold: 0, rootMargin: '0px 0px -22% 0px' }
    )
    io.observe(el)

    return () => {
      io.disconnect()
      if (entry) SCRUBS.delete(entry)
    }
  }, [scrub])

  return (
    <div
      ref={ref}
      id={id}
      style={style}
      className={`${className} ${
        phase === 'armed' ? 'stage-armed' : phase === 'live' ? 'stage-live' : ''
      }`}
    >
      <StageCtx.Provider value={phase === 'live'}>{children}</StageCtx.Provider>

      {/* Entrance vocabulary — shared by every section. styled-jsx dedupes
          identical global blocks, so many Stages cost one stylesheet. */}
      <style jsx global>{`
        .stage-armed .st,
        .stage-armed .st-cell,
        .stage-armed .st-grow,
        .stage-armed .st-sweep {
          opacity: 0;
        }
        .stage-live .st {
          animation: st-rise 700ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes st-rise {
          from {
            opacity: 0;
            transform: translateY(var(--st-rise, 16px));
            filter: blur(var(--st-blur, 6px));
          }
        }
        /* Phones: dozens of staggered blur animations per stage overwhelm
           mobile GPUs mid-scroll — keep the rise, shrink the blur. */
        @media (max-width: 639px) {
          .stage-live .st {
            --st-blur: 3px;
            --st-rise: 12px;
          }
        }
        .stage-live .st-cell {
          animation: st-cell 520ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes st-cell {
          from {
            opacity: 0;
            transform: scale(0.3);
          }
        }
        .stage-live .st-grow {
          transform-origin: left center;
          animation: st-grow 900ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes st-grow {
          from {
            transform: scaleX(0);
          }
        }
        .stage-live .st-sweep {
          animation: st-sweep 1100ms cubic-bezier(0.65, 0, 0.35, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes st-sweep {
          from {
            clip-path: inset(0 100% 0 0);
          }
          to {
            clip-path: inset(0 0 0 0);
          }
        }
      `}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* DecodeText — terminal scramble that resolves left to right          */
/* ------------------------------------------------------------------ */

const DECODE_GLYPHS = '█▓▒░<>/[]{}=+*#'

export function DecodeText({
  text,
  delay = 0,
  className = ''
}: {
  text: string
  delay?: number
  className?: string
}) {
  const live = useStageLive()
  const [out, setOut] = useState(text)
  const [decoding, setDecoding] = useState(false)

  useEffect(() => {
    if (!live || prefersReducedMotion()) return
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
  }, [live, text, delay])

  return (
    <span
      className={className}
      data-decoding={decoding ? '' : undefined}
      style={decoding ? { color: 'rgb(var(--accent-rgb) / 0.9)' } : undefined}
    >
      {out}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* CountUp — value odometer, fires when the stage goes live            */
/* ------------------------------------------------------------------ */

export function CountUp({
  to,
  duration = 1500,
  delay = 0,
  format = (n: number) => n.toLocaleString('en-US'),
  className = ''
}: {
  to: number
  duration?: number
  delay?: number
  format?: (n: number) => string
  className?: string
}) {
  const live = useStageLive()
  const [v, setV] = useState(to) // SSR/no-JS shows the final value
  const rafRef = useRef(0)

  useEffect(() => {
    if (!live || prefersReducedMotion()) return
    setV(0)
    let start = 0
    const step = (now: number) => {
      if (!start) start = now
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(2, -10 * t) // easeOutExpo
      setV(Math.round(to * (t === 1 ? 1 : eased)))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    const timer = setTimeout(() => {
      rafRef.current = requestAnimationFrame(step)
    }, delay)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(rafRef.current)
    }
  }, [live, to, duration, delay])

  return <span className={className}>{format(v)}</span>
}

/* ------------------------------------------------------------------ */
/* Section grammar — header, seams, corner ticks                       */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  index,
  code,
  title,
  serif,
  body,
  annotation,
  align = 'left'
}: {
  index: string
  code: string
  title: ReactNode
  serif: ReactNode
  body?: ReactNode
  annotation?: string
  align?: 'left' | 'center'
}) {
  const center = align === 'center'
  return (
    <div className={center ? 'flex flex-col items-center text-center' : ''}>
      <div
        className={`st flex items-baseline gap-4 text-[10px] tracking-[0.32em] text-zinc-500 ${
          center ? 'justify-center' : 'justify-between'
        }`}
        style={{ '--d': '0ms' } as CSSProperties}
      >
        <span className="whitespace-nowrap">
          <span style={{ color: 'var(--accent)' }}>{index}</span>
          <span className="text-zinc-700">{' // '}</span>
          <DecodeText text={code} delay={120} />
        </span>
        {annotation && !center && (
          <span className="hidden text-[9px] tracking-[0.3em] text-zinc-700 md:block">
            {annotation}
          </span>
        )}
      </div>

      <h2
        className="st mt-5 font-display text-4xl font-semibold leading-[0.98] tracking-tight text-zinc-50 md:text-[3.4rem]"
        style={{ '--d': '90ms' } as CSSProperties}
      >
        {title}
      </h2>

      <div
        className="st mt-3 font-serif italic text-2xl leading-snug text-zinc-400 md:text-[1.9rem]"
        style={{ '--d': '180ms' } as CSSProperties}
      >
        {serif}
      </div>

      <span
        className={`st-grow mt-6 block h-px w-24 ${center ? 'mx-auto' : ''}`}
        style={
          {
            '--d': '240ms',
            background:
              'linear-gradient(90deg, rgb(var(--accent-rgb) / 0.9), rgb(var(--accent-rgb) / 0.05))'
          } as CSSProperties
        }
      />

      {body && (
        <p
          className={`st mt-6 max-w-xl font-sans text-base leading-[1.75] text-zinc-400 sm:text-[15px] sm:leading-[1.8] ${
            center ? 'mx-auto' : ''
          }`}
          style={{ '--d': '280ms' } as CSSProperties}
        >
          {body}
        </p>
      )}
    </div>
  )
}

/** Telemetry seam — the thin HUD chatter line that opens each section and
 * keeps score of the descent (altitude falls section by section). The
 * readout may wrap on narrow phones (nowrap used to push it past the
 * viewport edge and give the whole page a horizontal wobble). */
export function Seam({ alt, note }: { alt: string; note: string }) {
  return (
    <div
      className="st flex items-center gap-3 sm:gap-4 text-[9px] tracking-[0.3em] text-zinc-600"
      style={{ '--d': '0ms' } as CSSProperties}
    >
      <span className="lx-seamline h-px flex-1 bg-zinc-800/70" />
      <span className="flex min-w-0 items-center gap-3">
        <span style={{ color: 'rgb(var(--accent-rgb) / 0.65)' }}>+</span>
        <span className="text-center leading-relaxed sm:whitespace-nowrap">
          ALT {alt} · {note}
        </span>
        <span style={{ color: 'rgb(var(--accent-rgb) / 0.65)' }}>+</span>
      </span>
      <span className="lx-seamline h-px flex-1 bg-zinc-800/70" />
    </div>
  )
}

/** Blueprint corner ticks — mount inside any `relative` panel. */
export function CornerTicks({ className = '' }: { className?: string }) {
  const tick = 'absolute text-[11px] leading-none text-zinc-700 select-none'
  return (
    <span aria-hidden className={className}>
      <span className={`${tick} -left-1.5 -top-2`}>+</span>
      <span className={`${tick} -right-1.5 -top-2`}>+</span>
      <span className={`${tick} -left-1.5 -bottom-2`}>+</span>
      <span className={`${tick} -right-1.5 -bottom-2`}>+</span>
    </span>
  )
}
