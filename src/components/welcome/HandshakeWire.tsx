'use client'

// The LINK phase's instrument: this device on the left, cribble.dev on the
// right, one hairline between them. The wire mirrors the extension popup's
// own link screen (popup.js, `handshake`) beat for beat — SYN 0.00→0.55s,
// SYN·ACK 0.70→1.25s, ACK 1.40→1.80s, the same three log lines — so the
// web page and the popup read as one device talking to itself.
//
// GSAP owns the choreography (pulses, node wake, wire energize, the linked
// travelling light); anime.js owns the log line's typewriter, the same
// split the AI board uses. Every state consults welcomeMotionReduced() and
// lands on its resting frame instantly: no loops, no typing.
//
// Everything that moves is transform, opacity or a stroke property. The
// pulses are full-width wrappers translated by xPercent, so the wire stays
// fluid without a single measured pixel.

import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { animate, splitText, stagger, steps } from 'animejs'
import {
  CRIBBLE_EASE,
  IDLE_LOOP,
  gsapLoop,
  parkOnHidden,
  welcomeMotionReduced,
  type Loop
} from '@/components/welcome/welcomeMotion'

/** `unverified` is the fail-open frame: the extension answered but the
 *  page never learned who it is signed in as, so nothing can be sealed
 *  here. Static — no volley to play, no failure to mark. */
export type HandshakeWireState =
  | 'idle'
  | 'linking'
  | 'linked'
  | 'failed'
  | 'unverified'

const DEVICE_LABEL = 'this device'
const HOST_LABEL = 'cribble.dev'

/* Popup timings, seconds from the start of the volley. */
const SYN = { t0: 0.0, t1: 0.55 }
const SYN_ACK = { t0: 0.7, t1: 1.25 }
const ACK = { t0: 1.4, t1: 1.8 }

/* Travelling light period once linked — the popup's 0.45 cycles/s, rounded. */
const LIGHT_PERIOD_S = 2.4

const LINE_SYN = '→ SYN · requesting link'
const LINE_SYN_ACK = `← SYN·ACK · ${HOST_LABEL} answered`
const LINE_ACK = '→ ACK · sealing the link'

/** What the log reads before any motion, per state. Rendered by React so
 *  the server frame and the reduced-motion frame are the same markup;
 *  the volley types its three lines over LINKING. */
const RESTING_LOG: Record<HandshakeWireState, string> = {
  idle: 'awaiting extension…',
  linking: 'LINKING',
  linked: 'LINKED',
  failed: 'LINK FAILED',
  unverified: 'LINK UNVERIFIED'
}

const LOG_TONE: Record<HandshakeWireState, string> = {
  idle: 'text-zinc-500',
  linking: 'text-zinc-300',
  linked: 'text-accent',
  failed: 'text-zinc-300',
  unverified: 'text-zinc-400'
}

/* Pointy-top hexagon on a 28px grid, r = 11 and r = 5.5. */
const HEX_OUTER = '14,3 23.53,8.5 23.53,19.5 14,25 4.47,19.5 4.47,8.5'
const HEX_INNER = '14,8.5 18.76,11.25 18.76,16.75 14,19.5 9.24,16.75 9.24,11.25'

