'use client'

// CRT attract mode — the leaderboard hero. A physical amber-phosphor
// monitor idling like an arcade cabinet: it endlessly replays the top of
// the standings to pull players in. Everything on it is diegetic — the
// bezel LED is the live poll, static noise is loading, the channel-switch
// glitch is the player transition, and PRESS START opens the PlayerCard.
//
// Division of labor: GSAP (useGSAP) owns the sequenced master timeline
// (glitch-in → type → dither → count-up → hold → glitch-out) plus the
// one-shot title entrance; anime.js v4 owns the continuous ambient texture
// (phosphor flicker, scanline roll, cursor blink, bezel LED pulse).

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { animate, createTimer } from 'animejs'
import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatCompact, formatNumber } from '@/components/dashboard-v2/format'
import { IconCrown } from '@/components/leaderboard/icons'
import {
  glyphFor,
  identiconGrid,
  imageGrid,
  type PixelGrid
} from '@/components/leaderboard/pixelAvatar'
import type { SlopStatus } from '@/components/leaderboard/SlopChannel'
import type { LeaderRow } from '@/components/leaderboard/types'
import { useSfx } from '@/components/sfx/SfxProvider'
import { isXAvatarUrl, xAvatarRefreshUrl } from '@/lib/avatarRefresh'
import { prefersReducedMotion } from '@/lib/motion'

gsap.registerPlugin(useGSAP)

// Lazy: the CH 92 player (archive.org cartoon playlist driver) only
// downloads when someone actually flips to CH 92 — it never rides the
// leaderboard's initial bundle. ssr:false because an autoplaying
// <video> is meaningless markup on the server.
const SlopChannel = dynamic(
  () => import('@/components/leaderboard/SlopChannel'),
  { ssr: false }
)

const SLOP_CHANNEL_LABEL = 'CH 92 SLOPTOONS'
const BAR_CELLS = 18
const SPARK_GLYPHS = '▁▂▃▄▅▆▇█'

/** anime.js timers and animations share this playback surface. */
type Ambient = {
  pause: () => unknown
  resume: () => unknown
  revert: () => unknown
}

type Cycle = { row: LeaderRow; index: number; grid: PixelGrid | null }

/** What the tube is tuned to: the attract rotation or the pirate feed. */
type ChannelMode = 'attract' | 'slop'

type GridLine = { ch: string; a: number }[]

const pad = (n: number, width = 3) =>
  String(Math.max(0, n)).padStart(width, '0')

function reducedNow(): boolean {
  return (
    prefersReducedMotion() ||
    document.documentElement.dataset.motion === 'reduced'
  )
}

/** OS media query + Cribble's in-app data-motion kill switch, live. */
function useReducedMotionLive(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const compute = () => setReduced(reducedNow())
    compute()
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    mq.addEventListener('change', compute)
    const mo = new MutationObserver(compute)
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion']
    })
    return () => {
      mq.removeEventListener('change', compute)
      mo.disconnect()
    }
  }, [])
  return reduced
}

function gridToLines(grid: PixelGrid): GridLine[] {
  const lines: GridLine[] = []
  for (let r = 0; r < grid.rows; r++) {
    const line: GridLine = []
    for (let c = 0; c < grid.cols; c++) {
      const lum = grid.lum[r * grid.cols + c]
      line.push({ ch: glyphFor(lum), a: Math.round((0.45 + lum * 0.55) * 100) / 100 })
    }
    lines.push(line)
  }
  return lines
}

/** Bracketed block-glyph power bar: `████▓░····` for a 0..1 fraction. */
function barString(frac: number): string {
  const clamped = Math.max(0, Math.min(1, frac))
  const filled = clamped * BAR_CELLS
  const full = Math.floor(filled)
  const rem = filled - full
  let s = '█'.repeat(full)
  if (full < BAR_CELLS) s += rem > 0.66 ? '▓' : rem > 0.33 ? '▒' : '░'
  return (s + '·'.repeat(BAR_CELLS)).slice(0, BAR_CELLS)
}

/** Deterministic per-player telemetry strip (pure texture, seeded so the
 *  same pilot always broadcasts the same signal). */
function sparkline(seed: number): string {
  let x = (seed >>> 0) || 1
  let out = ''
  for (let i = 0; i < 22; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    out += SPARK_GLYPHS[Math.floor((x / 4294967296) * SPARK_GLYPHS.length)]
  }
  return out
}

/* ================= title entrance ================= */

const TITLE = 'LEADERBOARD'

/** The pixel wordmark lockup with its GSAP entrance: the crown rules draw
 *  outward from center while the letters slam in with a pixel-shadow
 *  stagger. Replaces the CSS lb4-reveal on the h1; reduced motion renders
 *  the static lockup untouched. */
export function HeroTitle({ eyebrow }: { eyebrow: string }) {
  const scope = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      if (reducedNow()) return
      gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from('.lbh-rule-l', { scaleX: 0, transformOrigin: '100% 50%', duration: 0.55 }, 0.05)
        .from('.lbh-rule-r', { scaleX: 0, transformOrigin: '0% 50%', duration: 0.55 }, 0.05)
        .from('.lbh-eyecore', { autoAlpha: 0, y: -8, duration: 0.45 }, 0.12)
        .from(
          '.lbh-letter',
          {
            autoAlpha: 0,
            y: -20,
            scale: 1.6,
            duration: 0.3,
            ease: 'back.out(2.2)',
            stagger: { each: 0.045 }
          },
          0.16
        )
    },
    { scope }
  )
  return (
    <div ref={scope} className="flex flex-col items-center">
      <div className="flex items-center gap-2.5 text-[rgb(var(--lb-gold))]">
        <span className="lbh-rule-l h-px w-8 bg-gradient-to-r from-transparent to-[rgb(var(--lb-gold)/0.6)]" />
        <span className="lbh-eyecore flex items-center gap-2.5">
          <IconCrown size={13} />
          <span className="font-display text-[10px] font-semibold tracking-[0.42em] sm:tracking-[0.55em]">
            {eyebrow}
          </span>
          <IconCrown size={13} className="-scale-x-100" />
        </span>
        <span className="lbh-rule-r h-px w-8 bg-gradient-to-l from-transparent to-[rgb(var(--lb-gold)/0.6)]" />
      </div>
      <h1
        aria-label={TITLE}
        className="lb4-title mt-4 select-none text-center leading-none [font-family:var(--font-pixel)]"
      >
        {TITLE.split('').map((ch, i) => (
          <span key={i} aria-hidden className="lbh-letter inline-block">
            {ch}
          </span>
        ))}
      </h1>
    </div>
  )
}

