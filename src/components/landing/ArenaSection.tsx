'use client'

// Sheet 01 — ARENA. The manifest's next page after the hero: Sheet.tsx
// draws the frame (section + Stage, top rule, rail row, the serif hook and
// its spec list) and this file fills its slots — the rail's live PILOTS
// datum, the artifact (a simulated board drawn as the hero Tower's table)
// and the stat strip under the grid.
//
// The board is a real <table> on hero/towerStyles.ts (TH/TD/LINE/YOU_LINE/
// COL_*), so it and the hero tower are one instrument: 36px column heads,
// 42px rows, per-cell top hairlines, Plex Mono 12px tabular, dim P, ink
// callsign and score, dim gap, the dashed `you` row linking to /login. The
// one addition is a 28×16 plate swatch between P and CALLSIGN — PlateLayer
// clipped to a chip, never a banner behind the row.
//
// Mechanics are carried over intact. Act one, the takeover: the board
// boots with the old guard (sama, elonmusk, mntruell, naval); the
// insurgents warp in one by one (TAKEOVER_EVENTS), derank their victim and
// knock them off. Act two, the standing duel: scores tick on anime timers
// (useSectionMotion), the crown never falls, and every re-sort is a FLIP
// pass over a React commit — each row's top is captured right before the
// state update, and the layout effect tweens it from where it was to where
// it landed, transform-only on the <tr>s. Hand-rolled rather than GSAP's
// Flip plugin: Flip drops its bounds-only `simple` path the moment a row's
// measured height differs by a float ulp between capture and commit, and
// its matrix fallback probes a <tr> by appending temp <div>s inside it —
// inside a table those land in anonymous cells and every surviving row
// would start its glide a few hundred px off (seen in the harness). SSR /
// no-JS / reduced motion render the final cast (SIM_ROSTER) at rest.
//
// Motion vocabulary is the hero's. Entrances are the Stage's `.st` /
// `.st-line` with inline --d (rows lift 50ms apart like the tower's). A
// gaining score snaps to the signal color for one frame via .lx-tick
// (globals.css [data-tick] — useTowerLiveness.ts's beat); a warping row
// snaps a hairline-grey fill that eases off; the LIVE square dips on every
// beat; the `+N` gain is Plex Mono ink lifting 8px and fading. Transform +
// opacity only — no glow, ring, gradient, tilt, scrub or radius.

