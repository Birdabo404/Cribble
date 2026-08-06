'use client'

// The Billboard banner — paid ads + free top-3 hype items shown one at
// a time, news-flipper style, in a ~88px row that expands in-flow under
// the nav on the dashboard and leaderboard, pushing page content down.
// Mounted once inside .app-nav-inset in AppShell and self-gating: it
// never starts a show off the two allowed routes, and a localStorage
// timestamp caps appearances to one per 20 minutes per visitor.
// Visitors parked on an allowed route aren't stranded: while the banner
// is hidden there, a retry tick re-attempts the show every RETRY_TICK_MS,
// so a lapsing cooldown or a newly activated ad surfaces the banner
// without a fresh navigation. The tick only runs while the tab is
// visible — background tabs don't poll — and becoming visible again
// re-attempts immediately instead of waiting out a fresh interval.
//
// One show: after a short delay (so the expand doesn't fight initial
// page paint) the grid slot animates 0fr -> 1fr, then the flipper
// rotates — each item holds for HOLD_MS, then flips out (slides up +
// fades) while the next flips in from below — until the 3-minute
// wall-clock end, when the slot collapses and content slides back up.
// Hovering the banner pauses rotation for this visitor only: the
// unspent hold is banked and resumed on unhover, and the progress bar
// pauses via CSS animation-play-state — but the end-of-show is
// wall-clock, so hovering doesn't extend it. Navigating off an allowed
// route mid-show triggers the animated collapse; every way a show ends
// records the cooldown timestamp. Navigating between the two allowed
// routes keeps the show running (the mount survives client navigation).
// An empty (or failed) /api/billboard fetch records no cooldown, but
// arms a fetch backoff: retry ticks skip fetching for EMPTY_RETRY_MS
// afterwards. Route changes clear the backoff, so a genuine landing
// always fetches. Exactly one fetched item: no flips and no counter,
// but not a static block either — every SOLO_REPLAY_MS the sub-banner
// re-keys in place so its build-in replays (no flip-out layer, no
// vertical motion), with the progress bar sweeping at that cadence.
// The replay clock is the same pause-aware hold timer, so hovering
// banks the remaining cycle exactly like a multi-item hold does.
//
// Phases advance on transitionend of grid-template-rows, with a timer
// fallback slightly longer than the transition for when it can't fire
// (reduced motion disables the transition; a display:none ancestor
// would swallow it too).
//
// prefers-reduced-motion: swaps are instant (no leaving layer mounts,
// so no flip animations render), the progress bar is dropped, the
// build-in classes are animation:none (globals.css) and the solo
// replay re-key is skipped, but the HOLD_MS cadence and the 3-minute
// show are unchanged.

import type { CSSProperties, TransitionEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Avatar } from '@/components/leaderboard/Avatar'
import type { BillboardItem } from '@/lib/billboard'
import { BillboardCard } from './BillboardCard'

const TICKER_PATHS = ['/dashboard', '/leaderboard']
/** Per-visitor frequency gate — epoch ms of when the last show ended. */
const LAST_SHOWN_KEY = 'cribble:billboard-last-shown'
const SHOW_EVERY_MS = 20 * 60_000
/** While hidden on an allowed route, how often the retry tick re-attempts. */
const RETRY_TICK_MS = 60_000
/** How long retry ticks skip fetching after an empty (or failed) fetch. */
const EMPTY_RETRY_MS = 5 * 60_000
/** How long a show runs before the banner retracts on its own. */
const SHOW_FOR_MS = 180_000
/** How long each item holds on screen before flipping to the next. */
const HOLD_MS = 8_000
/** Solo shows (exactly one item): how often the sub-banner re-keys so
 *  its build-in replays — no flip, and the progress bar cycles at this
 *  cadence instead of HOLD_MS. */
const SOLO_REPLAY_MS = 24_000
/** Must match the billboard-flip-in/out animation duration in globals.css. */
const FLIP_MS = 450
/** When the outgoing layer is dropped — after the flip-out has played,
 *  with headroom; doubles as cleanup for when the animation can't run. */
