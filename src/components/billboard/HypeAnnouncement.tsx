'use client'

// The takeover body of BillboardTicker's hype layer. The ticker keeps
// every bit of scheduling (phases, holds, flip mechanics, the Link
// wrapper and layer keys); this component owns the broadcast staging:
// a full-bleed bed (outline marquee + WebGL gold caustic) with the
// content zones aligned mx-auto max-w-6xl over it, so the card lines up
// with the board below instead of floating in unclaimed width. Below sm
// it collapses to the original two-line strip — the bed and the extra
// zones are desktop furniture, and phones never spend a WebGL context
// on them.
//
// Preserved anatomy: same strip padding, 3px gold left stripe and
// avatar seat as BillboardCard's lg shape, so ad-to-hype flips hinge on
// consistent geometry.
//
// The sting rides the flip-in, all inside the first ~1.4s of the 30s
// hype hold (no cadence-contract changes): username decode from 150ms,
// word build staggered ~40ms per word, the rank reel rolling DOWN
// through the intermediate ranks from 500ms, and the land beat at
// ~1100ms — overshoot bloom on the number plus the shader bed's
// one-shot shockwave (the `burst` counter increments exactly once per
// flip-in mount).
//
// `animate` is the ticker's arm signal (open && !leaving). False renders
// the resolved state — the leaving copy and pre-open mounts both land
// there. Reduced motion (OS media query or the in-app data-motion
// toggle) also resolves everything up front: no decode interval, no
// reel timers, no marquee drift, no shader mount.

import type { CSSProperties } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { formatRelative } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import { billboardHypeSentence, billboardRankClimb, hypeRankLadder } from '@/lib/billboard'
import type { BillboardHypeItem } from '@/lib/billboard'
import { prefersReducedMotion } from '@/lib/motion'
import { useDecode } from '@/lib/useDecode'

// WebGL bed — client-only, and it owns the WebGL2 probe internally; this
// component owns the sm-and-up / reduced-motion / armed gating around it.
const HypeShaderBed = dynamic(() => import('@/components/billboard/HypeShaderBed'), {
  ssr: false
})

/* Sting timeline, ms from the arm signal (≈ flip-in start). */
const DECODE_DELAY_MS = 150
const KIN_BASE_MS = 260
const KIN_STAGGER_MS = 40
const REEL_START_MS = 500
const REEL_ROLL_MS = 600
/** The land beat: reel settles, bloom fires, shader shockwave launches. */
const LAND_MS = REEL_START_MS + REEL_ROLL_MS

const REEL_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'

/** Shader origin (0..1 across the bed) until the avatar anchor is first
 *  measured — roughly where the anchor sits on a desktop banner. */
const ORIGIN_FALLBACK = 0.08

/** Sentence words for the kinetic build; the gold "TOP 3" lands last. */
const KIN_WORDS = ['just', 'entered', 'the']

/** One marquee copy — repeated wide enough that the seamless -50% wrap
 *  never shows a hole on wide desktop banners. NBSPs so the trailing
 *  separator's spacing survives HTML whitespace collapsing. */
const MARQUEE_COPY = 'TOP 3\u00A0·\u00A0'.repeat(14)

/** OS media query plus the in-app Appearance toggle — the JS-driven
 *  motion here (decode interval, reel timers, shader) honors both, like
 *  the dither-kit canvases do. */
function motionReducedNow(): boolean {
  if (typeof window === 'undefined') return false
  return prefersReducedMotion() || document.documentElement.dataset.motion === 'reduced'
}

