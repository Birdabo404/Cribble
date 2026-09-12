'use client'

// The PIN phase's lesson: a schematic Chrome toolbar, drawn in the site's
// own hairline vocabulary rather than a screenshot, with a cursor that
// walks the three steps on a loop — open the puzzle menu, pin Cribble,
// watch the mark land in the toolbar. Pinning is the one step the
// extension can't report, so this is the one place the flow teaches
// instead of listening.
//
// One GSAP timeline owns the whole loop. Its first beat is a `set` of the
// start frame, so every repeat resets itself; the markup React renders is
// the END frame (panel closed, mark pinned, callouts on), which is what
// reduced motion and a stopped lesson both show. Everything that moves is
// transform, opacity or the panel's clip-path.

import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { IconPuzzle } from '@/components/welcome/icons'
import { LiquidMark } from '@/components/brand/LiquidMark'
import {
  CRIBBLE_EASE,
  gsapLoop,
  parkOnHidden,
  welcomeMotionReduced
} from '@/components/welcome/welcomeMotion'

/* Design box, px. The schematic is laid out absolutely inside it so the
 * cursor's targets are stable; narrower viewports clip, never reflow. */
const BOX_W = 300
const BOX_H = 164

/* Cursor hotspot: the arrow's tip sits at (3, 2) on its 16-unit grid,
 * drawn at 14px. */
const TIP_X = 2.6
const TIP_Y = 1.75

const CURSOR_START = { x: 70, y: 140 }
const CURSOR_REST = { x: 150, y: 146 }

/* Panel clip states — the panel hangs from the puzzle button, so it grows
 * out of its top-right corner (an origin-aware reveal). */
const PANEL_CLOSED = 'inset(0% 0% 100% 100%)'
const PANEL_OPEN = 'inset(0% 0% 0% 0%)'

/* One full lesson, before the 1.2s repeat delay. */
const LESSON_S = 4.2