import { CSSProperties, ReactNode, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { CRIBBLE_EASE_NAME, landingTier } from '@/lib/landingMotion'
import type { LandingLive } from '@/lib/landingLive'
import {
  ARENA_STATS,
  SIM_ROSTER,
  TAKEOVER_EVENTS,
  TAKEOVER_START,
  type ArenaStat,
  type SimPilot
} from './data'
import { formatScore } from './hero/towerFormat'
import {
  COL_CALLSIGN,
  COL_GAP,
  COL_ORG,
  COL_POS,
  COL_SCORE,
  LINE,
  TD,
  TH,
  YOU_LINE
} from './hero/towerStyles'
import { CountUp, TickerCounter } from './scrollFx'
import {
  Sheet,
  SHEET_CELL,
  SHEET_DIM,
  SHEET_INK,
  SHEET_LABEL,
  SHEET_LINE,
  type SheetSpec
} from './Sheet'
import { useSectionMotion } from './useSectionMotion'

/** A row's top before a commit, relative to the board wrapper — both
 *  measured in the same frame, so a ScrollSmoother step between capture
 *  and commit cancels out instead of leaking into the glide. */
type RowTops = Map<HTMLElement, number>
type Gain = { id: string; amt: number; seq: number }

/** The DOM the sim writes to, collected through callback refs so no
 *  measurement ever costs a React render. */
type BoardEls = {
  /** Ranked rows by pilot id; document order is rank order. */
  rows: Map<string, HTMLTableRowElement>
  /** The dashed open slot. */
  you: HTMLTableRowElement | null
  /** The clipped board wrapper whose height act one freezes. */
  panel: HTMLDivElement | null
  /** The LIVE SIM signal square. */
  live: HTMLSpanElement | null
}

const SPECS: SheetSpec[] = [
  { label: 'TABLE', value: 'ONE, GLOBAL' },
  { label: 'RE-SORT', value: 'ON EVERY SYNC' },
  { label: 'BRACKETS · REGIONS · QUEUE', value: 'NONE' }
]

/** The plate swatch column — the arena's one addition to the tower's. */
const COL_PLATE = 'pr-3 text-left'

const COLUMNS: { label: string; col: string; srOnly?: boolean }[] = [
  { label: 'P', col: COL_POS },
  { label: 'PLATE', col: COL_PLATE, srOnly: true },
  { label: 'CALLSIGN', col: COL_CALLSIGN },
  { label: 'ORG', col: COL_ORG },
  { label: 'SCORE', col: COL_SCORE },
  { label: 'GAP', col: COL_GAP }
]

/** Stat strip cells: a 2×2 grid below sm, one rail row from sm. Each cell
 *  owns its left hairline (and a top one on the phone grid's second row)
 *  so nothing doubles; the first has neither — the sheet edge is its rule. */
const STAT_CELL = [
  'pr-3 sm:pr-5',
  'border-l px-3 sm:px-5',
  'border-t pr-3 sm:border-l sm:border-t-0 sm:px-5',
  'border-l border-t px-3 sm:border-t-0 sm:px-5'
]

// Entrance offsets (ms) inside the Sheet's Stage. The Sheet's rail runs
// 60–180, its hook at 120, its spec rows 300–400; the board then fills in
// top-down like the hero tower — header rail, its rule, column heads 40ms
// apart, rows 50ms apart once the left-hand heads are in, the open slot —
// and the stat strip under the grid closes the sheet (~1.4s end to end).
const at = (ms: number): CSSProperties => ({ '--d': `${ms}ms` } as CSSProperties)
const RAIL_MS = 200
const RAIL_STEP_MS = 40
const RAIL_LINE_MS = 220
const HEAD_MS = 300
const HEAD_STEP_MS = 40
const ROW_MS = HEAD_MS + 4 * HEAD_STEP_MS
const ROW_STEP_MS = 50
const YOU_MS = ROW_MS + SIM_ROSTER.length * ROW_STEP_MS
const NOTE_MS = YOU_MS + 60
const STAT_MS = YOU_MS + 20
const STAT_STEP_MS = 40

// Takeover pacing, ms after the stage goes live. The entrance settles by
// ~1.2s; each event then plays in three beats — warp-in at T, the freshly
// deranked victim starts falling at T+EXIT_AT (once the derank push
// lands), and leaves the DOM when the fall finishes.
const TK_T0 = 2400
const TK_STEP = 2800
const TK_EXIT_AT = 820
const TK_EXIT_MS = 680

const ARRIVER_IDS = new Set(TAKEOVER_EVENTS.map((e) => e.enter.id))

// Snap classes: pinned for one painted frame, then dropped so the CSS
// transition eases the property back — the hero tower's tick pattern.
/** globals.css `.lx-descent [data-tick].lx-tick` → signal color. */
const TICK_CLASS = 'lx-tick'
/** The LIVE square dips to 0.35 (styled-jsx below). */
const BEAT_CLASS = 'ar-beat'
/** A warping row's hairline-grey fill (styled-jsx below). */
const WARP_CLASS = 'ar-warp'

function snap(el: HTMLElement | null, cls: string) {
  if (!el) return
  el.classList.add(cls)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.remove(cls))
  })
}

/** The number a stat cell prints: the live reading where one exists, the
 *  staged figure where the cell describes the staged cast, null → dash. */
function arenaStatValue(stat: ArenaStat, live: LandingLive): number | null {
  switch (stat.key) {
    case 'players':
      return live.playerCount
    case 'syncedToday':
      return live.activeToday
    case 'topScore':
      return stat.staged ?? null
    case 'seasonEnds':
      return live.season?.daysLeft ?? stat.staged ?? null
    default: {
      const exhaustive: never = stat.key
      return exhaustive
    }
  }
}

/** A stat's count-up, in the register its format asks for: days read as
 *  the rail's `D-29`. */
function statValue(stat: ArenaStat, value: number, delay: number): ReactNode {
  switch (stat.format) {
    case 'number':
    case 'score':
      return <CountUp to={value} duration={1600} delay={delay} />
    case 'days':
      return (
        <>
          D-
          <CountUp to={value} duration={1200} delay={delay} />
        </>
      )
    default: {
      const exhaustive: never = stat.format
      return exhaustive
    }
  }
}