// Downward-rolling rank reel modeled on ScoreOdometer's DigitReel, with
// whole ranks per rung (1-2 digits) instead of single digits. The
// destination stacks on top and the strip starts parked at the bottom
// rung (the old rank), so engaging translates the numbers DOWN through
// the window — the motion literally reads as climbing. Width pinned in
// ch so the tabular numerals can't jitter the row; when not animating
// (leaving copy, reduced motion) it rests resolved on the destination.
function RankReel({
  ladder,
  engaged,
  animating
}: {
  ladder: number[]
  engaged: boolean
  animating: boolean
}) {
  const steps = ladder.length - 1
  const rungs = [...ladder].reverse()
  const resting = !animating || steps === 0
  return (
    <span
      className="inline-block overflow-hidden text-center"
      style={{ height: '1em', width: `${String(ladder[0]).length}ch` }}
    >
      <span
        className="block"
        style={{
          transform: resting || engaged ? 'translateY(0)' : `translateY(-${steps}em)`,
          // The transition only arms alongside `engaged`, so the parked
          // pose lands as a snap, never an upward counter-roll.
          transition:
            !resting && engaged ? `transform ${REEL_ROLL_MS}ms ${REEL_EASING}` : 'none',
          willChange: resting ? undefined : 'transform'
        }}
      >
        {rungs.map((rank, n) => (
          <span key={n} className="block" style={{ height: '1em', lineHeight: 1 }}>
            {rank}
          </span>
        ))}
      </span>
    </span>
  )
}

