'use client'

// Route-scoped scroll friction for /leaderboard — the arena's answer to
// the landing page's ScrollSmoother (scrollFx.tsx), rebuilt for a route
// that lives inside the persistent AppShell chrome.
//
// The smoother rides the stable #app-flow-wrapper / #app-flow-content
// boundary AppShell always renders around .app-nav-inset. Only this
// component (mounted by LeaderboardClient) ever creates a smoother on
// it, so every other route keeps native scrolling and never pays for
// GSAP's scroll pipeline. Everything position:fixed (nav, backdrops,
// the hoisted AsteroidShower, portaled modals) lives OUTSIDE the
// boundary — fixed positioning dies inside transformed content — while
// the billboard stays INSIDE so its expand keeps pushing content down.
//
// Capability stance (mirrors landingTier() in lib/landingMotion.ts):
// smoothing arms only for fine-pointer, ≥1024px, ≥4-core machines with
// motion enabled. Touch, small screens and reduced-motion users keep
// fully native scrolling — the smoother is never created for them at
// all (not merely smoothTouch: 0), so nothing fights the OS physics.
//
// While the smoother is live:
//   · html.lb-smooth arms the globals.css rule that stands down the
//     boards' sticky bottom bars. position:sticky resolves against the
//     fixed wrapper's scrollport, whose scroll offset never moves, so
//     inside the transformed content the bars would clamp to their
//     sections' TOP edges. The runtime instead docks [data-lb-dock]
//     bars with a per-frame translate reproducing the sticky-bottom
//     contract; native modes keep the untouched CSS sticky.
//   · Modals holding the body scroll-lock (PlayerCard, ToolCard,
//     TokenPlayerCard, ShareSheet, CursorOptInModal, Settings — all
//     write body.style.overflow = 'hidden') pause the smoother via a
//     MutationObserver on that style attribute, so a glide can't keep
//     running under an open dialog. Watching the body catches the
//     modals whose open state never reaches the arena (ShareSheet,
//     TokenPlayerCard) without prop-drilling.
//   · A ResizeObserver on the content keeps measurements honest through
//     the 15s poll, tab swaps, pagination, search filtering and the
//     billboard's 560ms expand/collapse: shrinks refresh immediately
//     (mirroring how native scroll clamps the moment the document gets
//     shorter, so a TOKENS→GLOBAL swap never strands the viewport in
//     blank space), growth refreshes on a trailing debounce.
//
// ScrollTrigger.config is deliberately never touched here — it is a
// GSAP global the landing runtime owns; clobbering it from this route
// would change the landing's refresh behavior after a client-side
// round trip. Cleanup kills only what this module created.

import { useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { prefersReducedMotion } from '@/lib/motion'

// Module side effect (welcomeMotion.ts's pattern): registration is
// idempotent, so meeting the landing chunk's own registration later in
// a session is harmless.
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, ScrollSmoother)
}

/** The stable boundary AppShell renders around .app-nav-inset. */
const WRAPPER_ID = 'app-flow-wrapper'
const CONTENT_ID = 'app-flow-content'

/** <html> class gating the sticky-stand-down CSS in globals.css. */
const SMOOTH_CLASS = 'lb-smooth'

/** Bottom-docked bars opt in with this attribute (the standings YouBar,
 *  AiBoard's faction bar, TeamBoard's team/recruit bars). */
const DOCK_SELECTOR = '[data-lb-dock]'

/** The bars' sticky offset — bottom-[max(1rem,env(safe-area-inset-bottom))].
 *  The smoother only arms on desktop fine-pointer viewports, where the
 *  safe-area inset is 0, so the 1rem branch always wins. */
const DOCK_OFFSET_PX = 16

/** Trailing debounce for content growth: long enough to coalesce the
 *  billboard's 560ms expand and a data landing's row cascade into one
 *  refresh, short enough that new rows become reachable immediately. */
const REFRESH_DEBOUNCE_MS = 180

/** Floor between immediate shrink refreshes, so the billboard's 560ms
 *  collapse (a continuous shrink — one ResizeObserver tick per frame)
 *  costs a handful of refreshes instead of thirty. */
const SHRINK_REFRESH_FLOOR_MS = 150

/** Whether this device/session gets the smoother at all. Two modes only
 *  (unlike the landing's three tiers) because the arena has no "lite"
 *  middle ground — it either smooths or stays native. */
type ScrollMode = 'smooth' | 'native'

function scrollMode(): ScrollMode {
  if (
    prefersReducedMotion() ||
    document.documentElement.dataset.motion === 'reduced'
  ) {
    return 'native'
  }
  const finePointer = window.matchMedia('(pointer: fine)').matches
  const wideViewport = window.matchMedia('(min-width: 1024px)').matches
  // Undefined hardwareConcurrency (older Safari) is treated as capable —
  // the pointer/viewport gates already exclude most weak hardware.
  const cores = navigator.hardwareConcurrency
  const capableCpu = cores === undefined || cores >= 4
  return finePointer && wideViewport && capableCpu ? 'smooth' : 'native'
}

/** The live smoother, or null when native scrolling is on (native mode,
 *  route unmounted). Module-level so the boards' jump helpers can reach
 *  it without prop-drilling through the arena. */
let activeSmoother: ScrollSmoother | null = null

/** Center `el` in the viewport. Routes through the smoother when it is
 *  live — native scrollIntoView writes scrollTop the smoother would
 *  immediately fight — and falls back to the boards' original
 *  scrollIntoView behavior otherwise. `smooth: false` is an instant
 *  jump on both paths (AiBoard needs that: its ToolCard opens in the
 *  same commit and the body scroll-lock would cut a glide mid-flight). */