const FLIP_CLEAR_MS = FLIP_MS + 150
/** Breather after landing before the expand starts. */
const ENTER_DELAY_MS = 600
/** Must match the .billboard-slot grid-template-rows transition. */
const SLOT_TRANSITION_MS = 560
/** Fallback when transitionend never fires (reduced motion, hidden ancestors). */
const TRANSITION_FALLBACK_MS = SLOT_TRANSITION_MS + 200

type Phase = 'hidden' | 'entering' | 'looping' | 'leaving'

// In-memory fallback gate: if localStorage reads work but writes throw
// (Safari private-mode quota), the recorded timestamp never lands and
// every show completion would immediately re-arm — this keeps the cap
// honest for the tab's lifetime.
let lastShownSessionMs = 0

function canShowNow(): boolean {
  if (Date.now() - lastShownSessionMs < SHOW_EVERY_MS) return false
  try {
    const raw = window.localStorage.getItem(LAST_SHOWN_KEY)
    if (!raw) return true
    const last = Number(raw)
    // A corrupt value reads as "never shown" rather than gating forever.
    if (!Number.isFinite(last)) return true
    return Date.now() - last >= SHOW_EVERY_MS
  } catch {
    // Storage unavailable — the cap can't work, so stay quiet rather
    // than play the flipper on every mount (ExtensionNudge's stance).
    return false
  }
}

function recordShown() {
  lastShownSessionMs = Date.now()
  try {
    window.localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()))
  } catch {
    // Best effort — the session fallback above still enforces the cap.
  }
}