export function ToolbarLesson({ playing }: { playing: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const root = rootRef.current
      // A stopped lesson and a reduced-motion one both rest on the end
      // frame React already rendered: nothing to build.
      if (!root || !playing || welcomeMotionReduced()) return
      const q = gsap.utils.selector(root)

      const cursor = q('.tl-cursor')
      const puzzle = q('.tl-puzzle')
      const panel = q('.tl-panel')
      const rowHi = q('.tl-row-hi')
      const pinDim = q('.tl-pin-dim')
      const pinLit = q('.tl-pin-lit')
      const slotRing = q('.tl-slot-ring')
      const slotBloom = q('.tl-slot-bloom')
      const mark = q('.tl-mark')
      const callouts = q('.tl-callout')

      // Cursor targets, read once before any write. Layout is fixed px
      // inside the box, so the rects hold for the life of the timeline.
      const box = root.getBoundingClientRect()
      const tipAt = (el: Element | undefined) => {
        if (!el) return CURSOR_START
        const r = el.getBoundingClientRect()
        return {
          x: r.left - box.left + r.width / 2 - TIP_X,
          y: r.top - box.top + r.height / 2 - TIP_Y
        }
      }
      const puzzleAt = tipAt(puzzle[0])
      const pinAt = tipAt(pinLit[0])

      const tl = gsap.timeline({
        repeat: -1,
        repeatDelay: 1.2,
        defaults: { ease: CRIBBLE_EASE }
      })

      // Start frame, re-applied on every repeat.
      tl.set(cursor, { x: CURSOR_START.x, y: CURSOR_START.y, autoAlpha: 0 }, 0)
      tl.set([mark, callouts, rowHi, pinLit, slotBloom], { autoAlpha: 0 }, 0)
      tl.set([pinDim, slotRing], { autoAlpha: 1 }, 0)
      tl.set(panel, { autoAlpha: 0, clipPath: PANEL_CLOSED }, 0)
      tl.set(puzzle, { scale: 1 }, 0)

      // 01 — the cursor glides to the puzzle piece and presses it.
      tl.to(cursor, { autoAlpha: 1, duration: 0.15 }, 0)
      tl.to(cursor, { x: puzzleAt.x, y: puzzleAt.y, duration: 0.5 }, 0)
      tl.to(puzzle, { scale: 0.94, duration: 0.12, ease: 'power2.out' }, 0.5)
      tl.to(puzzle, { scale: 1, duration: 0.12 }, 0.62)
      tl.to(callouts[0], { autoAlpha: 1, duration: 0.2 }, 0.5)

      // The menu unfolds from the button on release (a clip-path reveal).
      tl.to(panel, { autoAlpha: 1, duration: 0.1 }, 0.7)
      tl.to(panel, { clipPath: PANEL_OPEN, duration: 0.28 }, 0.7)

      // 02 — the Cribble row lights, the cursor finds its pin.
      tl.to(rowHi, { autoAlpha: 1, duration: 0.16 }, 1.1)
      tl.to(callouts[1], { autoAlpha: 1, duration: 0.2 }, 1.1)
      tl.to(cursor, { x: pinAt.x, y: pinAt.y, duration: 0.4 }, 1.2)
      // Pin fills accent with a small pop in — from 0.9, never from nothing.
      tl.to(pinDim, { autoAlpha: 0, duration: 0.16 }, 1.6)
      tl.fromTo(
        pinLit,
        { scale: 0.9, autoAlpha: 0 },
        { scale: 1, autoAlpha: 1, duration: 0.16, immediateRender: false },
        1.6
      )

      // The menu folds back into the button; the cursor drifts clear.
      tl.to(panel, { clipPath: PANEL_CLOSED, duration: 0.2 }, 2.0)
      tl.to(panel, { autoAlpha: 0, duration: 0.1 }, 2.1)
      tl.to(cursor, { x: CURSOR_REST.x, y: CURSOR_REST.y, duration: 0.45 }, 2.05)

      // 03 — the mark slides into the pinned slot and blooms once.
      tl.to(slotRing, { autoAlpha: 0, duration: 0.2 }, 2.25)
      tl.fromTo(
        mark,
        { x: -10, scale: 0.9, autoAlpha: 0 },
        { x: 0, scale: 1, autoAlpha: 1, duration: 0.32, immediateRender: false },
        2.25
      )
      tl.fromTo(
        slotBloom,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.16, immediateRender: false },
        2.57
      )
      tl.to(slotBloom, { autoAlpha: 0, duration: 0.24 }, 2.73)
      tl.to(callouts[2], { autoAlpha: 1, duration: 0.2 }, 2.57)
      tl.to(cursor, { autoAlpha: 0, duration: 0.25 }, 2.8)

      // Hold the pinned frame out to the lesson's full length.
      tl.to({}, { duration: LESSON_S - 3.0 }, 3.0)

      return parkOnHidden([gsapLoop(tl)])
    },
    { scope: rootRef, dependencies: [playing], revertOnUpdate: true }
  )

  return (
    <div
      ref={rootRef}
      role="img"
      aria-label="Open the puzzle menu in the Chrome toolbar, pin Cribble, and the mark stays in the toolbar."
      className="relative mx-auto max-w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/70"
      style={{ width: BOX_W, height: BOX_H }}
    >
      {/* Toolbar strip */}
      <div className="absolute inset-x-0 top-0 h-11 border-b border-zinc-800" />
      <div className="absolute left-3 top-[10px] flex h-6 w-[132px] items-center rounded-full border border-zinc-800 px-3">
        <span className="font-mono text-[8px] tracking-[0.3em] text-zinc-700">
          {'///'}
        </span>
      </div>
      <div className="tl-puzzle absolute left-[176px] top-2 flex h-7 w-7 items-center justify-center rounded-md text-zinc-400">
        <IconPuzzle size={14} />
      </div>
      <div className="tl-slot absolute left-[212px] top-2 h-7 w-7">
        <span className="tl-slot-ring invisible absolute inset-[3px] rounded border border-dashed border-zinc-800 opacity-0" />
        <span
          className="tl-slot-bloom invisible absolute inset-[3px] rounded opacity-0"
          style={{ boxShadow: '0 0 12px 2px rgb(var(--accent-rgb) / 0.45)' }}
        />
        <span className="tl-mark absolute inset-0 flex items-center justify-center">
          <LiquidMark size={14} still />
        </span>
      </div>
      <span className="absolute left-[252px] top-[14px] h-4 w-4 rounded-full border border-zinc-800" />
      <span className="absolute left-[278px] top-2 flex h-7 w-1 flex-col items-center justify-center gap-[3px]">
        <span className="h-[2px] w-[2px] rounded-full bg-zinc-700" />
        <span className="h-[2px] w-[2px] rounded-full bg-zinc-700" />
        <span className="h-[2px] w-[2px] rounded-full bg-zinc-700" />
      </span>

      {/* Page ghost — two placeholder lines, so the strip reads as chrome
          over a page rather than a floating bar. */}
      <span className="absolute left-4 top-[62px] h-1 w-24 rounded bg-zinc-900" />
      <span className="absolute left-4 top-[74px] h-1 w-16 rounded bg-zinc-900" />

      {/* Extensions menu, hung from the puzzle button. */}
      <div className="tl-panel invisible absolute left-[36px] top-[42px] w-[168px] rounded-lg border border-zinc-800 bg-zinc-950 p-1.5 opacity-0">
        <div className="px-1.5 pb-1 pt-0.5 font-mono text-[7px] tracking-[0.3em] text-zinc-600">
          EXTENSIONS
        </div>
        <MutedRow />
        <MutedRow />
        <div className="tl-row relative flex h-6 items-center gap-2 rounded px-2">
          <span className="tl-row-hi invisible absolute inset-0 rounded bg-accent/[0.08] opacity-0" />
          <LiquidMark size={12} still />
          <span className="text-[10px] leading-none text-zinc-300">Cribble</span>
          <span className="relative ml-auto h-3 w-3">
            <span className="tl-pin-dim absolute inset-0 text-zinc-500">
              <PinGlyph />
            </span>
            <span className="tl-pin-lit invisible absolute inset-0 text-accent opacity-0">
              <PinGlyph filled />
            </span>
          </span>
        </div>
      </div>

      {/* Numbered callouts with hairline leaders — blueprint annotations
          that stay legible with the menu closed. */}
      <Callout n="01" className="left-[146px] top-[14px]" leader="right" />
      <Callout n="02" className="left-[212px] top-[116px]" leader="left" />
      <Callout n="03" className="left-[217px] top-[46px]" leader="up" />

      {/* Cursor — the one element promoted ahead of time; it moves the
          most. */}
      <span className="tl-cursor invisible absolute left-0 top-0 h-[14px] w-[14px] opacity-0 will-change-transform">
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          className="fill-zinc-100 stroke-zinc-950"
          strokeWidth="1"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 2v11.6l3.3-2.9 2.2 4.8 1.9-.9-2.1-4.7 4.4-.4z" />
        </svg>
      </span>
    </div>
  )
}

