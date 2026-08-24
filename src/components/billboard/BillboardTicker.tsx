'use client'

// The Billboard banner — paid ads + free copy (rank/club hype events,
// operator announcements) shown one at a time, news-flipper style, in a
// content-height block that expands in-flow under the nav on the
// dashboard and leaderboard, pushing page content down. Two stacked
// rows: a broadcast-chrome row (kind-aware label + live dot, counter,
// countdown) above a full-width card stage, so phones give the whole
// banner width to the card. The chrome follows the active item's kind
// (lib/billboard's billboardChrome): SPONSOR for paid ads,
// ANNOUNCEMENT for hype, club and operator announcements — free copy
// is never dressed as a sponsor.
// Mounted once inside .app-nav-inset in AppShell and self-gating: it
// never starts a show off the two allowed routes, and a localStorage
// timestamp caps appearances to one per 10 minutes per visitor. Hype
// and club events additionally air once per visitor, ever: a second
// localStorage map records each event when it displays, and recorded
// events are filtered from later fetches (ads and operator
// announcements always ride).
// Visitors parked on an allowed route aren't stranded: while the banner
// is hidden there, a retry tick re-attempts the show every RETRY_TICK_MS,
// so a lapsing cooldown or a newly activated ad surfaces the banner
// without a fresh navigation. The tick only runs while the tab is
// visible — background tabs don't poll — and becoming visible again
// re-attempts immediately instead of waiting out a fresh interval.
//
// One show: after a short delay (so the expand doesn't fight initial
// page paint) the grid slot animates 0fr -> 1fr, then the flipper
// rotates — each item holds for its own billboardHoldMs (an ad its
// rotation hold, a hype announcement its longer announcement beat),
// then flips out (slides up + fades) while the next flips in from
// below — until the billboardShowForMs wall-clock end, when the slot
// collapses and content slides back up. Any paid ad aboard buys the
// full 3-minute loop; an announcement-only train instead plays one
// pass and closes itself after the last item's hold
// (billboardShouldCloseAfterHold), with the short wall clock only as
// a backstop — free hype never gets a sponsor's total exposure.
// Hovering the banner pauses rotation for this visitor only: the
// unspent hold is banked and resumed on unhover, and the progress bar
// pauses via CSS animation-play-state — but the end-of-show is
// wall-clock, so hovering doesn't extend it. Navigating off an allowed
// route mid-show triggers the animated collapse; every way a show ends
// records the cooldown timestamp. Navigating between the two allowed
// routes keeps the show running (the mount survives client navigation).
// An empty (or failed) /api/billboard fetch — including a train the
// seen-once gate filters down to nothing — records no cooldown, but
// arms a fetch backoff: retry ticks skip fetching for EMPTY_RETRY_MS
// afterwards. Route changes clear the backoff, so a genuine landing
// always fetches. Exactly one fetched ad: no flips and no counter,
// but not a static block either — every BILLBOARD_AD_SOLO_REPLAY_MS
// the sub-banner re-keys in place so its build-in replays (no flip-out
// layer, no vertical motion), with the progress bar sweeping at that
// cadence. The replay clock is the same pause-aware hold timer, so
// hovering banks the remaining cycle exactly like a multi-item hold
// does. A solo hype item never replays — its one "advance" is the
// close.
//
// Phases advance on transitionend of grid-template-rows, with a timer
// fallback slightly longer than the transition for when it can't fire
// (reduced motion disables the transition; a display:none ancestor
// would swallow it too).
//
// prefers-reduced-motion: swaps are instant (no leaving layer mounts,
// so no flip animations render), the progress bar is dropped, the
// build-in classes are animation:none (globals.css) and the solo-ad
// replay re-key is skipped, but the per-item hold cadence and the
// show lengths are unchanged — including the announcement-only
// one-pass close.

import type { CSSProperties, TransitionEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BILLBOARD_AD_HOLD_MS,
  billboardChrome,
  billboardHoldMs,
  billboardShouldCloseAfterHold,
  billboardShowForMs,
  billboardStageTheme
} from '@/lib/billboard'
import type { BillboardClubItem, BillboardHypeItem, BillboardItem } from '@/lib/billboard'
import { BillboardCard } from './BillboardCard'
import { HypeAnnouncement } from './HypeAnnouncement'