/* ================= screen content ================= */

type StageProps = {
  row: LeaderRow
  index: number
  total: number
  topScore: number
  lines: GridLine[] | null
  /** true = GSAP drives entrances/typing; false = fully static render. */
  live: boolean
  stageRef?: React.RefObject<HTMLDivElement>
  scoreRef?: React.RefObject<HTMLSpanElement>
  barRef?: React.RefObject<HTMLSpanElement>
  pctRef?: React.RefObject<HTMLSpanElement>
}

// Memoized: the ~540-span avatar grid must not re-render on the page's 15s
// poll — every prop here is referentially stable across polls (cycle only
// changes at player transitions).
const Stage = memo(function Stage({
  row,
  index,
  total,
  topScore,
  lines,
  live,
  stageRef,
  scoreRef,
  barRef,
  pctRef
}: StageProps) {
  const typed = (text: string, className?: string, hold = false) =>
    live ? (
      <span
        className={`${hold ? 'crt-type-hold' : 'crt-type'}${className ? ` ${className}` : ''}`}
        data-text={text}
      />
    ) : (
      <span className={className}>{text}</span>
    )

  const tool = row.topTools?.[0]
  const frac = topScore > 0 ? Math.min(1, row.score / topScore) : 0

  return (
    <div ref={stageRef} className="crt-stage" aria-hidden={live || undefined}>
      <div className="crt-line1">
        {typed(`> PILOT ${pad(index + 1)}/${pad(total)}`)}
        {typed(`RANK #${row.rank}`)}
      </div>
      <div className="crt-body">
        <div className="crt-av" aria-hidden>
          {lines ? (
            lines.map((line, r) => (
              <div key={r} className="crt-av-row">
                {line.map((cell, c) =>
                  cell.ch === ' ' ? (
                    <span key={c}> </span>
                  ) : (
                    <span
                      key={c}
                      className="crt-av-cell"
                      style={{ color: `rgb(var(--crt-p) / ${cell.a})` }}
                    >
                      {cell.ch}
                    </span>
                  )
                )}
              </div>
            ))
          ) : row.profile_image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.profile_image} alt="" className="crt-av-img" />
          ) : null}
        </div>
        <div className="crt-data">
          <div className="crt-name">{row.display_name || `@${row.username}`}</div>
          {typed(
            `@${row.username} · ${row.isActive ? 'ONLINE' : 'OFFLINE'}`,
            'crt-user'
          )}
          <div className="crt-scorewrap">
            <span className="crt-label">SCORE</span>
            <span ref={scoreRef} className="crt-score">
              {live ? '0' : formatNumber(row.score)}
            </span>
          </div>
          <div className="crt-barline">
            <span className="crt-label">PWR</span>
            <span className="crt-bracket">[</span>
            <span ref={barRef} className="crt-barcells">
              {live ? '·'.repeat(BAR_CELLS) : barString(frac)}
            </span>
            <span className="crt-bracket">]</span>
            <span ref={pctRef} className="crt-pct">
              {live ? '  0%' : `${String(Math.round(frac * 100)).padStart(3, ' ')}%`}
            </span>
          </div>
          <div className="crt-readouts">
            {typed(
              `24H ${row.todayScore > 0 ? `+${formatCompact(row.todayScore)}` : '——'}`
            )}
            {typed(
              tool ? `TOOL ${tool.name.toUpperCase()} ${tool.percent}%` : 'TOOL ——'
            )}
          </div>
          <div className="crt-sparkline">
            <span className="crt-label">SIG</span>
            {typed(sparkline(row.userId), undefined, true)}
          </div>
        </div>
      </div>
      <div className="crt-hint">
        <span className="crt-cursor">▮</span>
        <span>PRESS START ─ OPEN PILOT CARD</span>
      </div>
    </div>
  )
})

/* ================= the monitor ================= */

type CrtAttractProps = {
  /** Top slice of the standings (the attract rotation, ≤10 rows). */
  rows: LeaderRow[]
  topScore: number
  totalPlayers: number
  loading: boolean
  /** True while a modal covers the arena — hard-pauses GSAP + anime
   *  (the page's .lb4-freeze only reaches CSS animations). */
  frozen: boolean
  onSelect: (row: LeaderRow) => void
}