const formatTicked = (v: number) => formatScore(Math.round(v))

/** Distance behind the current leader; the leader prints an em dash. Real
 *  minus (U+2212) so the gaps sit on the same tabular grid as the digits —
 *  towerFormat.formatGap's shape, against a leader whose score moves. */
function formatBehind(v: number): string {
  const behind = Math.round(v)
  return behind <= 0 ? '—' : `−${formatScore(behind)}`
}

/** Every row the FLIP pass moves: the ranked rows plus the dashed open
 *  slot, which slides with them when a transient eleventh row pushes it
 *  under the wrapper's clip edge. */
function flipTargets(els: BoardEls): HTMLElement[] {
  const rows: HTMLElement[] = Array.from(els.rows.values())
  if (els.you) rows.push(els.you)
  return rows
}

/** Where each row sits right now, relative to the board wrapper. */
function rowTops(els: BoardEls): RowTops {
  const base = els.panel?.getBoundingClientRect().top ?? 0
  const tops: RowTops = new Map()
  for (const row of flipTargets(els)) {
    tops.set(row, row.getBoundingClientRect().top - base)
  }
  return tops
}

function useArenaSim(els: { current: BoardEls }) {
  const [pilots, setPilots] = useState<SimPilot[]>(SIM_ROSTER)
  const [gain, setGain] = useState<Gain | null>(null)
  const seqRef = useRef(0)
  // Handoff to the FLIP pass in Board: every commit that moves rows
  // captures their tops right before the state update; the layout effect
  // consumes them. Commits without a capture (mount rewind, reduced-motion
  // reset) intentionally don't animate.
  const flipStateRef = useRef<RowTops | null>(null)

  // Rewind to the old guard before first paint — the takeover needs someone
  // to dethrone. SSR / no-JS / the still tier keep the final cast instead.
  useLayoutEffect(() => {
    if (landingTier() === 'still') return
    setPilots(TAKEOVER_START)
  }, [])

  const motionRef = useSectionMotion(
    'arena',
    ({ motion, timer }) => {
      // Rebuild rewind (reduced motion flipped back off mid-session): the
      // replay needs the old guard on the board again. First run is a
      // no-op — the layout effect above already committed TAKEOVER_START.
      setPilots(TAKEOVER_START)
      setGain(null)

      const captureRows = () => {
        const tops = rowTops(els.current)
        if (tops.size) flipStateRef.current = tops
      }

      // When act one hands over to act two (row count back to the settled
      // six, so releasing the freeze below moves nothing).
      const settled =
        TK_T0 + (TAKEOVER_EVENTS.length - 1) * TK_STEP + TK_EXIT_AT + TK_EXIT_MS

      // Freeze the board's height for act one. Each takeover event briefly
      // holds a seventh ranked row, and even as an instant layout change
      // that grows the table 42px and shrinks it back — and inside
      // ScrollSmoother every document-height change forces a full
      // ScrollTrigger refresh (measured as a recurring long-task storm
      // while the arena is on screen). The wrapper is overflow-hidden, so
      // the transient extra row just clips at the bottom edge — the open
      // slot shoved under the board while someone falls off — and the page
      // never sees a resize. Act two only re-sorts a fixed cast, so the
      // natural height is static again once this releases.
      const panel = els.current.panel
      if (panel) {
        panel.style.height = `${panel.offsetHeight}px`
        timer({
          duration: settled,
          onComplete: () => panel.style.removeProperty('height')
        })
      }

      // Act one — the takeover. Each insurgent warps in one slot above
      // their victim (the FLIP pass slides the rows below down to make
      // room), the victim stalls, falls off the board in place, and the
      // rows below close over the gap on the removal commit's FLIP pass.
      TAKEOVER_EVENTS.forEach((ev, k) => {
        const t = TK_T0 + k * TK_STEP
        timer({
          duration: t,
          onComplete: () => {
            captureRows()
            snap(els.current.live, BEAT_CLASS)
            setGain({ id: ev.enter.id, amt: ev.enter.today, seq: ++seqRef.current })
            setPilots((prev) => [...prev, ev.enter].sort((a, b) => b.score - a.score))
          }
        })
        timer({
          duration: t + TK_EXIT_AT,
          onComplete: () => {
            const el = els.current.rows.get(ev.drop)
            if (!el) return
            // stall → fall: the row keeps its slot while it dies, so
            // nothing below reflows until the removal commit.
            motion.gsap
              .timeline()
              .to(el, { opacity: 0.75, duration: (TK_EXIT_MS / 1000) * 0.42 })
              .to(el, {
                opacity: 0,
                y: 32,
                duration: (TK_EXIT_MS / 1000) * 0.58,
                ease: 'power2.in'
              })
          }
        })
        timer({
          duration: t + TK_EXIT_AT + TK_EXIT_MS,
          onComplete: () => {
            captureRows()
            setPilots((prev) => prev.filter((p) => p.id !== ev.drop))
          }
        })
      })

      // Act two — the standing duel, resumed once the new cast holds the
      // board (which by then equals SIM_ROSTER exactly, so the pool stays
      // tuned).
      const pool = SIM_ROSTER.flatMap((p) => Array<string>(p.heat).fill(p.id))

      // Dramaturgy: the crown never falls — @birdabo holds #1 — but the
      // fight stays hot. Challengers take runs at the leader; the moment
      // the gap gets thin the champion answers with a counter-surge.
      // Meanwhile the silver duel below flips ranks while you watch. Max
      // challenger surge (1100) < defense trigger (1800), so the counter
      // always lands in time. (No document.hidden check: the anime engine
      // pauses itself in background tabs via engine.pauseOnDocumentHidden.)
      const tick = () => {
        captureRows()
        snap(els.current.live, BEAT_CLASS)
        setPilots((prev) => {
          const leader = prev[0]
          let id: string
          let amt: number
          if (leader.score - prev[1].score < 1800) {
            id = leader.id
            amt = 1700 + Math.floor(Math.random() * 900)
          } else {
            const r = Math.random()
            if (r < 0.34) {
              // silver duel — #3 lunges at #2
              id = prev[2].id
              amt = 520 + Math.floor(Math.random() * 580)
            } else if (r < 0.52) {
              // a run at the champion
              id = prev[1].id
              amt = 480 + Math.floor(Math.random() * 620)
            } else {
              id = pool[Math.floor(Math.random() * pool.length)]
              amt = 160 + Math.floor(Math.random() * 680)
            }
            // The crown never falls: if a surge would clear the champion,
            // the champion answers on the same tick instead.
            const target = prev.find((p) => p.id === id)
            if (target && id !== leader.id && target.score + amt > leader.score - 140) {
              id = leader.id
              amt = 1700 + Math.floor(Math.random() * 900)
            }
          }
          setGain({ id, amt, seq: ++seqRef.current })
          return prev
            .map((p) =>
              p.id === id ? { ...p, score: p.score + amt, today: p.today + amt } : p
            )
            .sort((a, b) => b.score - a.score)
        })
      }
      // onBegin fires once the delay elapses (a setTimeout's job), onLoop
      // every 2200ms after — a setInterval's.
      timer({
        delay: settled + 1600,
        duration: 2200,
        loop: true,
        onBegin: tick,
        onLoop: tick
      })

      return () => {
        // Reduced motion flipped on mid-flight: land on the final cast —
        // the same resolved state SSR renders. No capture, so the FLIP
        // pass lets the reset commit land without animating. The height
        // freeze releases too — its timer died with the scope.
        flipStateRef.current = null
        panel?.style.removeProperty('height')
        setPilots(SIM_ROSTER)
        setGain(null)
      }
    },
    [els]
  )

  return { pilots, gain, flipStateRef, motionRef }
}