export function BillboardTicker() {
  const pathname = usePathname() ?? ''

  const [phase, setPhase] = useState<Phase>('hidden')
  /** Drives the grid slot's 0fr/1fr class; lags phase by design. */
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<BillboardItem[]>([])
  const [reducedMotion, setReducedMotion] = useState(false)
  /** active = the on-screen sub-banner; leaving = the one flipping out,
   *  kept mounted just long enough for the flip-out animation. */
  const [flip, setFlip] = useState<{ active: number; leaving: number | null }>({
    active: 0,
    leaving: null
  })
  /** Hover pause — mirrors the CSS :hover that pauses the progress bar. */
  const [paused, setPaused] = useState(false)
  /** Solo shows: bumped once per replay cycle to re-key the sub-banner
   *  so its build-in plays again. Constant 0 on multi-item shows. */
  const [replay, setReplay] = useState(0)
  /** Unspent hold for the current cycle: banked on pause, spent on resume. */
  const holdRemainingRef = useRef(HOLD_MS)
  /** When the running hold timer started; 0 = nothing unbanked running. */
  const holdStartedAtRef = useRef(0)
  /** Which cycle ("active:replay") the banked hold belongs to — a new
   *  cycle gets the full hold for its mode; '' forces that reset. */
  const holdCycleRef = useRef('')
  /** Bumped while parked so the show-attempt effect re-runs its gates. */
  const [retryTick, setRetryTick] = useState(0)
  /** Epoch ms of the last empty/failed feed fetch; 0 = no backoff armed. */
  const lastEmptyFetchAtRef = useRef(0)

  const finishShow = useCallback(() => {
    recordShown()
    setPhase('hidden')
    setOpen(false)
    setItems([])
    setFlip({ active: 0, leaving: null })
    setPaused(false)
    setReplay(0)
    holdRemainingRef.current = HOLD_MS
    holdStartedAtRef.current = 0
    holdCycleRef.current = ''
  }, [])

  /** Animated collapse — route exit and end-of-show both land here. */
  const beginLeaving = useCallback(() => {
    setOpen(false)
    setPhase('leaving')
  }, [])

  // A route change is a genuine landing: clear the empty-feed backoff so
  // it only ever gates parked retry ticks. Declared before the show
  // attempt below so the same commit's landing isn't blocked by it.
  useEffect(() => {
    lastEmptyFetchAtRef.current = 0
  }, [pathname])

  // Attempt one show per landing on an allowed route — and, via
  // retryTick, again every RETRY_TICK_MS while parked there hidden.
  // Gated attempts don't fetch; empty or failed fetches record no
  // cooldown (so a later landing retries) but do arm the fetch backoff.
  useEffect(() => {
    if (!TICKER_PATHS.includes(pathname) || phase !== 'hidden') return
    if (!canShowNow()) return
    if (Date.now() - lastEmptyFetchAtRef.current < EMPTY_RETRY_MS) return
    let cancelled = false
    fetch('/api/billboard')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: BillboardItem[] } | null) => {
        const fetched = data && Array.isArray(data.items) ? data.items : []
        if (fetched.length === 0) {
          // Covers non-ok responses too (data === null). Armed even when
          // this run was cancelled — an empty feed is a fresh fact about
          // the API no matter which effect run learned it.
          lastEmptyFetchAtRef.current = Date.now()
          return
        }
        if (cancelled) return
        lastEmptyFetchAtRef.current = 0
        setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        setItems(fetched)
        setPhase('entering')
      })
      .catch(() => {
        // Network hiccup — show nothing, keep the cooldown unrecorded,
        // but back off like an empty feed so parked ticks don't hammer
        // a failing API.
        lastEmptyFetchAtRef.current = Date.now()
      })
    return () => {
      cancelled = true
    }
  }, [pathname, phase, retryTick])

  // The parked retry tick: while hidden on an allowed route, nudge the
  // show attempt above every RETRY_TICK_MS so a lapsed cooldown or a
  // newly activated ad surfaces without a navigation. Most ticks are
  // free (canShowNow or the backoff fails fast — no network). The
  // interval only runs while the tab is visible, and becoming visible
  // again ticks immediately rather than waiting out a fresh interval.
  useEffect(() => {
    if (!TICKER_PATHS.includes(pathname) || phase !== 'hidden') return
    let interval = 0
    const start = () => {
      if (interval === 0) {
        interval = window.setInterval(() => setRetryTick((t) => t + 1), RETRY_TICK_MS)
      }
    }
    const stop = () => {
      window.clearInterval(interval)
      interval = 0
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setRetryTick((t) => t + 1)
        start()
      } else {
        stop()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState === 'visible') start()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [pathname, phase])

  // Navigating off an allowed route mid-show retracts gracefully: the
  // AppShell mount survives client-side navigation, so the component
  // stays rendered through the collapse and unmounts when it completes.
  // Moving between the two allowed routes leaves the show untouched.
  useEffect(() => {
    if (phase === 'hidden' || phase === 'leaving') return
    if (TICKER_PATHS.includes(pathname)) return
    beginLeaving()
  }, [pathname, phase, beginLeaving])

  // Entering: short breather, then flip the slot open to start the
  // grid-rows expand.
  useEffect(() => {
    if (phase !== 'entering') return
    const timer = window.setTimeout(() => setOpen(true), ENTER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // Entering -> looping normally advances on the expand's transitionend;
  // this covers transitions that never fire.
  useEffect(() => {
    if (phase !== 'entering' || !open) return
    const timer = window.setTimeout(() => setPhase('looping'), TRANSITION_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [phase, open])

  // Looping: wall-clock show length (a plain timeout — hovering pauses
  // the rotation but doesn't extend the show).
  useEffect(() => {
    if (phase !== 'looping') return
    const timer = window.setTimeout(beginLeaving, SHOW_FOR_MS)
    return () => window.clearTimeout(timer)
  }, [phase, beginLeaving])

  // Leaving -> unmount normally lands on the collapse's transitionend;
  // same fallback as the expand.
  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = window.setTimeout(finishShow, TRANSITION_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [phase, finishShow])

  // Advance one step. Multi-item: the active item becomes the leaving
  // layer (kept for the flip-out) and the next becomes active; reduced
  // motion swaps instantly — no leaving layer, so no flip classes ever
  // render. Solo: same item, same index — just bump the replay counter
  // so the sub-banner re-keys and its build-in plays again, with no
  // flip-out layer and no vertical motion.
  const advance = useCallback(() => {
    if (items.length === 1) {
      setReplay((r) => r + 1)
      return
    }
    setFlip((f) => ({
      active: (f.active + 1) % items.length,
      leaving: reducedMotion ? null : f.active
    }))
  }, [items.length, reducedMotion])

  // The pause-aware cycle clock, shared by both modes: a multi-item
  // show advances the flipper after HOLD_MS, a solo show replays the
  // build-in after SOLO_REPLAY_MS. Each (re)run spends holdRemainingRef
  // — the full hold when the cycle is new, the banked remainder when
  // resuming from hover. Pausing just tears the timer down: the
  // mouseenter handler banks what's left before this cleanup runs. A
  // cycle is (active index, replay count): multi advances change the
  // index, solo replays bump the counter, and either one resets the
  // bank to its mode's full hold. Solo + reduced motion arms nothing:
  // the build-in is animation:none there, so a re-key would be
  // invisible DOM churn — the item just holds for the whole show.
  useEffect(() => {
    if (phase !== 'looping' || paused || items.length === 0) return
    const solo = items.length === 1
    if (solo && reducedMotion) return
    const cycle = `${flip.active}:${replay}`
    if (holdCycleRef.current !== cycle) {
      holdCycleRef.current = cycle
      holdRemainingRef.current = solo ? SOLO_REPLAY_MS : HOLD_MS
    }
    holdStartedAtRef.current = Date.now()
    const timer = window.setTimeout(advance, holdRemainingRef.current)
    return () => window.clearTimeout(timer)
  }, [phase, paused, items.length, reducedMotion, flip.active, replay, advance])

  // Drop the leaving layer once the flip-out has played. A timer rather
  // than animationend so environments where the animation can't run
  // still clean up.
  useEffect(() => {
    if (flip.leaving === null) return
    const timer = window.setTimeout(
      () => setFlip((f) => (f.leaving === null ? f : { ...f, leaving: null })),
      FLIP_CLEAR_MS
    )
    return () => window.clearTimeout(timer)
  }, [flip.leaving])

  // Hovering the banner pauses rotation: bank the unspent hold so the
  // resume picks up mid-item. Zeroing holdStartedAt makes a duplicate
  // mouseenter a no-op (nothing is left unbanked).
  const pauseRotation = useCallback(() => {
    if (holdStartedAtRef.current > 0) {
      holdRemainingRef.current = Math.max(
        0,
        holdRemainingRef.current - (Date.now() - holdStartedAtRef.current)
      )
      holdStartedAtRef.current = 0
    }
    setPaused(true)
  }, [])

  const resumeRotation = useCallback(() => setPaused(false), [])

  // The grid transition is the phase clock — but only the slot's own
  // grid-template-rows change counts (card hover transitions bubble).
  const onSlotTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.propertyName !== 'grid-template-rows') return
    if (phase === 'entering') setPhase('looping')
    else if (phase === 'leaving') finishShow()
  }

  if (phase === 'hidden' || items.length === 0) return null

  const multi = items.length > 1
  const activeItem = items[flip.active]
  const leavingItem = flip.leaving === null ? null : items[flip.leaving]

  // One sub-banner as a full-width layer — the layer itself is the whole
  // click target. Ads go through the click-redirect route, never straight
  // to link_url; buyer text is untrusted and BillboardCard renders it as
  // plain text. The leaving copy is animation-only: hidden from the
  // accessibility tree, unfocusable and click-through — and it never
  // gets the build-in classes, so its lines don't re-build while it
  // slides out. The active layer's build-in arms once `open` flips (the
  // classes land on already-mounted lines, so the first build plays
  // during the slot expand rather than invisibly inside the collapsed
  // slot), then replays on every flip-in mount; the replay counter in
  // the keys remounts a solo card each cycle (constant 0 when multi).
  const renderLayer = (item: BillboardItem, leaving: boolean) => {
    const layerCls = leaving
      ? 'billboard-flip-out pointer-events-none absolute inset-0'
      : `relative ${flip.leaving !== null ? 'billboard-flip-in' : ''}`
    const linkCls = `group block w-full min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-500 ${layerCls}`
    const hoverCls =
      'transition-[border-color,background-color] duration-150 group-hover:border-zinc-600 group-hover:bg-white/[0.06]'
    const animate = open && !leaving

    if (item.kind === 'ad') {
      return (
        <a
          key={`ad-${item.id}-${leaving ? 'out' : 'in'}-r${replay}`}
          href={`/api/billboard/${item.id}/click`}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={leaving ? -1 : undefined}
          aria-hidden={leaving || undefined}
          className={linkCls}
        >
          <BillboardCard
            text={item.text}
            title={item.companyName ?? item.linkHost}
            logoUrl={item.logoUrl}
            accentColor={item.accentColor ?? null}
            size="lg"
            animateIn={animate}
            className={hoverCls}
          />
        </a>
      )
    }

    return (
      <Link
        key={`hype-${item.userId}-${leaving ? 'out' : 'in'}-r${replay}`}
        href={`/u/${item.username}`}
        tabIndex={leaving ? -1 : undefined}
        aria-hidden={leaving || undefined}
        className={linkCls}
      >
        {/* Hype rides a fixed gold accent — same two-line strip anatomy
            as the ad card (avatar seated where the 44px logo sits, name
            as the title line, line classes mirrored from BillboardCard)
            so the flip reads as one continuous surface. */}
        <span
          className={`relative flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-2.5 ${hoverCls}`}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'rgb(var(--lb-gold) / 0.08)' }}
          />
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px]"
            style={{ background: 'rgb(var(--lb-gold))' }}
          />
          <span
            className="relative shrink-0 rounded-full"
            style={{ boxShadow: '0 0 0 1px rgb(var(--lb-gold) / 0.5)' }}
          >
            <Avatar
              src={item.avatarUrl}
              char={(item.displayName || item.username).charAt(0).toUpperCase() || '?'}
              imgClassName="block h-11 w-11 rounded-full object-cover"
              fallbackClassName="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-400"
            />
          </span>
          <span className="relative flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span
              className={`truncate text-[11px] font-semibold uppercase leading-4 tracking-[0.2em] text-zinc-50 ${
                animate ? 'billboard-build-title' : ''
              }`}
            >
              {item.displayName || item.username}
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
      </Link>
    )
  }

  return (
    <div
      className={`billboard-slot ${open ? 'billboard-slot-open' : ''}`}
      onTransitionEnd={onSlotTransitionEnd}
    >
      <div className="billboard-slot-inner">
        <aside
          aria-label="Billboard"
          className="billboard-shell"
          style={
            {
              '--billboard-hold-ms': `${multi ? HOLD_MS : SOLO_REPLAY_MS}ms`
            } as CSSProperties
          }
          onMouseEnter={pauseRotation}
          onMouseLeave={resumeRotation}
        >
          <div className="flex h-[88px] items-center gap-3 px-3 sm:px-4">
            {/* Broadcast chrome: inverted-monochrome label + live dot. */}
            <div className="billboard-label flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5">
              <span aria-hidden className="billboard-live-dot shrink-0" />
              <span className="text-[9px] font-semibold tracking-[0.3em]">BILLBOARD</span>
            </div>

            {/* The flipper stage: the active layer sizes it; the leaving
                layer stacks absolutely and slides out above it. */}
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg">
              {leavingItem !== null && renderLayer(leavingItem, true)}
              {renderLayer(activeItem, false)}
            </div>

            {/* Monochrome counter + countdown. The counter is meaningless
                for a solo show (hidden), but the bar stays and sweeps at
                the replay cadence, so the periodic re-key never reads as
                a random stutter. Reduced motion drops the bar in both
                modes; solo + reduced motion renders neither. */}
            {(multi || !reducedMotion) && (
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {multi && (
                  <span className="text-[10px] tabular-nums tracking-[0.2em] text-zinc-500">
                    {flip.active + 1} / {items.length}
                  </span>
                )}
                {!reducedMotion && (
                  <span className="billboard-progress-track block h-0.5 w-14 overflow-hidden rounded-full">
                    <span
                      key={`${flip.active}-r${replay}`}
                      className={`billboard-progress-fill block h-full w-full ${
                        phase === 'looping' ? 'billboard-progress-run' : ''
                      }`}
                    />
                  </span>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