/** An extension the lesson isn't about: a swatch, a name bar, a dim pin. */
function MutedRow() {
  return (
    <div className="flex h-6 items-center gap-2 rounded px-2">
      <span className="h-3 w-3 rounded-sm bg-zinc-800" />
      <span className="h-1 w-14 rounded bg-zinc-800" />
      <span className="ml-auto h-3 w-3 text-zinc-800">
        <PinGlyph />
      </span>
    </div>
  )
}

/** Chrome's pin: a tack head over a needle. `filled` is the pinned state. */
function PinGlyph({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        d="M4.5 1.5h3v3l1.5 1.5v1h-6v-1l1.5-1.5z"
        fill={filled ? 'currentColor' : 'none'}
      />
      <path d="M6 7v3.5" />
    </svg>
  )
}

function Callout({
  n,
  className,
  leader
}: {
  n: string
  className: string
  leader: 'left' | 'right' | 'up'
}) {
  const leaderClass =
    leader === 'right'
      ? 'left-full top-1/2 h-px w-3'
      : leader === 'left'
      ? 'right-full top-1/2 h-px w-[18px]'
      : 'bottom-full left-1/2 h-[10px] w-px'
  return (
    <span className={`tl-callout absolute ${className}`}>
      <span className="relative inline-flex h-4 min-w-[18px] items-center justify-center rounded-full border border-accent/40 bg-zinc-950 px-1 font-mono text-[7px] leading-none tracking-[0.2em] text-accent">
        {n}
      </span>
      <span className={`absolute bg-accent/40 ${leaderClass}`} />
    </span>
  )
}