/** The pilot's plate, clipped to a 28×16 swatch — art as a chip in the P
 *  column's wake, never a banner behind the row. No plate: an empty
 *  hairline box, the compartment with nothing in it. */
function PlateSwatch({ plateId }: { plateId: string | null }) {
  return (
    <span
      aria-hidden
      className={`relative block h-4 w-7 overflow-hidden ${
        plateId ? '' : `border ${SHEET_LINE}`
      }`}
    >
      {plateId && <PlateLayer plateId={plateId} fade="none" />}
    </span>
  )
}

function Row({
  pilot,
  rank,
  leaderScore,
  gain,
  entranceDelay,
  refFn
}: {
  pilot: SimPilot
  rank: number
  leaderScore: number
  gain: Gain | null
  entranceDelay: number
  refFn: (el: HTMLTableRowElement | null) => void
}) {
  const gained = gain?.id === pilot.id ? gain : null
  // Insurgents warp in through the FLIP pass's entered branch instead of
  // the staged entrance — `.st` would replay the lift on top of it.
  const arriver = ARRIVER_IDS.has(pilot.id)
  // The first row skips its own hairline: the column heads' bottom border
  // is that rule (Tower.tsx's rule, same reason).
  const line = rank === 1 ? '' : LINE

  return (
    <tr
      ref={refFn}
      className={`${arriver ? '' : 'st '}ar-row`}
      style={at(entranceDelay)}
    >
      <td className={`${TD} ${line} ${COL_POS} ${SHEET_DIM}`}>
        {String(rank).padStart(2, '0')}
      </td>
      <td className={`${TD} ${line} ${COL_PLATE}`}>
        <PlateSwatch plateId={pilot.plate} />
      </td>
      <td className={`${TD} ${line} ${COL_CALLSIGN} ${SHEET_INK}`}>
        {pilot.callsign}
      </td>
      <td
        className={`${TD} ${line} ${COL_ORG} text-[length:var(--fs-label)] tracking-[0.18em] ${SHEET_DIM}`}
      >
        {pilot.org}
      </td>
      {/* relative on the <td> (not the <tr> — Safari) seats the gain
          popup over the digits. */}
      <td className={`${TD} ${line} ${COL_SCORE} relative ${SHEET_INK}`}>
        <data value={String(pilot.score)} data-tick>
          <TickerCounter value={pilot.score} duration={900} formatter={formatTicked} />
        </data>
        {gained && (
          <span
            key={gained.seq}
            data-gain
            aria-hidden
            className={`pointer-events-none absolute right-0 top-0 whitespace-nowrap ${SHEET_LABEL} ${SHEET_INK} sm:right-3`}
            style={{ opacity: 0 }}
          >
            +{formatScore(gained.amt)}
          </span>
        )}
      </td>
      <td className={`${TD} ${line} ${COL_GAP} ${SHEET_DIM}`}>
        <TickerCounter
          value={leaderScore - pilot.score}
          duration={900}
          formatter={formatBehind}
        />
      </td>
    </tr>
  )
}