export function HypeAnnouncement({
  item,
  animate,
  paused,
  className = ''
}: {
  item: BillboardHypeItem
  /** The ticker's arm signal (open && !leaving) — false renders resolved. */
  animate: boolean
  /** The ticker's hover-pause state, passed through to the shader bed. */
  paused: boolean
  className?: string
}) {
  const name = item.displayName || item.username
  const climb = billboardRankClimb(item)
  const ladder = hypeRankLadder(climb.from, climb.to)
  // Climb track domain: old rank at the left edge, rank 1 at the right —
  // the marker lands short of the summit, so the remaining gap reads as
  // the distance still to climb. Clamped like billboardRankClimb's
  // places: a stale non-climb payload parks the marker at the left edge
  // instead of scaling the trail negative.
  const climbTo =
    climb.from > 1 ? Math.min(1, Math.max(0, (climb.from - climb.to) / (climb.from - 1))) : 1

  // Snapshot per mount, like the ticker's own reducedMotion state. The
  // banner only ever renders client-side (the ticker mounts nothing until
  // a client fetch lands), so reading matchMedia in the initializer is safe.
  const [reduced] = useState(motionReducedNow)
  const [smUp, setSmUp] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
  )
  const playing = animate && !reduced

  const { out: decodedName, decoding } = useDecode(name, playing, DECODE_DELAY_MS)

  /** Sting beats — armed on the rising edge of `playing`, which the
   *  ticker raises at most once per layer mount, so the burst fires
   *  once per flip-in. (No once-ref: StrictMode's dev double-effect
   *  must be able to re-arm the cleared timers.) */
  const [engaged, setEngaged] = useState(false)
  const [landed, setLanded] = useState(false)
  /** Incremented at the land beat to fire the shader's one-shot shockwave. */
  const [burst, setBurst] = useState(0)

  useEffect(() => {
    if (!playing) return
    const engageTimer = window.setTimeout(() => setEngaged(true), REEL_START_MS)
    const landTimer = window.setTimeout(() => {
      setLanded(true)
      setBurst((b) => b + 1)
    }, LAND_MS)
    return () => {
      window.clearTimeout(engageTimer)
      window.clearTimeout(landTimer)
    }
  }, [playing])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const update = () => setSmUp(mq.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  /** Avatar-anchor x within the full-bleed bed, 0..1, for the shader's
   *  heat falloff origin. Remeasured whenever the strip resizes. */
  const stripRef = useRef<HTMLSpanElement | null>(null)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [origin, setOrigin] = useState(ORIGIN_FALLBACK)

  useEffect(() => {
    const strip = stripRef.current
    const anchor = anchorRef.current
    if (!strip || !anchor) return
    const measure = () => {
      const s = strip.getBoundingClientRect()
      const a = anchor.getBoundingClientRect()
      // Below sm the anchor is display:none and measures 0 — keep the
      // fallback (the bed isn't mounted there anyway).
      if (s.width <= 0 || a.width <= 0) return
      const next = Math.min(1, Math.max(0, (a.left + a.width / 2 - s.left) / s.width))
      setOrigin((prev) => (Math.abs(prev - next) < 0.005 ? prev : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(strip)
    return () => ro.disconnect()
  }, [])

  // Reel/track pose shares one clock with the reel itself: parked until
  // the engage beat, then rolled out; resolved renders sit rolled out.
  const rolledOut = !playing || engaged
  const rollTransition =
    playing && engaged ? `transform ${REEL_ROLL_MS}ms ${REEL_EASING}` : 'none'

  return (
    <span
      ref={stripRef}
      className={`relative flex w-full min-w-0 items-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 sm:px-4 sm:py-2.5 ${className}`}
    >
      {/* Bed, back to front: the gold wash (hype's fixed accent, where an
          ad gets its extracted tint), the WebGL caustic, the outline
          marquee. All decoration — the sr sentence below carries the
          announcement. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'rgb(var(--lb-gold) / 0.08)' }}
      />
      {smUp && !reduced && animate && (
        <span aria-hidden className="pointer-events-none absolute inset-0 hidden sm:block">
          <HypeShaderBed origin={origin} burst={burst} paused={paused} className="h-full w-full" />
        </span>
      )}
      <span
        aria-hidden
        className="billboard-hype-marquee pointer-events-none absolute inset-0 hidden items-center sm:flex"
      >
        <span className="billboard-hype-marquee-track">
          <span className="billboard-hype-marquee-copy">{MARQUEE_COPY}</span>
          <span className="billboard-hype-marquee-copy">{MARQUEE_COPY}</span>
        </span>
      </span>
      {/* Preserved anatomy: the 3px stripe in the ad card's accent seat. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: 'rgb(var(--lb-gold))' }}
      />

      {/* One coherent sentence for screen readers; every animated visual
          fragment below is an aria-hidden rendering of it. */}
      <span className="sr-only">{billboardHypeSentence(item)}</span>

      {/* Below sm: the original two-line strip, unchanged. */}
      <span aria-hidden className="relative flex w-full min-w-0 items-center gap-2.5 sm:hidden">
        <span
          className="relative shrink-0 rounded-full"
          style={{ boxShadow: '0 0 0 1px rgb(var(--lb-gold) / 0.5)' }}
        >
          <Avatar
            src={item.avatarUrl}
            char={name.charAt(0).toUpperCase() || '?'}
            imgClassName="block h-8 w-8 rounded-full object-cover"
            fallbackClassName="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-400"
          />
        </span>
        <span className="relative flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <span
            className={`truncate text-[11px] font-semibold uppercase leading-4 tracking-[0.2em] text-zinc-50 ${
              animate ? 'billboard-build-title' : ''
            }`}
          >
            {name}
          </span>
          <span
            className={`truncate text-sm leading-5 text-zinc-200 ${
              animate ? 'billboard-build-text' : ''
            }`}
          >
            just entered the <span style={{ color: 'rgb(var(--lb-gold))' }}>TOP 3</span>
          </span>
        </span>
      </span>

      {/* sm and up: the broadcast stage — three content zones aligned to
          the board's max-w-6xl over the full-bleed bed. Left and right
          flex evenly so the rank zone sits truly centered. */}
      <span
        aria-hidden
        className="relative mx-auto hidden w-full min-w-0 max-w-6xl items-center gap-4 sm:flex"
      >
        {/* LEFT — the anchor: avatar + decoded username + kinetic line. */}
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            ref={anchorRef}
            className="relative shrink-0 rounded-full"
            style={{ boxShadow: '0 0 0 1px rgb(var(--lb-gold) / 0.5)' }}
          >
            <Avatar
              src={item.avatarUrl}
              char={name.charAt(0).toUpperCase() || '?'}
              imgClassName="block h-10 w-10 rounded-full object-cover"
              fallbackClassName="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-400"
            />
          </span>
          <span className="flex min-w-0 flex-col justify-center gap-0.5">
            <span
              className="truncate text-[11px] font-semibold uppercase leading-4 tracking-[0.2em] text-zinc-50"
              style={decoding ? { color: 'rgb(var(--lb-gold) / 0.9)' } : undefined}
            >
              {decodedName}
            </span>
            <span className="truncate text-sm leading-5 text-zinc-200">
              {KIN_WORDS.map((word, i) => (
                <Fragment key={word}>
                  {i > 0 && ' '}
                  <span
                    className={playing ? 'billboard-kin-word' : undefined}
                    style={
                      playing
                        ? ({
                            '--kin-d': `${KIN_BASE_MS + i * KIN_STAGGER_MS}ms`
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    {word}
                  </span>
                </Fragment>
              ))}{' '}
              <span
                className={playing ? 'billboard-kin-word' : undefined}
                style={
                  {
                    color: 'rgb(var(--lb-gold))',
                    ...(playing
                      ? { '--kin-d': `${KIN_BASE_MS + KIN_WORDS.length * KIN_STAGGER_MS}ms` }
                      : null)
                  } as CSSProperties
                }
              >
                TOP&nbsp;3
              </span>
            </span>
          </span>
        </span>

        {/* CENTER — the payload: the downward rank reel over the climb
            track. Fades in after the flip lands (billboard-hype-extra). */}
        <span
          className={`flex shrink-0 flex-col items-center justify-center gap-1 ${
            playing ? 'billboard-hype-extra' : ''
          }`}
        >
          <span className="flex items-center gap-2">
            <span className="text-[9px] tracking-[0.3em] text-zinc-500">RANK</span>
            <span
              className={`font-display inline-flex items-center text-[22px] font-semibold leading-none tabular-nums text-zinc-50 ${
                playing && landed ? 'billboard-rank-land' : ''
              }`}
              style={!playing ? { color: 'rgb(var(--lb-gold))' } : undefined}
            >
              <span className="text-zinc-500">#</span>
              <RankReel ladder={ladder} engaged={engaged} animating={playing} />
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="billboard-progress-track relative block h-0.5 w-28 rounded-full">
              {/* Gold trail from the old rank's seat to the landing… */}
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'linear-gradient(90deg, rgb(var(--lb-gold) / 0.25), rgb(var(--lb-gold)))',
                  transform: `scaleX(${rolledOut ? climbTo : 0})`,
                  transformOrigin: 'left',
                  transition: rollTransition
                }}
              />
              {/* …with the marker riding a full-width arm, so the travel
                  stays a pure transform (translateX % is of the arm =
                  track width, not the dot). */}
              <span
                className="absolute inset-0"
                style={{
                  transform: `translateX(${(rolledOut ? climbTo : 0) * 100}%)`,
                  transition: rollTransition
                }}
              >
                <span
                  className="absolute -left-[3px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full"
                  style={{
                    background: 'rgb(var(--lb-gold))',
                    boxShadow: '0 0 8px rgb(var(--lb-gold) / 0.8)'
                  }}
                />
              </span>
            </span>
            <span className="text-[8px] tabular-nums tracking-[0.15em] text-zinc-600">#1</span>
          </span>
        </span>

        {/* RIGHT — the register: delta chip, freshness, affordance. */}
        <span
          className={`flex flex-1 items-center justify-end gap-2.5 ${
            playing ? 'billboard-hype-extra' : ''
          }`}
        >
          <span
            className="rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums"
            style={{
              color: 'rgb(var(--lb-up))',
              borderColor: 'rgb(var(--lb-up) / 0.35)',
              background: 'rgb(var(--lb-up) / 0.08)'
            }}
          >
            ▲{climb.places}
          </span>
          <span className="hidden whitespace-nowrap text-[10px] tabular-nums tracking-[0.12em] text-zinc-500 md:inline">
            {formatRelative(item.movedAt)}
          </span>
          <span className="text-sm text-zinc-500 transition-transform duration-150 group-hover:translate-x-0.5">
            →
          </span>
        </span>
      </span>
    </span>
  )
}