export function HandshakeWire({ state }: { state: HandshakeWireState }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const root = rootRef.current
      const log = logRef.current
      if (!root || !log) return
      const q = gsap.utils.selector(root)
      const reduced = welcomeMotionReduced()

      const dashed = q('.hw-wire-dashed')
      const solid = q('.hw-wire-solid')
      const glow = q('.hw-wire-glow')
      const orb = q('.hw-orb')
      const hexDim = q('.hw-hex-dim')
      const hexLit = q('.hw-hex-lit')
      const bloom = q('.hw-host-bloom')
      const flashDevice = q('.hw-flash-device')
      const flashHost = q('.hw-flash-host')
      const pulseFwd = q('.hw-pulse-fwd')
      const pulseRev = q('.hw-pulse-rev')
      const light = q('.hw-light')
      const breakMark = q('.hw-break')

      // Typewriter (anime.js). Replaces the line rather than appending:
      // revert the previous split so the <samp> holds one whole text node
      // again, write the new text, split, and step the glyphs in at 12ms
      // apiece — a terminal writes characters, it does not fade them.
      let typing: Loop = IDLE_LOOP
      const typeLine = (text: string) => {
        typing.revert()
        typing = IDLE_LOOP
        log.textContent = text
        if (reduced) return
        const split = splitText(log, { chars: true, words: true, lines: false })
        const chars = split.chars as HTMLElement[]
        // Hide before anime's first tick, or the line flashes whole for a frame.
        for (const char of chars) char.style.opacity = '0'
        const anim = animate(chars, {
          opacity: [0, 1],
          duration: 12,
          delay: stagger(12),
          ease: steps(1)
        })
        typing = {
          pause: () => anim.pause(),
          resume: () => anim.resume(),
          revert: () => {
            anim.revert()
            split.revert()
          }
        }
      }
      const typingLoop: Loop = {
        pause: () => typing.pause(),
        resume: () => typing.resume(),
        revert: () => typing.revert()
      }

      // Arrival ripple at a node: a hairline ring expanding and fading.
      // fromTo() renders its start values the moment it is created; every
      // tween placed later in the volley waits for its own start instead,
      // or the ring would sit visible from t = 0.
      const flash = (
        tl: gsap.core.Timeline,
        ring: Element[],
        at: number
      ) => {
        tl.fromTo(
          ring,
          { scale: 0.6, autoAlpha: 0.8 },
          {
            scale: 1.9,
            autoAlpha: 0,
            duration: 0.5,
            ease: 'power2.out',
            immediateRender: false
          },
          at
        )
      }

      // Dashes drift device → host while the wire is still probing (the
      // popup's `lineDashOffset = -t * 14`). Pattern period is 8, so a
      // full -8 offset loops seamlessly.
      const driftDashes = () =>
        gsap.to(dashed, {
          strokeDashoffset: -8,
          duration: 8 / 14,
          ease: 'none',
          repeat: -1
        })

      if (state === 'idle') {
        if (reduced) return
        // Idle animation: the orb breathes, the dashes drift. Nothing else.
        const breathe = gsap.to(orb, {
          opacity: 0.5,
          duration: 1.4,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1
        })
        return parkOnHidden([gsapLoop(breathe), gsapLoop(driftDashes())])
      }

      // The resting frame is the whole picture: dashed wire, dim host.
      if (state === 'unverified') return

      if (state === 'linking') {
        if (reduced) return
        typeLine(LINE_SYN)
        const tl = gsap.timeline({ defaults: { ease: CRIBBLE_EASE } })

        // SYN — device → host. Travel is ease-in-out (a packet already on
        // screen), the popup's own curve.
        tl.fromTo(
          pulseFwd,
          { xPercent: 0, autoAlpha: 1 },
          { xPercent: 100, duration: SYN.t1 - SYN.t0, ease: 'power2.inOut' },
          SYN.t0
        )
        tl.to(pulseFwd, { autoAlpha: 0, duration: 0.1 }, SYN.t1)
        flash(tl, flashHost, SYN.t1)
        // First contact wakes the host: dashed dim hex crossfades to lit.
        tl.to(hexDim, { autoAlpha: 0, duration: 0.25 }, SYN.t1)
        tl.to(hexLit, { autoAlpha: 1, duration: 0.25 }, SYN.t1)

        // SYN·ACK — host → device.
        tl.call(() => typeLine(LINE_SYN_ACK), [], SYN_ACK.t0)
        tl.fromTo(
          pulseRev,
          { xPercent: 100, autoAlpha: 1 },
          {
            xPercent: 0,
            duration: SYN_ACK.t1 - SYN_ACK.t0,
            ease: 'power2.inOut',
            immediateRender: false
          },
          SYN_ACK.t0
        )
        tl.to(pulseRev, { autoAlpha: 0, duration: 0.1 }, SYN_ACK.t1)
        flash(tl, flashDevice, SYN_ACK.t1)
        // The orb excites on the answer: a quick swell and settle.
        tl.to(
          orb,
          { scale: 1.18, duration: 0.14, ease: 'power2.out', yoyo: true, repeat: 1 },
          SYN_ACK.t1
        )

        // ACK — device → host, snappier.
        tl.call(() => typeLine(LINE_ACK), [], ACK.t0)
        tl.fromTo(
          pulseFwd,
          { xPercent: 0, autoAlpha: 1 },
          {
            xPercent: 100,
            duration: ACK.t1 - ACK.t0,
            ease: 'power3.inOut',
            immediateRender: false
          },
          ACK.t0
        )
        tl.to(pulseFwd, { autoAlpha: 0, duration: 0.1 }, ACK.t1)
        flash(tl, flashHost, ACK.t1)
        // The wire starts to carry: half-energy solid line under the
        // dashes, held there until the parent flips the state to linked.
        tl.to(solid, { autoAlpha: 0.45, duration: 0.3 }, ACK.t1)
        tl.to(dashed, { autoAlpha: 0.35, duration: 0.3 }, ACK.t1)

        return parkOnHidden([
          gsapLoop(tl),
          gsapLoop(driftDashes()),
          typingLoop
        ])
      }

      if (state === 'linked') {
        if (reduced) {
          gsap.set([dashed, hexDim], { autoAlpha: 0 })
          gsap.set([solid, glow, hexLit, bloom], { autoAlpha: 1 })
          return
        }
        // Energize: dashes give way to the solid wire, the host blooms.
        const tl = gsap.timeline({ defaults: { ease: CRIBBLE_EASE } })
        tl.to(dashed, { autoAlpha: 0, duration: 0.25 }, 0)
        tl.to(hexDim, { autoAlpha: 0, duration: 0.25 }, 0)
        tl.to([solid, glow], { autoAlpha: 1, duration: 0.3 }, 0)
        tl.to(hexLit, { autoAlpha: 1, duration: 0.25 }, 0)
        tl.fromTo(
          bloom,
          { autoAlpha: 0, scale: 0.8 },
          { autoAlpha: 1, scale: 1, duration: 0.4 },
          0.1
        )
        // Travelling light: constant motion, so linear; parks on hidden.
        const travel = gsap.fromTo(
          light,
          { xPercent: 0, autoAlpha: 1 },
          {
            xPercent: 100,
            duration: LIGHT_PERIOD_S,
            ease: 'none',
            repeat: -1
          }
        )
        return parkOnHidden([gsapLoop(tl), gsapLoop(travel)])
      }

      // failed — the dashed wire stays, with a hairline break mid-span.
      gsap.set(orb, { opacity: 0.6 })
      if (reduced) {
        gsap.set(breakMark, { autoAlpha: 1 })
        return
      }
      // Pop in from 0.9, never from nothing.
      gsap.fromTo(
        breakMark,
        { autoAlpha: 0, scale: 0.9 },
        { autoAlpha: 1, scale: 1, duration: 0.2, ease: CRIBBLE_EASE }
      )
    },
    { scope: rootRef, dependencies: [state], revertOnUpdate: true }
  )

  return (
    <div
      ref={rootRef}
      data-state={state}
      className="relative h-[84px] w-full select-none"
    >
      <span className="absolute left-0 top-0 font-mono text-[8px] uppercase tracking-[0.25em] text-zinc-600">
        {DEVICE_LABEL}
      </span>
      <span className="absolute right-0 top-0 font-mono text-[8px] uppercase tracking-[0.25em] text-zinc-600">
        {HOST_LABEL}
      </span>

      <div className="absolute inset-x-0 top-[14px] flex h-11 items-center">
        {/* Device orb — lit from the start: this machine is the one talking. */}
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
          <span className="hw-flash-device invisible absolute h-6 w-6 rounded-full border border-accent/60 opacity-0" />
          <span
            className="hw-orb h-3 w-3 rounded-full bg-accent/90"
            style={{ boxShadow: '0 0 10px rgb(var(--accent-rgb) / 0.55)' }}
          />
        </div>

        {/* Wire. The track clips the pulse trails at both ends. */}
        <div className="relative h-11 flex-1 overflow-hidden">
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            <line
              className="hw-wire-dashed text-zinc-700"
              x1="0"
              y1="50%"
              x2="100%"
              y2="50%"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="3 5"
            />
            <line
              className="hw-wire-glow invisible text-accent opacity-0"
              x1="0"
              y1="50%"
              x2="100%"
              y2="50%"
              stroke="currentColor"
              strokeWidth="3"
              strokeOpacity="0.18"
            />
            <line
              className="hw-wire-solid invisible text-accent opacity-0"
              x1="0"
              y1="50%"
              x2="100%"
              y2="50%"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity="0.85"
            />
          </svg>

          {/* Pulses: full-width wrappers, translated by their own width so
              the dot runs end to end at any track width. */}
          <span className="hw-pulse-fwd invisible absolute left-0 top-1/2 h-0 w-[calc(100%-6px)] opacity-0">
            <PulseDot direction="fwd" />
          </span>
          <span className="hw-pulse-rev invisible absolute left-0 top-1/2 h-0 w-[calc(100%-6px)] opacity-0">
            <PulseDot direction="rev" />
          </span>
          <span className="hw-light invisible absolute left-0 top-1/2 h-0 w-[calc(100%-4px)] opacity-0">
            <span
              className="absolute left-0 top-0 h-1 w-1 -translate-y-1/2 rounded-full bg-accent"
              style={{ boxShadow: '0 0 6px 2px rgb(var(--accent-rgb) / 0.55)' }}
            />
            <span
              className="absolute right-full top-0 h-px w-10 -translate-y-1/2"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgb(var(--accent-rgb) / 0.6))'
              }}
            />
          </span>

          {/* Break mark — the schematic double slash for a cut wire. The
              outer span centers with CSS; GSAP only touches the inner one. */}
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="hw-break invisible block text-zinc-400 opacity-0">
              <svg
                viewBox="0 0 14 16"
                width="14"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M3 14 7 2" />
                <path d="M7 14 11 2" />
              </svg>
            </span>
          </span>
        </div>

        {/* Host hex — dormant dashed outline until first contact. */}
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
          <span
            className="hw-host-bloom invisible absolute h-7 w-7 rounded-full opacity-0"
            style={{ boxShadow: '0 0 18px rgb(var(--accent-rgb) / 0.45)' }}
          />
          <svg
            viewBox="0 0 28 28"
            className="relative h-7 w-7 overflow-visible"
            aria-hidden
          >
            <g className="hw-hex-dim text-zinc-600">
              <polygon
                points={HEX_OUTER}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle cx="14" cy="14" r="1.6" fill="currentColor" />
            </g>
            <g className="hw-hex-lit invisible text-accent opacity-0">
              <polygon
                points={HEX_OUTER}
                fill="currentColor"
                fillOpacity="0.12"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <polygon points={HEX_INNER} fill="currentColor" fillOpacity="0.7" />
            </g>
          </svg>
          <span className="hw-flash-host invisible absolute h-7 w-7 rounded-full border border-accent/60 opacity-0" />
        </div>
      </div>

      {/* Screen readers get the resting line from a stable live region;
          the typed line below is texture, and a replaced element would
          not announce anyway. */}
      <span className="sr-only" aria-live="polite">
        {RESTING_LOG[state]}
      </span>

      {/* Log. Keyed on state so React hands anime a fresh element each
          time and never reconciles a text node the splitter has replaced. */}
      <samp
        key={state}
        ref={logRef}
        aria-hidden
        className={`absolute inset-x-0 bottom-0 block truncate text-center font-mono text-[10px] tracking-[0.3em] ${LOG_TONE[state]}`}
        style={
          state === 'linked'
            ? { textShadow: '0 0 8px rgb(var(--accent-rgb) / 0.5)' }
            : undefined
        }
      >
        {RESTING_LOG[state]}
      </samp>
    </div>
  )
}

/** A packet head with a short trail behind it. The wrapper it sits in is
 *  translated end to end, so the dot itself stays at x = 0. */
function PulseDot({ direction }: { direction: 'fwd' | 'rev' }) {
  const trailSide = direction === 'fwd' ? 'right-full' : 'left-[6px]'
  const trailFade =
    direction === 'fwd'
      ? 'linear-gradient(90deg, transparent, rgb(var(--accent-rgb) / 0.7))'
      : 'linear-gradient(270deg, transparent, rgb(var(--accent-rgb) / 0.7))'
  return (
    <>
      <span
        className="absolute left-0 top-0 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent"
        style={{ boxShadow: '0 0 8px rgb(var(--accent-rgb) / 0.8)' }}
      />
      <span
        className={`absolute ${trailSide} top-0 h-px w-7 -translate-y-1/2`}
        style={{ background: trailFade }}
      />
    </>
  )
}