export function leaderboardScrollTo(el: Element, smooth: boolean): void {
  if (activeSmoother) {
    activeSmoother.scrollTo(el, smooth, 'center center')
  } else {
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' })
  }
}

/** Per-frame sticky-bottom emulation for [data-lb-dock] bars while the
 *  smoother is live. Reproduces the CSS contract: pull the bar up so it
 *  rides `DOCK_OFFSET_PX` above the viewport bottom whenever its natural
 *  flow position is below that line — never push it down, never lift it
 *  past its section's top edge. All math happens in *visual* pixels from
 *  getBoundingClientRect, then converts to transform units through the
 *  measured scale, because .page-zoom-out zooms the arena 0.9 at md+
 *  (rects are post-zoom, translations are pre-zoom). The per-frame
 *  querySelectorAll is deliberate: bars mount and unmount with tabs and
 *  data landings, at most one is on stage at a time, and the attribute
 *  scan is nanoseconds next to the smoother's own frame work. */
function dockBars(): void {
  const bars = document.querySelectorAll<HTMLElement>(DOCK_SELECTOR)
  bars.forEach((bar) => {
    const parent = bar.parentElement
    if (!parent) return
    const rect = bar.getBoundingClientRect()
    if (rect.height === 0 || bar.offsetHeight === 0) return
    const scale = rect.height / bar.offsetHeight
    const currentY = Number(gsap.getProperty(bar, 'y')) || 0
    // Where the bar would sit this frame with no docking translate.
    const naturalTop = rect.top - currentY * scale
    const naturalBottom = rect.bottom - currentY * scale
    const dockLine = window.innerHeight - DOCK_OFFSET_PX * scale
    const pullUp = Math.min(0, dockLine - naturalBottom)
    const ceiling = parent.getBoundingClientRect().top - naturalTop
    const y = Math.max(pullUp, ceiling) / scale
    if (Math.abs(y - currentY) > 0.05) gsap.set(bar, { y })
  })
}

export function LeaderboardScrollRuntime() {
  useEffect(() => {
    const mode = scrollMode()
    switch (mode) {
      case 'native':
        return
      case 'smooth':
        break
      default: {
        const exhaustive: never = mode
        return exhaustive
      }
    }

    const wrapper = document.getElementById(WRAPPER_ID)
    const content = document.getElementById(CONTENT_ID)
    if (!wrapper || !content) return

    const smoother = ScrollSmoother.create({
      wrapper,
      content,
      // 1.2s catch-up — a touch heavier than the landing's 1.15 for the
      // requested friction. Tune only on evidence: larger values read
      // as input lag, not smoothness.
      smooth: 1.2,
      // No data-speed/data-lag consumers on this route — the effects
      // pipeline would be pure per-frame overhead (landing's stance).
      effects: false,
      // Touch devices never reach this code path (scrollMode gates on
      // fine pointers), but keep the belt with the suspenders.
      smoothTouch: 0,
      ignoreMobileResize: true,
      // normalizeScroll swallows pointer events (see the landing's
      // globe note) and the arena is wall-to-wall hover/click targets.
      normalizeScroll: false
    })
    activeSmoother = smoother

    document.documentElement.classList.add(SMOOTH_CLASS)

    // ---- sticky-bottom docking ---------------------------------------
    // Added after the smoother exists, so within each tick the content
    // transform is already written when the bars measure themselves.
    gsap.ticker.add(dockBars)
    dockBars()

    // ---- modal pause ---------------------------------------------------
    const syncPaused = () => {
      const locked = document.body.style.overflow === 'hidden'
      if (smoother.paused() !== locked) smoother.paused(locked)
    }
    const bodyLockObserver = new MutationObserver(syncPaused)
    bodyLockObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['style']
    })
    syncPaused() // a dialog can already be up when the runtime arms

    // ---- measurement refreshes ------------------------------------------
    let refreshTimer = 0
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(
        () => ScrollTrigger.refresh(),
        REFRESH_DEBOUNCE_MS
      )
    }
    let lastHeight = content.offsetHeight
    let lastShrinkRefreshAt = 0
    const contentObserver = new ResizeObserver(() => {
      const height = content.offsetHeight
      const shrank = height < lastHeight
      lastHeight = height
      if (shrank && Date.now() - lastShrinkRefreshAt >= SHRINK_REFRESH_FLOOR_MS) {
        // Clamp NOW, like native scroll would — a deep scroll position
        // must not survive a swap to a shorter board.
        lastShrinkRefreshAt = Date.now()
        ScrollTrigger.refresh()
      }
      scheduleRefresh()
    })
    contentObserver.observe(content)
    // Landing parity: cover width reflows (the content observer already
    // catches the height changes they usually cause, but not always).
    window.addEventListener('resize', scheduleRefresh)

    return () => {
      window.removeEventListener('resize', scheduleRefresh)
      window.clearTimeout(refreshTimer)
      contentObserver.disconnect()
      bodyLockObserver.disconnect()
      gsap.ticker.remove(dockBars)
      // Hand any still-mounted bars back to their CSS-sticky fallback
      // with no leftover inline transform.
      document
        .querySelectorAll<HTMLElement>(DOCK_SELECTOR)
        .forEach((bar) => gsap.set(bar, { clearProps: 'transform' }))
      document.documentElement.classList.remove(SMOOTH_CLASS)
      activeSmoother = null
      smoother.kill()
    }
  }, [])

  return null
}