/** The artifact: header rail, column heads, the ranked rows, the open slot. */
function Board() {
  const els = useRef<BoardEls>({ rows: new Map(), you: null, panel: null, live: null })
  const { pilots, gain, flipStateRef, motionRef } = useArenaSim(els)
  const order = pilots.map((p) => p.id).join('|')
  const leaderScore = pilots[0]?.score ?? 0

  // The FLIP pass: the sim captures row tops right before every animated
  // commit (flipStateRef); here — post-commit, pre-paint — each surviving
  // row is set back to where it was and glides into its new slot, y-only
  // (a row never moves sideways; the table's width is fixed). Rows that
  // entered since the capture (the insurgents) warp in with the tower's
  // row lift behind a grey snap; rows that left (fallen victims) already
  // played their exit in place, so the slide-up of the rows below is their
  // whole goodbye.
  useLayoutEffect(() => {
    const state = flipStateRef.current
    flipStateRef.current = null
    const motion = motionRef.current?.motion
    // Reduced motion (OS or in-app, possibly flipped mid-session): the
    // sim's revert commit still reaches here — land instantly, no glide.
    if (!state || !motion || landingTier() === 'still') return
    const { gsap } = motion
    const entered: HTMLElement[] = []
    for (const [row, top] of rowTops(els.current)) {
      const was = state.get(row)
      if (was === undefined) {
        entered.push(row)
        continue
      }
      const dy = was - top
      if (Math.abs(dy) < 0.5) continue
      gsap.fromTo(
        row,
        { y: dy },
        { y: 0, duration: 0.64, ease: CRIBBLE_EASE_NAME, clearProps: 'transform' }
      )
    }
    if (!entered.length) return
    entered.forEach((el) => snap(el, WARP_CLASS))
    gsap.fromTo(
      entered,
      { autoAlpha: 0, y: 8 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.5,
        ease: CRIBBLE_EASE_NAME,
        clearProps: 'opacity,visibility,transform'
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

  // The gain beat, same commit as the re-sort: the gaining row's score
  // cell snaps to signal for a frame (.lx-tick, eased back by the CSS
  // transition in globals.css) and its `+N` lifts 8px and fades. The popup
  // is keyed on the gain's seq, so each beat animates a fresh span.
  useLayoutEffect(() => {
    if (!gain) return
    const motion = motionRef.current?.motion
    const row = els.current.rows.get(gain.id)
    if (!motion || !row) return
    snap(row.querySelector<HTMLElement>('[data-tick]'), TICK_CLASS)
    const pop = row.querySelector<HTMLElement>('[data-gain]')
    if (!pop) return
    const tween = motion.gsap.fromTo(
      pop,
      { autoAlpha: 1, y: -8 },
      { autoAlpha: 0, y: -16, duration: 1.2, ease: 'power2.out' }
    )
    return () => {
      tween.kill()
    }
  }, [gain, motionRef])

  return (
    <>
      {/* ar-panel: the clipped wrapper act one freezes (see useArenaSim);
          also the screenshot harness's hook. The Sheet's artifact column
          is flush (artifactFlush), so COL_POS's lg:pl-5 puts P 20px off
          the vertical hairline like the hero Tower; the leading rail cell
          takes the same inset so the rail reads flush with P. */}
      <div
        ref={(el) => {
          els.current.panel = el
        }}
        className="ar-panel overflow-hidden"
      >
        {/* Board rail — a Sheet-style rail row at the tower header's
            height; each cell owns its left hairline. */}
        <div className={`flex h-9 items-stretch ${SHEET_LABEL} ${SHEET_DIM}`}>
          <div
            className={`st flex items-center whitespace-nowrap pr-3 sm:pr-5 lg:pl-5 ${SHEET_INK}`}
            style={at(RAIL_MS)}
          >
            STANDINGS · SEASON 01
          </div>
          <div
            className={`st ${SHEET_CELL} gap-2.5 whitespace-nowrap`}
            style={at(RAIL_MS + RAIL_STEP_MS)}
          >
            <span
              ref={(el) => {
                els.current.live = el
              }}
              aria-hidden
              className="ar-live h-1.5 w-1.5 shrink-0"
              style={{ background: 'var(--lx-signal)' }}
            />
            LIVE SIM
          </div>
          <div
            className={`st ${SHEET_CELL} ml-auto hidden whitespace-nowrap sm:flex`}
            style={at(RAIL_MS + 2 * RAIL_STEP_MS)}
          >
            RE-SORTS ON SYNC
          </div>
        </div>
        <span
          aria-hidden
          className="st-line block h-px w-full"
          style={{ background: 'var(--lx-line)', ...at(RAIL_LINE_MS) }}
        />

        {/* Separate borders with zero spacing, not collapsed: collapsed
            borders belong to the table's grid and ignore a row's opacity,
            so they would sit whole over rows still fading in (Tower.tsx).
            The column heads carry the header rule as per-cell bottom
            borders — no absolutely positioned hairline inside a <tr>,
            which Safari would not contain. */}
        <table className="w-full border-separate border-spacing-0 font-data text-[12px] tabular-nums">
          <caption className="sr-only">Simulated global standings, season 01</caption>
          <thead>
            <tr>
              {COLUMNS.map((c, i) => (
                <th
                  key={c.label}
                  scope="col"
                  className={`st ${TH} border-b ${SHEET_LINE} ${c.col}`}
                  style={at(HEAD_MS + i * HEAD_STEP_MS)}
                >
                  {c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pilots.map((p, i) => (
              <Row
                key={p.id}
                pilot={p}
                rank={i + 1}
                leaderScore={leaderScore}
                gain={gain}
                entranceDelay={ROW_MS + i * ROW_STEP_MS}
                refFn={(el) => {
                  if (el) els.current.rows.set(p.id, el)
                  else els.current.rows.delete(p.id)
                }}
              />
            ))}

            {/* The open slot — the tower's pitch row, verbatim. One link,
                stretched over the row with an ::after so the whole slot is
                the target while the tab order stays one stop. */}
            <tr
              ref={(el) => {
                els.current.you = el
              }}
              className="st ar-you group relative transition-colors hover:bg-[color:rgb(var(--z900)/0.55)]"
              style={at(YOU_MS)}
            >
              <td className={`${TD} ${YOU_LINE} ${COL_POS} ${SHEET_DIM}`}>
                <span aria-hidden>··</span>
              </td>
              <td className={`${TD} ${YOU_LINE} ${COL_PLATE}`}>
                {/* dashed = yours: the swatch you haven't equipped yet */}
                <span
                  aria-hidden
                  className="block h-4 w-7 border border-dashed border-[color:var(--lx-line-strong)]"
                />
              </td>
              <td className={`${TD} ${YOU_LINE} ${COL_CALLSIGN}`}>
                <Link
                  href="/login"
                  title="THIS SLOT IS OPEN"
                  aria-label="you — claim your spot"
                  className="text-[color:var(--lx-ink)] transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-[color:var(--lx-signal)]"
                >
                  you
                </Link>
              </td>
              <td className={`${TD} ${YOU_LINE} ${COL_ORG}`} />
              <td
                className={`${TD} ${YOU_LINE} ${COL_SCORE} text-[color:var(--lx-ink-faint)]`}
              >
                <span aria-hidden>——————</span>
              </td>
              <td
                className={`${TD} ${YOU_LINE} ${COL_GAP}`}
                style={{ color: 'var(--lx-signal)' }}
              >
                ∞
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p
        className={`st mt-3 text-right ${SHEET_LABEL} ${SHEET_DIM}`}
        style={at(NOTE_MS)}
      >
        SIMULATION · STAGED CAST · REAL MECHANICS
      </p>

      {/* The board's three snaps and one Safari seat. Every rule is a
          transition on one property or a static transform — no keyframes.
          styled-jsx dedupes identical global blocks. */}
      <style jsx global>{`
        /* LIVE square: dips on each beat, eases back over the site curve. */
        .ar-live {
          transition: opacity 400ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ar-live.ar-beat {
          opacity: 0.35;
          transition: none;
        }
        /* Warp-in: the arriving row snaps the you-row's hover fill and
           lets it drain — the only fill a ranked row ever carries. */
        .ar-row {
          transition: background-color 600ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ar-row.ar-warp {
          background-color: rgb(var(--z900) / 0.55);
          transition: none;
        }
        /* Safari ignores position: relative on <tr>, so the link's ::after
           would stretch to the clipped wrapper instead of the row; a
           transformed row is a containing block in every engine. GSAP's
           inline transforms override this during the entrance and FLIP
           passes and settle back on it. */
        .ar-you {
          transform: translate(0);
        }
      `}</style>
    </>
  )
}

/** The rail's live datum: the signal square and the board's head-count
 *  (the same live reading the hero rail prints; a failed read is a dash,
 *  never an invented number). */
function PilotsDatum({ count }: { count: number | null }) {
  return (
    <>
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0"
        style={{ background: 'var(--lx-signal)' }}
      />
      <span>
        <span className={SHEET_INK}>
          {count === null ? '—' : <CountUp to={count} duration={1200} delay={140} />}
        </span>{' '}
        PILOTS
      </span>
    </>
  )
}

/** Sheet children: the four ARENA_STATS as one hairline rail of cells
 *  under the grid — the hero footer strip's shape. Head-counts are the
 *  live readings; TOP SCORE is staged with the cast on the board above. */
function StatStrip({ live }: { live: LandingLive }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 ${SHEET_LABEL} ${SHEET_DIM}`}>
      {ARENA_STATS.map((s, i) => {
        const value = arenaStatValue(s, live)
        const delay = STAT_MS + i * STAT_STEP_MS
        return (
          <div
            key={s.key}
            className={`st flex h-12 items-center gap-x-3 whitespace-nowrap ${SHEET_LINE} ${STAT_CELL[i]}`}
            style={at(delay)}
          >
            <span>{s.label}</span>
            <span className={SHEET_INK}>
              {value === null ? '—' : statValue(s, value, delay)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function ArenaSection({ live }: { live: LandingLive }) {
  return (
    <Sheet
      id="arena"
      index="01"
      label="ARENA"
      datum={<PilotsDatum count={live.playerCount} />}
      hook={
        <>
          somebody holds #1. it isn&apos;t you. <em>yet</em>.
        </>
      }
      specs={SPECS}
      artifact={<Board />}
      artifactFlush
    >
      <StatStrip live={live} />
    </Sheet>
  )
}