const TICKER_PATHS = ['/dashboard', '/leaderboard']
/** Per-visitor frequency gate — epoch ms of when the last show ended. */
const LAST_SHOWN_KEY = 'cribble:billboard-last-shown'
const SHOW_EVERY_MS = 10 * 60_000
/** While hidden on an allowed route, how often the retry tick re-attempts. */
const RETRY_TICK_MS = 60_000
/** How long retry ticks skip fetching after an empty (or failed) fetch. */
const EMPTY_RETRY_MS = 5 * 60_000
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

/* ------------------------------------------------------------------ *
 * Seen-once gate for hype/club events: each airs once per visitor,
 * ever — the fix for "you reached 3rd place" replaying every cooldown
 * lapse for two days. A localStorage map of event key -> epoch ms of
 * when it displayed; entries older than the TTL are pruned on every
 * read and write (the API stops serving an event after 48h, so ~7 days
 * is pure headroom — the map stays a handful of entries). Ads and
 * operator announcements are never subject to this gate.
 * ------------------------------------------------------------------ */

const HYPE_SEEN_KEY = 'cribble:billboard-hype-seen'
const HYPE_SEEN_TTL_MS = 7 * 24 * 60 * 60_000

/** One seen-map key per event — kind-qualified so a hype row and a club
 *  row sharing a numeric id can't shadow each other. */
function hypeSeenKey(item: BillboardHypeItem | BillboardClubItem): string {
  return `${item.kind}:${item.id}`
}

// In-memory mirror of the seen map, same stance as lastShownSessionMs:
// if storage writes throw (Safari private-mode quota), marks still hold
// for the tab's lifetime, so one session can't re-air an event on every
// cooldown lapse.
let hypeSeenSession: Record<string, number> = {}

/** The live (TTL-pruned) seen map: storage merged over the session
 *  mirror. Unreadable or corrupt storage degrades to the mirror alone —
 *  worst case an event re-airs, never a crash (canShowNow's stance). */
function readHypeSeen(now: number): Record<string, number> {
  const seen: Record<string, number> = {}
  for (const [key, at] of Object.entries(hypeSeenSession)) {
    if (now - at < HYPE_SEEN_TTL_MS) seen[key] = at
  }
  try {
    const raw = window.localStorage.getItem(HYPE_SEEN_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object') {
        for (const [key, at] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof at === 'number' && Number.isFinite(at) && now - at < HYPE_SEEN_TTL_MS) {
            seen[key] = at
          }
        }
      }
    }
  } catch {
    // Fall through with the session mirror alone.
  }
  return seen
}

function recordHypeSeen(key: string) {
  const now = Date.now()
  const seen = readHypeSeen(now)
  seen[key] = now
  hypeSeenSession = seen
  try {
    window.localStorage.setItem(HYPE_SEEN_KEY, JSON.stringify(seen))
  } catch {
    // Best effort — the session mirror above still gates this tab.
  }
}

/** The fetched train minus already-seen hype/club events. Ads and
 *  operator announcements always pass. */