// Memoized: the arena page re-renders on every keystroke in the standings
// search and on score-flash state flips — none of which change these props.
// Only the 15s poll (fresh rows array) gets through.
export const CrtAttract = memo(function CrtAttract({
  rows,
  topScore,
  totalPlayers,
  loading,
  frozen,
  onSelect
}: CrtAttractProps) {
  const reduced = useReducedMotionLive()
  const { play } = useSfx()
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [staticGrid, setStaticGrid] = useState<PixelGrid | null>(null)
  const [channelMode, setChannelMode] = useState<ChannelMode>('attract')
  const [slopStatus, setSlopStatus] = useState<SlopStatus>('connecting')
  // Autoplay policy: the feed always lands muted; the screen click is the
  // user gesture that turns sound on.
  const [slopMuted, setSlopMuted] = useState(true)

  const rootRef = useRef<HTMLElement>(null)
  const bezelRef = useRef<HTMLDivElement>(null)
  const tubeRef = useRef<HTMLDivElement>(null)
  const flickerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLDivElement>(null)
  const rollbarRef = useRef<HTMLDivElement>(null)
  const ledRef = useRef<HTMLSpanElement>(null)
  const scoreRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const pctRef = useRef<HTMLSpanElement>(null)

  const rowsRef = useRef(rows)
  rowsRef.current = rows
  // Timeline callbacks are created once per cycle inside useGSAP; the ref
  // keeps them on the latest play without widening the effect's deps.
  const playRef = useRef(play)
  playRef.current = play
  const topScoreRef = useRef(topScore)
  topScoreRef.current = topScore
  const cycleRef = useRef(cycle)
  cycleRef.current = cycle

  const disposedRef = useRef(false)
  const poweredRef = useRef(false)
  const mountedAtRef = useRef(0)
  const gridCache = useRef(new Map<number, PixelGrid | null>())

  const tlRef = useRef<gsap.core.Timeline | null>(null)
  const ambientRef = useRef<Ambient[]>([])
  const holdsRef = useRef({
    frozen: false,
    offscreen: false,
    hidden: false,
    slop: false
  })

  useEffect(() => {
    disposedRef.current = false
    mountedAtRef.current = performance.now()
    return () => {
      disposedRef.current = true
    }
  }, [])

  const resolveGrid = useCallback(async (row: LeaderRow) => {
    const cache = gridCache.current
    if (cache.has(row.userId)) return cache.get(row.userId) ?? null
    // A slow-but-successful load repairs the timed-out null entry —
    // the pilot's next rotation pass gets the real grid.
    const late = (grid: PixelGrid) => gridCache.current.set(row.userId, grid)
    let grid: PixelGrid | null = null
    if (row.profile_image) {
      const first = await imageGrid(row.profile_image, undefined, undefined, late)
      grid = first.grid
      if (!grid && first.dead) {
        // The stored URL rotted (owner changed their X picture since last
        // login). Try the live-by-handle refresh — unavatar serves CORS so
        // the canvas sample works — and land on the identicon rather than
        // the raw <img> fallback, which would paint the same dead URL.
        const refresh = isXAvatarUrl(row.profile_image)
          ? xAvatarRefreshUrl(row.username)
          : null
        const second = refresh
          ? await imageGrid(refresh, undefined, undefined, late)
          : null
        grid = second?.grid ?? identiconGrid(row.username)
      }
    } else {
      grid = identiconGrid(row.username)
    }
    cache.set(row.userId, grid)
    return grid
  }, [])

  // ---- playback holds: frozen prop, offscreen, hidden tab, slop mode ----
  const syncPlayState = useCallback(() => {
    const h = holdsRef.current
    const paused = h.frozen || h.offscreen || h.hidden
    const tl = tlRef.current
    if (tl) {
      // The slop channel parks the attract rotation but NOT the ambient
      // layer — flicker, rollbar and LED are tube physics, and they keep
      // running over the video feed.
      if (paused || h.slop) tl.pause()
      else tl.resume()
    }
    // anime's engine already sleeps on document.hidden; frozen/offscreen
    // still need explicit pauses.
    ambientRef.current.forEach((a) => {
      if (paused) a.pause()
      else a.resume()
    })
  }, [])

  useEffect(() => {
    holdsRef.current.frozen = frozen
    syncPlayState()
  }, [frozen, syncPlayState])

  useEffect(() => {
    holdsRef.current.slop = channelMode === 'slop'
    syncPlayState()
    // Every tune-in starts from the same place: dead air until the room
    // connects, sound off until the viewer asks for it.
    if (channelMode === 'slop') {
      setSlopStatus('connecting')
      setSlopMuted(true)
    }
  }, [channelMode, syncPlayState])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        holdsRef.current.offscreen = !entries.some((e) => e.isIntersecting)
        syncPlayState()
      },
      { rootMargin: '25% 0px 25% 0px' }
    )
    io.observe(root)
    const onVis = () => {
      holdsRef.current.hidden = document.hidden
      syncPlayState()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [syncPlayState])

  // ---- attract rotation ------------------------------------------------
  const advance = useCallback(async () => {
    const list = rowsRef.current
    if (list.length === 0) {
      setCycle(null)
      return
    }
    const current = cycleRef.current
    const nextIndex = current ? (current.index + 1) % list.length : 0
    const row = list[nextIndex]
    const grid = await resolveGrid(row)
    if (!disposedRef.current) setCycle({ row, index: nextIndex, grid })
  }, [resolveGrid])

  // First cycle once data lands (skipped entirely under reduced motion).
  useEffect(() => {
    if (reduced || cycle || rows.length === 0) return
    let stale = false
    void resolveGrid(rows[0]).then((grid) => {
      if (!stale && !disposedRef.current) setCycle({ row: rows[0], index: 0, grid })
    })
    return () => {
      stale = true
    }
  }, [reduced, cycle, rows, resolveGrid])

  // Prefetch the next two pilots' grids during the current cycle.
  useEffect(() => {
    if (reduced || !cycle) return
    const list = rowsRef.current
    for (let k = 1; k <= 2 && k < list.length; k++) {
      void resolveGrid(list[(cycle.index + k) % list.length])
    }
  }, [cycle, reduced, resolveGrid])

  // Reduced motion: static featured card for rank #1.
  const featuredId = rows.length > 0 ? rows[0].userId : null
  useEffect(() => {
    if (!reduced || featuredId === null) return
    const row = rowsRef.current[0]
    if (!row) return
    let stale = false
    void resolveGrid(row).then((grid) => {
      if (!stale && !disposedRef.current) setStaticGrid(grid)
    })
    return () => {
      stale = true
    }
  }, [reduced, featuredId, resolveGrid])

  // ---- anime ambient layer: flicker, roll, blink, LED --------------------
  useEffect(() => {
    if (reduced) return
    const root = rootRef.current
    if (!root) return
    const anims: Ambient[] = []
    const flickerEl = flickerRef.current
    if (flickerEl) {
      anims.push(
        createTimer({
          duration: 110,
          loop: true,
          onLoop: () => {
            flickerEl.style.opacity = (0.965 + Math.random() * 0.035).toFixed(3)
          }
        })
      )
    }
    if (rollbarRef.current) {
      anims.push(
        animate(rollbarRef.current, {
          y: ['-120%', '760%'],
          duration: 6800,
          loop: true,
          ease: 'linear'
        })
      )
    }
    if (ledRef.current) {
      anims.push(
        animate(ledRef.current, {
          opacity: [0.35, 1],
          duration: 1500,
          alternate: true,
          loop: true,
          ease: 'inOutSine'
        })
      )
    }
    anims.push(
      createTimer({
        duration: 530,
        loop: true,
        onLoop: () => {
          root
            .querySelectorAll('.crt-cursor')
            .forEach((el) => el.classList.toggle('crt-cur-off'))
        }
      })
    )
    ambientRef.current = anims
    syncPlayState()
    return () => {
      // revert (not cancel) strips the inline styles anime wrote: the
      // rollbar and LED stay mounted when reduced-motion flips on
      // mid-session, and cancel would freeze them mid-roll / mid-pulse
      // over the static featured card.
      anims.forEach((a) => a.revert())
      if (flickerEl) flickerEl.style.opacity = ''
      ambientRef.current = []
    }
  }, [reduced, syncPlayState])

  // ---- GSAP master attract timeline (one cycle per player) ---------------
  useGSAP(
    () => {
      if (reduced || !cycle) return
      const stage = stageRef.current
      if (!stage) return
      const row = cycle.row
      const staticL = staticRef.current

      const tl = gsap.timeline({
        defaults: { ease: 'power2.out' },
        onComplete: () => {
          void advance()
        }
      })
      tlRef.current = tl

      // Pre-paint hides so nothing flashes before its beat.
      gsap.set(stage, { autoAlpha: 0 })
      const beats = stage.querySelectorAll(
        '.crt-name, .crt-hint, .crt-av-cell, .crt-av-img'
      )
      if (beats.length > 0) gsap.set(beats, { autoAlpha: 0 })

      // One-time power-on: the monitor rises, then the tube snaps open
      // from a horizontal line like a real CRT warming up. Cold starts
      // only — after a slow fetch the bezel and AWAITING static have been
      // on screen for a while, and replaying the rise/snap would blink
      // out a monitor the player is already watching; the channel-switch
      // glitch below carries the handoff instead.
      if (!poweredRef.current) {
        poweredRef.current = true
        const coldStart = performance.now() - mountedAtRef.current < 500
        // Sound rides the rise/snap; on warm handoffs (no visuals) the
        // channel burst below carries the audio too. Must be added before
        // the visual tweens: addLabel('glitchIn', '>') resolves against
        // the most recently added child, and a trailing zero-duration
        // call would drag the label back to t=0.
        if (coldStart) {
          tl.call(() => playRef.current('powerOn'), undefined, 0)
        }
        if (coldStart && bezelRef.current) {
          tl.from(bezelRef.current, { autoAlpha: 0, y: 18, duration: 0.55, ease: 'power3.out' }, 0)
        }
        if (coldStart && tubeRef.current) {
          tl.fromTo(
            tubeRef.current,
            { scaleY: 0.004, scaleX: 0.6, opacity: 0.2 },
            { scaleY: 1, scaleX: 1, opacity: 1, duration: 0.5, ease: 'power3.inOut' },
            0.35
          )
          tl.fromTo(
            tubeRef.current,
            { filter: 'brightness(2.4)' },
            { filter: 'brightness(1)', duration: 0.55, ease: 'power2.out' },
            0.72
          )
        }
      }

      // Channel-switch glitch in: static burst, sliced clip reveal.
      tl.addLabel('glitchIn', '>')
      tl.call(() => playRef.current('channel'), undefined, 'glitchIn')
      if (staticL) {
        tl.set(staticL, { opacity: 0.55 }, 'glitchIn')
        tl.to(staticL, { opacity: 0, duration: 0.16, ease: 'power1.in' }, 'glitchIn+=0.08')
      }
      tl.set(
        stage,
        { clipPath: 'inset(46% 0% 46% 0%)', x: -9, autoAlpha: 1 },
        'glitchIn+=0.06'
      )
      tl.to(
        stage,
        {
          keyframes: [
            { clipPath: 'inset(24% 0% 36% 0%)', x: 7, duration: 0.05 },
            { clipPath: 'inset(5% 0% 14% 0%)', x: -4, duration: 0.05 },
            { clipPath: 'inset(0% 0% 0% 0%)', x: 0, duration: 0.08 }
          ],
          ease: 'none'
        },
        'glitchIn+=0.07'
      )
      if (flickerRef.current) {
        tl.fromTo(
          flickerRef.current,
          { y: -5 },
          { y: 0, duration: 0.2, ease: 'power2.out', immediateRender: false },
          'glitchIn+=0.07'
        )
      }

      // Terminal readouts type in.
      tl.addLabel('type', 'glitchIn+=0.28')
      const typedEls = gsap.utils.toArray<HTMLElement>('.crt-type', stage)
      let at = 0
      for (const el of typedEls) {
        const text = el.dataset.text ?? ''
        el.textContent = ''
        const proxy = { n: 0 }
        const dur = Math.min(0.55, 0.24 + text.length * 0.012)
        tl.to(
          proxy,
          {
            n: text.length,
            duration: dur,
            ease: 'none',
            onUpdate: () => {
              el.textContent = text.slice(0, Math.round(proxy.n))
            }
          },
          `type+=${at.toFixed(3)}`
        )
        at += dur * 0.55
      }
      tl.to('.crt-name', { autoAlpha: 1, duration: 0.4, ease: 'steps(5)' }, 'type+=0.08')

      // Avatar dithers in cell by cell.
      tl.addLabel('dither', 'type+=0.24')
      const cells = gsap.utils.toArray<HTMLElement>('.crt-av-cell', stage)
      if (cells.length > 0) {
        tl.to(
          cells,
          { autoAlpha: 1, duration: 0.02, stagger: { amount: 0.8, from: 'random' } },
          'dither'
        )
      }
      const fallbackImg = stage.querySelector('.crt-av-img')
      if (fallbackImg) {
        tl.to(fallbackImg, { autoAlpha: 1, duration: 0.55, ease: 'steps(7)' }, 'dither')
      }

      // Score counts up in phosphor digits while the block bar fills.
      tl.addLabel('count', 'dither+=0.35')
      const scoreEl = scoreRef.current
      const barEl = barRef.current
      const pctEl = pctRef.current
      const top = topScoreRef.current
      const frac = top > 0 ? Math.min(1, row.score / top) : 0
      if (scoreEl) {
        const proxy = { val: 0 }
        tl.to(
          proxy,
          {
            val: row.score,
            duration: 1.1,
            ease: 'power2.out',
            snap: { val: 1 },
            onUpdate: () => {
              scoreEl.textContent = formatNumber(Math.round(proxy.val))
              const p = row.score > 0 ? proxy.val / row.score : 1
              if (barEl) barEl.textContent = barString(frac * p)
              if (pctEl) {
                pctEl.textContent = `${String(Math.round(frac * p * 100)).padStart(3, ' ')}%`
              }
            }
          },
          'count'
        )
        tl.fromTo(
          scoreEl,
          { scale: 1 },
          {
            scale: 1.07,
            duration: 0.12,
            yoyo: true,
            repeat: 1,
            ease: 'power1.inOut',
            immediateRender: false
          },
          'count+=1.02'
        )
      }

      // Hold: telemetry strip types in, PRESS START flickers on.
      tl.addLabel('hold', 'count+=1.3')
      const holdEls = gsap.utils.toArray<HTMLElement>('.crt-type-hold', stage)
      for (const el of holdEls) {
        const text = el.dataset.text ?? ''
        el.textContent = ''
        const proxy = { n: 0 }
        tl.to(
          proxy,
          {
            n: text.length,
            duration: 0.5,
            ease: 'none',
            onUpdate: () => {
              el.textContent = text.slice(0, Math.round(proxy.n))
            }
          },
          'hold'
        )
      }
      tl.to('.crt-hint', { autoAlpha: 1, duration: 0.3, ease: 'steps(3)' }, 'hold+=0.1')

      // Channel-switch glitch out into static.
      tl.addLabel('out', 'hold+=2.1')
      tl.to(
        stage,
        {
          keyframes: [
            { clipPath: 'inset(8% 0% 60% 0%)', x: 6, duration: 0.05 },
            { clipPath: 'inset(36% 0% 22% 0%)', x: -7, duration: 0.05 },
            { clipPath: 'inset(46% 0% 46% 0%)', x: 4, duration: 0.05 }
          ],
          ease: 'none'
        },
        'out'
      )
      tl.to(stage, { autoAlpha: 0, duration: 0.05 }, '>')
      if (staticL) tl.to(staticL, { opacity: 0.55, duration: 0.08 }, 'out+=0.1')

      const h = holdsRef.current
      if (h.frozen || h.offscreen || h.hidden || h.slop) tl.pause()

      return () => {
        if (tlRef.current === tl) tlRef.current = null
      }
    },
    // revertOnUpdate keeps the context from accumulating one finished
    // timeline per 6s cycle across a long idle session; reverting touches
    // only the previous (already unmounted) stage's nodes.
    { dependencies: [cycle, reduced], scope: rootRef, revertOnUpdate: true }
  )

  // ---- render -----------------------------------------------------------
  const lines = useMemo(
    () => (cycle?.grid ? gridToLines(cycle.grid) : null),
    [cycle]
  )
  const staticLines = useMemo(
    () => (staticGrid ? gridToLines(staticGrid) : null),
    [staticGrid]
  )

  const featured = reduced ? (rows[0] ?? null) : null
  const activeRow = reduced ? featured : (cycle?.row ?? null)
  const awaiting = !activeRow
  const channel = reduced
    ? 'CH 01'
    : cycle
      ? `CH ${pad(cycle.index + 1, 2)}`
      : 'CH --'

  // Channel flip: static burst + the channel zap, then swap what the tube
  // is tuned to. The burst is a one-shot outside the master timeline (which
  // parks while the slop channel is up); clearProps hands opacity control
  // back to the data-on attribute rule once it fades.
  const flipChannel = useCallback(() => {
    playRef.current('channel')
    const staticL = staticRef.current
    if (staticL && !reducedNow()) {
      gsap.fromTo(
        staticL,
        { opacity: 0.85 },
        {
          opacity: 0,
          duration: 0.3,
          delay: 0.12,
          ease: 'power1.in',
          onComplete: () => {
            gsap.set(staticL, { clearProps: 'opacity' })
          }
        }
      )
    }
    setChannelMode((mode) => (mode === 'attract' ? 'slop' : 'attract'))
  }, [])

  const handleScreenClick = () => {
    switch (channelMode) {
      case 'attract': {
        if (!activeRow) return
        play('pressStart')
        onSelect(activeRow)
        return
      }
      case 'slop': {
        // The tap is the autoplay-policy gesture: first click unmutes.
        play(slopMuted ? 'toggleOn' : 'toggleOff')
        setSlopMuted((m) => !m)
        return
      }
      default: {
        const exhaustive: never = channelMode
        throw new Error(`Unhandled channel mode: ${String(exhaustive)}`)
      }
    }
  }

  const slop = channelMode === 'slop'
  // In slop mode the noise sheet doubles as dead air: on while tuning or
  // when the feed drops, off once the room delivers tracks.
  const staticOn = slop ? slopStatus !== 'live' : awaiting

  return (
    <section
      ref={rootRef}
      className="crt-root"
      data-reduced={reduced || undefined}
      data-channel={channelMode}
      aria-label={
        slop
          ? 'Sloptoons — pirate broadcast'
          : 'Attract mode — top pilots showcase'
      }
    >
      <div ref={bezelRef} className="crt-bezel">
        <div className="crt-screenwrap">
          <div ref={tubeRef} className="crt-tube">
            <button
              type="button"
              className="crt-screen"
              // The delegated app-wide listener would layer the default
              // tap on pointerdown; the click handler owns the audio here.
              data-sfx="off"
              onClick={handleScreenClick}
              disabled={!slop && awaiting}
              aria-label={
                slop
                  ? slopMuted
                    ? 'Sloptoons — press to enable sound'
                    : 'Sloptoons — press to mute'
                  : activeRow
                    ? `Open pilot card — @${activeRow.username}, rank ${activeRow.rank}`
                    : 'Awaiting signal'
              }
            >
              {/* Bottom of the paint stack: the feed sits under the
                  static sheet and every tube-physics overlay below. */}
              {slop ? (
                <SlopChannel muted={slopMuted} onStatus={setSlopStatus} />
              ) : null}
              <div
                ref={staticRef}
                className="crt-static"
                data-on={staticOn}
                aria-hidden
              />
              <div ref={flickerRef} className="crt-flicker">
                <div className="crt-chrome">
                  <span>{slop ? 'PIRATE//BROADCAST' : 'CRIBBLE//BROADCAST'}</span>
                  {/* Not a <button>: it lives inside the screen button, and
                      interactive elements can't nest. The chin's CH button
                      is the fully accessible twin of this readout. */}
                  <span
                    role="button"
                    tabIndex={0}
                    className="crt-chrome-ch"
                    data-sfx="off"
                    aria-label={
                      slop
                        ? 'Change channel — back to attract mode'
                        : 'Change channel — Sloptoons'
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      flipChannel()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        flipChannel()
                      }
                    }}
                  >
                    {slop ? SLOP_CHANNEL_LABEL : channel}
                  </span>
                </div>
                {slop ? (
                  slopStatus === 'live' ? (
                    <div className="crt-hint crt-slop-hint">
                      <span className="crt-cursor">▮</span>
                      <span>
                        {slopMuted
                          ? 'SOUND OFF ─ PRESS SCREEN'
                          : 'SOUND ON ─ PRESS TO MUTE'}
                      </span>
                    </div>
                  ) : (
                    <div className="crt-await">
                      <div className="crt-await-title">{SLOP_CHANNEL_LABEL}</div>
                      <div className="crt-await-sub">
                        {slopStatus === 'connecting'
                          ? 'TUNING SIGNAL'
                          : 'NO CARRIER'}
                      </div>
                    </div>
                  )
                ) : null}
                {reduced && featured ? (
                  <Stage
                    row={featured}
                    index={0}
                    total={totalPlayers}
                    topScore={topScore}
                    lines={staticLines}
                    live={false}
                  />
                ) : cycle ? (
                  <Stage
                    key={cycle.row.userId}
                    row={cycle.row}
                    index={cycle.index}
                    total={totalPlayers}
                    topScore={topScore}
                    lines={lines}
                    live
                    stageRef={stageRef}
                    scoreRef={scoreRef}
                    barRef={barRef}
                    pctRef={pctRef}
                  />
                ) : !slop ? (
                  // Suppressed on CH 92: the slop overlay above owns the
                  // await treatment there.
                  <div className="crt-await">
                    <div className="crt-await-title">AWAITING SIGNAL</div>
                    <div className="crt-await-sub">
                      {loading ? 'SCANNING FOR PILOTS' : 'NO CARRIER'}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="crt-scanlines" aria-hidden />
              <div ref={rollbarRef} className="crt-rollbar" aria-hidden />
              <div className="crt-vignette" aria-hidden />
              <div className="crt-glass" aria-hidden />
            </button>
          </div>
        </div>
        <div className="crt-chin">
          <span className="crt-brand">CRIBBLE</span>
          <span className="crt-model">
            {slop
              ? // Etiquette: credit the archive whose nodes serve the reels.
                'PUBLIC DOMAIN THEATER · archive.org'
              : 'MODEL CRT·1984 // ATTRACT MODE'}
          </span>
          <span className="crt-ledwrap">
            <button
              type="button"
              className="crt-chbtn"
              // flipChannel plays the channel zap itself.
              data-sfx="off"
              onClick={flipChannel}
              aria-pressed={slop}
              aria-label="Change channel — Sloptoons"
            >
              CH
            </button>
            <span ref={ledRef} className="crt-led" data-live={!loading} />
            {loading ? 'SYNC' : 'LIVE'}
          </span>
        </div>
      </div>

      <style jsx global>{`
        .crt-root {
          /* Amber phosphor derived from --lb-gold's dark value (255 214 68)
             pushed toward #FFB000 — pinned locally because the monitor is a
             physical object: the light theme's darkened gold must not tint
             the tube, and the bezel stays dark in both themes. */
          --crt-p: 255 179 25;
          --crt-hi: 255 214 68;
          margin: 28px auto 0;
          width: 100%;
          max-width: 780px;
        }

        /* ---- cabinet plastic ---- */
        .crt-bezel {
          position: relative;
          border-radius: 26px;
          padding: 16px 16px 0;
          background: linear-gradient(180deg, #34353c, #1c1d23 9%, #15161b 58%, #0e0f13);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.1),
            inset 0 -2px 0 rgb(0 0 0 / 0.65),
            inset 2px 0 2px -1px rgb(255 255 255 / 0.04),
            inset -2px 0 2px -1px rgb(0 0 0 / 0.3),
            0 34px 60px -34px rgb(0 0 0 / 0.75),
            0 10px 26px -14px rgb(0 0 0 / 0.55);
        }
        .crt-screenwrap {
          border-radius: 16px;
          padding: 8px;
          background: linear-gradient(180deg, #060708, #0d0e12 70%, #121318);
          box-shadow:
            inset 0 3px 10px rgb(0 0 0 / 0.9),
            inset 0 -1px 0 rgb(255 255 255 / 0.05);
        }
        .crt-tube {
          border-radius: 12px;
          overflow: hidden;
          transform-origin: 50% 50%;
        }

        /* ---- the glass ---- */
        .crt-screen {
          position: relative;
          display: block;
          width: 100%;
          padding: 0;
          text-align: left;
          border: 0;
          border-radius: 12px;
          cursor: pointer;
          overflow: hidden;
          background: radial-gradient(
            130% 115% at 50% 42%,
            #1a1106 0%,
            #0e0904 55%,
            #070402 100%
          );
          font-family: var(--font-data), ui-monospace, 'SF Mono', Menlo, monospace;
          color: rgb(var(--crt-p) / 0.9);
        }
        .crt-screen:disabled {
          cursor: default;
        }
        /* Keyboard focus ring, painted inside: the tube clips overflow, so
           an outline outside the button box never shows, and a negative
           outline-offset proved unreliable under the page zoom. The ring
           lives on a topmost pseudo so the vignette/glass can't dim it. */
        .crt-screen::after {
          content: '';
          position: absolute;
          inset: 3px;
          z-index: 5;
          pointer-events: none;
          border: 2px solid transparent;
          border-radius: 9px;
        }
        .crt-screen:focus-visible {
          outline: none;
        }
        .crt-screen:focus-visible::after {
          border-color: rgb(var(--crt-p) / 0.85);
        }

        .crt-flicker {
          position: relative;
          display: flex;
          flex-direction: column;
          min-height: 330px;
          padding: 14px 22px 12px;
          /* The ambient timer nudges opacity every 110ms; own layer so the
             flicker composites instead of repainting every text-shadow. */
          will-change: opacity, transform;
        }

        .crt-chrome {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          padding-bottom: 8px;
          border-bottom: 1px dashed rgb(var(--crt-p) / 0.22);
          font-size: 9px;
          letter-spacing: 0.3em;
          color: rgb(var(--crt-p) / 0.55);
          text-shadow: 0 0 5px rgb(var(--crt-p) / 0.35);
        }

        /* ---- attract stage ---- */
        .crt-stage {
          display: flex;
          flex: 1;
          flex-direction: column;
          padding-top: 12px;
          text-shadow: 0 0 6px rgb(var(--crt-p) / 0.4);
        }
        .crt-line1 {
          display: flex;
          justify-content: space-between;
          min-height: 14px;
          font-size: 10px;
          letter-spacing: 0.18em;
          color: rgb(var(--crt-p) / 0.8);
        }
        .crt-body {
          display: flex;
          flex: 1;
          align-items: center;
          gap: 26px;
          padding: 14px 0 10px;
        }
        .crt-av {
          flex: none;
          font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
          font-size: 8px;
          line-height: 8px;
          letter-spacing: 0;
          text-shadow: 0 0 4px rgb(var(--crt-p) / 0.45);
        }
        .crt-av-row {
          height: 8px;
          white-space: pre;
        }
        .crt-av-img {
          width: 144px;
          height: 144px;
          border: 1px solid rgb(var(--crt-p) / 0.3);
          image-rendering: pixelated;
          filter: grayscale(1) sepia(1) saturate(2.4) hue-rotate(-14deg)
            contrast(1.15) brightness(0.85);
        }
        .crt-data {
          display: flex;
          min-width: 0;
          flex: 1;
          flex-direction: column;
          gap: 8px;
        }
        .crt-name {
          overflow: hidden;
          max-width: 100%;
          font-family: var(--font-pixel);
          font-size: clamp(13px, 2.4vw, 20px);
          line-height: 1.35;
          color: rgb(var(--crt-hi));
          text-overflow: ellipsis;
          white-space: nowrap;
          text-shadow:
            0 0 10px rgb(var(--crt-p) / 0.6),
            0 0 30px rgb(var(--crt-p) / 0.28);
        }
        .crt-user {
          overflow: hidden;
          min-height: 12px;
          max-width: 100%;
          font-size: 10px;
          letter-spacing: 0.2em;
          color: rgb(var(--crt-p) / 0.6);
          /* One line always: a wrapping callsign would change the stage
             height between pilots (and against AWAITING SIGNAL). */
          white-space: nowrap;
        }
        .crt-label {
          font-size: 8px;
          letter-spacing: 0.34em;
          color: rgb(var(--crt-p) / 0.48);
        }
        .crt-scorewrap {
          display: flex;
          align-items: baseline;
          gap: 12px;
          margin-top: 2px;
        }
        .crt-score {
          display: inline-block;
          font-family: var(--font-pixel);
          font-size: clamp(17px, 3vw, 28px);
          color: rgb(var(--crt-p));
          text-shadow:
            0 0 12px rgb(var(--crt-p) / 0.65),
            0 0 36px rgb(var(--crt-p) / 0.3);
        }
        .crt-barline {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 12px;
          color: rgb(var(--crt-p) / 0.9);
        }
        .crt-bracket {
          color: rgb(var(--crt-p) / 0.5);
        }
        .crt-barcells {
          font-family: ui-monospace, 'SF Mono', Menlo, monospace;
          letter-spacing: 1px;
          text-shadow: 0 0 6px rgb(var(--crt-p) / 0.5);
        }
        .crt-pct {
          font-size: 10px;
          color: rgb(var(--crt-p) / 0.7);
          white-space: pre;
        }
        .crt-readouts {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 20px;
          min-height: 12px;
          font-size: 10px;
          letter-spacing: 0.16em;
          color: rgb(var(--crt-p) / 0.72);
        }
        .crt-sparkline {
          display: flex;
          align-items: baseline;
          gap: 8px;
          min-height: 13px;
          font-size: 11px;
          color: rgb(var(--crt-p) / 0.55);
        }
        .crt-hint {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: auto;
          padding-top: 10px;
          border-top: 1px dashed rgb(var(--crt-p) / 0.18);
          font-size: 9px;
          letter-spacing: 0.3em;
          color: rgb(var(--crt-hi) / 0.85);
          text-shadow: 0 0 8px rgb(var(--crt-p) / 0.45);
        }
        .crt-screen:hover .crt-hint,
        .crt-screen:focus-visible .crt-hint {
          color: rgb(var(--crt-hi));
        }
        .crt-cursor {
          display: inline-block;
        }
        .crt-cur-off {
          visibility: hidden;
        }

        /* ---- awaiting signal ---- */
        .crt-await {
          position: relative;
          z-index: 1;
          display: flex;
          flex: 1;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
        }
        .crt-await-title {
          font-family: var(--font-pixel);
          font-size: clamp(14px, 2.6vw, 22px);
          color: rgb(var(--crt-hi));
          text-shadow:
            0 0 12px rgb(var(--crt-p) / 0.65),
            0 0 34px rgb(var(--crt-p) / 0.3);
          animation: crt-await-blink 1.7s steps(2, jump-none) infinite;
        }
        .crt-await-sub {
          font-size: 9px;
          letter-spacing: 0.34em;
          color: rgb(var(--crt-p) / 0.6);
          text-shadow: 0 0 6px rgb(var(--crt-p) / 0.4);
        }
        @keyframes crt-await-blink {
          50% {
            opacity: 0.4;
          }
        }

        /* ---- CH 92 SLOPTOONS (pirate channel) ---- */
        /* The attract stage stays mounted so its paused GSAP timeline
           keeps its nodes (and resumes exactly where it parked on
           flip-back) — display:none because GSAP owns inline opacity
           and visibility on these elements. */
        .crt-root[data-channel='slop'] .crt-stage {
          display: none;
        }
        .crt-chrome-ch {
          cursor: pointer;
        }
        .crt-chrome-ch:hover,
        .crt-chrome-ch:focus-visible {
          color: rgb(var(--crt-hi));
          outline: none;
          text-shadow: 0 0 8px rgb(var(--crt-p) / 0.6);
        }
        .crt-slop-hint {
          position: relative;
        }

        /* ---- tube physics overlays ---- */
        .crt-scanlines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            repeating-linear-gradient(
              0deg,
              rgb(0 0 0 / 0.3) 0px,
              rgb(0 0 0 / 0.3) 1px,
              transparent 1px,
              transparent 3px
            ),
            repeating-linear-gradient(
              90deg,
              rgb(0 0 0 / 0.07) 0px,
              rgb(0 0 0 / 0.07) 1px,
              transparent 1px,
              transparent 3px
            );
        }
        .crt-rollbar {
          position: absolute;
          top: 0;
          right: 0;
          left: 0;
          height: 14%;
          pointer-events: none;
          background: linear-gradient(
            180deg,
            transparent,
            rgb(var(--crt-p) / 0.05) 40%,
            rgb(255 255 255 / 0.05) 55%,
            transparent
          );
          transform: translateY(-120%);
          /* anime.js retargets y every frame for the whole session. */
          will-change: transform;
        }
        /* The noise sheet overhangs the screen by one tile (160×96) so the
           crawl can ride transform instead of background-position: the
           SVG turbulence + color filter rasterize once and the steps(5)
           shift is compositor-only, not a full-screen repaint per step.
           The screen's overflow:hidden clips the overhang. */
        .crt-static {
          position: absolute;
          inset: -96px 0 0 -160px;
          pointer-events: none;
          opacity: 0;
          background-color: #0a0703;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 160px 160px;
          filter: grayscale(1) brightness(0.72) sepia(0.9) saturate(2.6)
            hue-rotate(-14deg);
          will-change: transform;
          animation: crt-static-crawl 0.42s steps(5) infinite;
        }
        .crt-static[data-on='true'] {
          opacity: 0.9;
        }
        @keyframes crt-static-crawl {
          to {
            transform: translate3d(160px, 96px, 0);
          }
        }
        .crt-vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
          background: radial-gradient(
            118% 102% at 50% 50%,
            transparent 56%,
            rgb(0 0 0 / 0.3) 78%,
            rgb(0 0 0 / 0.66) 100%
          );
          box-shadow:
            inset 0 0 68px 14px rgb(0 0 0 / 0.6),
            inset 0 0 8px 2px rgb(0 0 0 / 0.65);
        }
        .crt-glass {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(
              112deg,
              rgb(255 255 255 / 0.07) 0%,
              rgb(255 255 255 / 0.02) 18%,
              transparent 34%
            ),
            radial-gradient(
              58% 28% at 24% 5%,
              rgb(255 255 255 / 0.08),
              transparent 70%
            );
        }

        /* ---- chin: brand plate + live LED ---- */
        .crt-chin {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 13px 10px 15px;
        }
        .crt-brand {
          font-family: var(--font-pixel);
          font-size: 10px;
          letter-spacing: 0.1em;
          color: rgb(255 255 255 / 0.42);
        }
        .crt-model {
          overflow: hidden;
          font-family: var(--font-data), ui-monospace, Menlo, monospace;
          font-size: 8px;
          letter-spacing: 0.3em;
          color: rgb(255 255 255 / 0.2);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .crt-ledwrap {
          display: flex;
          flex: none;
          align-items: center;
          gap: 6px;
          font-family: var(--font-data), ui-monospace, Menlo, monospace;
          font-size: 8px;
          letter-spacing: 0.26em;
          color: rgb(255 255 255 / 0.35);
        }
        .crt-led {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: rgb(var(--crt-p));
          box-shadow: 0 0 9px rgb(var(--crt-p) / 0.9);
        }
        .crt-led[data-live='false'] {
          background: #8a4a3a;
          box-shadow: 0 0 7px rgb(255 110 80 / 0.55);
        }
        .crt-chbtn {
          padding: 2px 7px;
          border: 1px solid rgb(255 255 255 / 0.22);
          border-radius: 4px;
          background: transparent;
          font-family: var(--font-data), ui-monospace, Menlo, monospace;
          font-size: 8px;
          letter-spacing: 0.26em;
          color: rgb(255 255 255 / 0.42);
          cursor: pointer;
        }
        .crt-chbtn:hover,
        .crt-chbtn:focus-visible {
          border-color: rgb(255 255 255 / 0.45);
          color: rgb(255 255 255 / 0.7);
        }
        .crt-chbtn[aria-pressed='true'] {
          border-color: rgb(var(--crt-p) / 0.6);
          color: rgb(var(--crt-p));
          box-shadow: 0 0 8px rgb(var(--crt-p) / 0.35);
        }

        /* ---- small screens ---- */
        @media (max-width: 640px) {
          .crt-bezel {
            border-radius: 20px;
            padding: 11px 11px 0;
          }
          .crt-screenwrap {
            border-radius: 12px;
            padding: 6px;
          }
          /* 272px seats the tallest loaded stage exactly (fixed-height
             rows: name, callsign, score, PWR, two stacked readouts), so
             the old 300px band of dead phosphor above PRESS START is gone
             and AWAITING floors on the same value — no layout shift. */
          .crt-flicker {
            min-height: 272px;
            padding: 12px 14px 10px;
          }
          .crt-body {
            gap: 14px;
            padding: 12px 0 8px;
          }
          .crt-av {
            font-size: 5px;
            line-height: 5px;
          }
          .crt-av-row {
            height: 5px;
          }
          .crt-av-img {
            width: 90px;
            height: 90px;
          }
          /* 9px keeps the full "[ cells ] 100%" run inside the 390px tube —
             at 10px the percentage clipped off the right edge. */
          .crt-barline {
            font-size: 9px;
          }
          .crt-barcells {
            letter-spacing: 0;
          }
          .crt-pct {
            font-size: 9px;
          }
          /* Tighter tracking so "@name · ONLINE" clears a 183px column
             before the nowrap ellipsis regime kicks in. */
          .crt-user {
            font-size: 9px;
            letter-spacing: 0.12em;
          }
          /* Always two stacked rows: inline readouts wrapped for some
             pilots and not others, bouncing the stage height mid-loop. */
          .crt-readouts {
            flex-direction: column;
            gap: 3px;
          }
          /* Pure-texture telemetry: 22 glyphs never fit the phone data
             column — dropped whole rather than shrunk into mush. */
          .crt-sparkline {
            display: none;
          }
          .crt-hint {
            letter-spacing: 0.2em;
          }
          .crt-model {
            display: none;
          }
        }

        /* A season-scale 9-glyph score ("9,999,999") plus the SCORE label
           needs ~202px; the data column is 183px at 360w and 192px at
           390w. The label is the decoration here — drop it and let the
           digits keep their size (PWR/24H/TOOL still carry labels). */
        @media (max-width: 420px) {
          .crt-scorewrap .crt-label {
            display: none;
          }
        }

        /* Narrow phones (≤374px): the 18-cell PWR run, its %, and a
           7-digit score only clear the tube if the avatar cedes a step —
           4px cells keep the sprite readable while freeing ~22px. */
        @media (max-width: 374px) {
          .crt-av {
            font-size: 4px;
            line-height: 4px;
          }
          .crt-av-row {
            height: 4px;
          }
          .crt-av-img {
            width: 72px;
            height: 72px;
          }
          .crt-body {
            gap: 10px;
          }
          .crt-barline {
            gap: 6px;
          }
        }

        /* Reduced motion (or the in-app kill switch): every CSS loop on the
           monitor parks — the static featured card carries the hero. */
        .crt-root[data-reduced='true'] .crt-static,
        .crt-root[data-reduced='true'] .crt-await-title {
          animation: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .crt-static,
          .crt-await-title {
            animation: none;
          }
        }
      `}</style>
    </section>
  )
})