function dropSeenHype(items: BillboardItem[]): BillboardItem[] {
  const seen = readHypeSeen(Date.now())
  return items.filter((item) => {
    if (item.kind !== 'hype' && item.kind !== 'club') return true
    return !(hypeSeenKey(item) in seen)
  })
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
  /** Solo-ad shows: bumped once per replay cycle to re-key the
   *  sub-banner so its build-in plays again. Constant 0 otherwise. */
  const [replay, setReplay] = useState(0)
  /** Unspent hold for the current cycle: banked on pause, spent on resume. */
  const holdRemainingRef = useRef(BILLBOARD_AD_HOLD_MS)
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
    holdRemainingRef.current = BILLBOARD_AD_HOLD_MS
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
        // Seen-once gate: hype/club events this visitor already watched
        // are dropped BEFORE the show decision, so a train of nothing
        // but re-runs never opens the banner or burns the cooldown.
        const fresh = dropSeenHype(fetched)
        if (fresh.length === 0) {
          // Covers non-ok responses (data === null) and fully-seen
          // trains alike. Armed even when this run was cancelled — an
          // empty feed is a fresh fact about the API no matter which
          // effect run learned it.
          lastEmptyFetchAtRef.current = Date.now()
          return
        }
        if (cancelled) return
        lastEmptyFetchAtRef.current = 0
        setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        setItems(fresh)
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
  // the rotation but doesn't extend the show). Any paid ad aboard gets
  // the full sponsored loop; an announcement-only train's clock is one
  // hold per item, a backstop behind the close-after-last-hold below.
  useEffect(() => {
    if (phase !== 'looping') return
    const timer = window.setTimeout(beginLeaving, billboardShowForMs(items))
    return () => window.clearTimeout(timer)
  }, [phase, items, beginLeaving])

  // Leaving -> unmount normally lands on the collapse's transitionend;
  // same fallback as the expand.
  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = window.setTimeout(finishShow, TRANSITION_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [phase, finishShow])

  // Advance one step. An announcement-only train that just spent its
  // last item's hold doesn't wrap (or replay) — it retracts: free hype
  // plays one pass, never a sponsor's loop. Otherwise, multi-item: the
  // active item becomes the leaving layer (kept for the flip-out) and
  // the next becomes active; reduced motion swaps instantly — no
  // leaving layer, so no flip classes ever render. Solo (only ever a
  // paid ad here — a solo hype closed above): same item, same index —
  // just bump the replay counter so the sub-banner re-keys and its
  // build-in plays again, with no flip-out layer and no vertical
  // motion.
  const advance = useCallback(() => {
    if (billboardShouldCloseAfterHold(items, flip.active)) {
      beginLeaving()
      return
    }
    if (items.length === 1) {
      setReplay((r) => r + 1)
      return
    }
    setFlip((f) => ({
      active: (f.active + 1) % items.length,
      leaving: reducedMotion ? null : f.active
    }))
  }, [items, flip.active, beginLeaving, reducedMotion])

  // The pause-aware cycle clock: each cycle holds for the ACTIVE item's
  // billboardHoldMs — a multi-train ad its rotation hold, a hype item
  // its announcement beat, a solo ad its replay cadence. Each (re)run spends
  // holdRemainingRef — the full hold when the cycle is new, the banked
  // remainder when resuming from hover. Pausing just tears the timer
  // down: the mouseenter handler banks what's left before this cleanup
  // runs. A cycle is (active index, replay count): multi advances
  // change the index, solo-ad replays bump the counter, and either one
  // resets the bank to that item's full hold. A solo AD under reduced
  // motion arms nothing — its build-in is animation:none there, so a
  // re-key would be invisible DOM churn and the ad just holds for the
  // whole show. A solo hype still arms: its "advance" is the close, an
  // actual retraction, reduced motion or not.
  useEffect(() => {
    if (phase !== 'looping' || paused || items.length === 0) return
    const item = items[flip.active]
    const solo = items.length === 1
    if (solo && reducedMotion && item.kind === 'ad') return
    const cycle = `${flip.active}:${replay}`
    if (holdCycleRef.current !== cycle) {
      holdCycleRef.current = cycle
      holdRemainingRef.current = billboardHoldMs(item, !solo)
      // Seen-once mark, on display rather than hold completion: the
      // new-cycle branch is the one existing hook that fires exactly
      // once per item appearance (pause/resume re-runs keep the cycle),
      // and marking here means a show cut short mid-hold — route exit,
      // wall clock — still counts as aired. The visitor saw the sting;
      // it shouldn't replay on their next landing.
      if (item.kind === 'hype' || item.kind === 'club') {
        recordHypeSeen(hypeSeenKey(item))
      }
    }
    holdStartedAtRef.current = Date.now()
    const timer = window.setTimeout(advance, holdRemainingRef.current)
    return () => window.clearTimeout(timer)
  }, [phase, paused, items, reducedMotion, flip.active, replay, advance])

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
  // Broadcast chrome tracks the ACTIVE item's kind — SPONSOR for paid
  // ads, ANNOUNCEMENT for free copy — as does the banner's aria-label.
  const chrome = billboardChrome(activeItem)
  // The active hype/club item's tier accent, set on the shell so the
  // progress hairline sweeps in the same hue as the staging (which sets
  // its own copy of --hype-accent on its root, overriding the shell for
  // its subtree — a leaving layer keeps its old accent that way).
  const accentVar =
    activeItem.kind === 'hype' || activeItem.kind === 'club'
      ? billboardStageTheme(activeItem).accentVar
      : null

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

    // Operator announcements reuse the ad strip geometry (headline as
    // the title line, body under it, no logo, neutral accent, no AD
    // glyph — the chrome row already says ANNOUNCEMENT, and free copy
    // is never dressed as sponsorship) so announce<->ad flips read as
    // one continuous surface. The link, when present, is
    // operator-trusted copy pushed from /admin, so it goes straight out
    // instead of through the click-redirect route — that route exists
    // to count clicks on untrusted buyer URLs.
    if (item.kind === 'announce') {
      const card = (
        <BillboardCard
          text={item.body}
          title={item.headline}
          logoUrl={null}
          accentColor={null}
          size="lg"
          animateIn={animate}
          adTag={false}
          className={item.linkUrl !== null ? hoverCls : ''}
        />
      )
      if (item.linkUrl !== null) {
        return (
          <a
            key={`announce-${item.id}-${leaving ? 'out' : 'in'}-r${replay}`}
            href={item.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={leaving ? -1 : undefined}
            aria-hidden={leaving || undefined}
            className={linkCls}
          >
            {card}
          </a>
        )
      }
      // No link: an inert layer — same stage positioning as the link
      // variant, none of its hover/focus affordances (nothing here is
      // clickable, so nothing should invite a click).
      return (
        <div
          key={`announce-${item.id}-${leaving ? 'out' : 'in'}-r${replay}`}
          aria-hidden={leaving || undefined}
          className={`block w-full min-w-0 rounded-lg ${layerCls}`}
        >
          {card}
        </div>
      )
    }

    return (
      <Link
        key={`${item.kind}-${item.id}-${leaving ? 'out' : 'in'}-r${replay}`}
        href={`/u/${item.username}`}
        tabIndex={leaving ? -1 : undefined}
        aria-hidden={leaving || undefined}
        className={linkCls}
      >
        {/* Hype and club events ride one broadcast staging
            (HypeAnnouncement, themed per tier/threshold) on the same
            strip anatomy as the ad card, so the flip reads as one
            continuous surface. The leaving copy's animate=false renders
            it resolved — no sting replay while it slides out. */}
        <HypeAnnouncement item={item} animate={animate} paused={paused} className={hoverCls} />
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
          aria-label={chrome.ariaLabel}
          className="billboard-shell relative"
          style={
            {
              '--billboard-hold-ms': `${billboardHoldMs(activeItem, multi)}ms`,
              ...(accentVar !== null ? { '--hype-accent': `var(${accentVar})` } : null)
            } as CSSProperties
          }
          onMouseEnter={pauseRotation}
          onMouseLeave={resumeRotation}
        >
          {/* Chrome row above a full-width stage — no fixed height, so
              phones keep the whole banner width for the card instead of
              squeezing it between the label pill and the counter. */}
          <div className="flex flex-col gap-1.5 px-3 py-2 sm:px-4 sm:py-2.5">
            <div className="flex items-center gap-2">
              {/* Broadcast chrome: inverted-monochrome label + live dot,
                  reading ANNOUNCEMENT or SPONSOR per the active item. */}
              <div className="billboard-label flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5">
                <span aria-hidden className="billboard-live-dot shrink-0" />
                <span className="text-[9px] font-semibold tracking-[0.3em]">{chrome.label}</span>
              </div>

              {/* Monochrome counter — dropped on phones (it steals card
                  width) and meaningless for a solo show. The countdown
                  moved out of this row to the full-bleed hairline at the
                  shell's bottom edge. */}
              {multi && (
                <div className="flex min-w-0 flex-1 items-center justify-end">
                  <span className="hidden shrink-0 text-[10px] tabular-nums tracking-[0.2em] text-zinc-500 sm:inline">
                    {flip.active + 1} / {items.length}
                  </span>
                </div>
              )}
            </div>

            {/* The flipper stage: the active layer sizes it; the leaving
                layer stacks absolutely and slides out above it. */}
            <div className="relative w-full min-w-0 overflow-hidden rounded-lg">
              {leavingItem !== null && renderLayer(leavingItem, true)}
              {renderLayer(activeItem, false)}
            </div>
          </div>

          {/* Per-item countdown as a full-bleed hairline on the banner's
              floor — reads as a broadcast timer across the whole width.
              Same contract as when it lived in the chrome row: the sweep
              duration comes from --billboard-hold-ms, keyed remounts
              restart it per item (or per solo replay), the -run class
              only lands while looping, and the .billboard-shell:hover
              rule pauses it alongside the banked rotation hold. Reduced
              motion drops it entirely. */}
          {!reducedMotion && (
            <span
              aria-hidden
              className="billboard-progress-track absolute inset-x-0 bottom-0 block h-px overflow-hidden"
            >
              <span
                key={`${flip.active}-r${replay}`}
                className={`billboard-progress-fill block h-full w-full ${
                  accentVar !== null ? 'billboard-progress-fill-hype' : ''
                } ${phase === 'looping' ? 'billboard-progress-run' : ''}`}
              />
            </span>
          )}
        </aside>
      </div>
    </div>
  )
}
