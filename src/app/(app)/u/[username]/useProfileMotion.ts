'use client'

// UNIT RECORD motion. GSAP owns the one-shot boot (rules draw, panels
// unfold from a hairline, identity text decodes, menu rows and plate,
// numeral count-ups, share bars, the activity-grid cascade, the photo
// fade-in), the menu plate's glide, the pane swap (fresh panel unfolds,
// its rows / fills / dots cascade, the header title re-decodes) and the
// phone's one scroll-coupled piece — the compact name bar arming once the
// hero actions have scrolled under it. anime.js owns the two desktop idle
// loops: the ONLINE lamp pulse and the hairline scan sweep. Reduced motion
// (OS query or Cribble's data-motion kill switch) returns before any
// gsap.set/from, so the CSS final state — which hides nothing — is what
// renders; the plate and the compact bar still snap at duration 0
// because they are functional, not decorative. Selectors are scoped to
// the column root.
//
// DOM contract — everything this hook queries, all under the root
// (section.pf-dossier, the ref):
//   .pf-panel          unfoldable block; CSS final clip-path: inset(0)
//   .pf-rule           1px hairline; CSS transform-origin left center
//   [data-pf-decode]   one element holding ONE text node; scrambled by
//                      the boot. The ribbon's live line opts out with
//                      data-pf-decode="live" (it decodes itself on every
//                      flip). Phone boots decode only the two block-level
//                      ones — h1 (name) and div (designation); every
//                      other decode node is a span.
//   .pf-menu[role=tablist] > .pf-menu-row[role=tab] (selected one
//                      aria-selected="true") + sibling .pf-menu-plate;
//                      rows and plate share .pf-menu as offsetParent.
//                      Exactly one in the DOM, but ProfileClient mounts
//                      it in the spine from lg and as the sheet's child
//                      below, so crossing lg REMOUNTS it (opts.desktop
//                      re-arms the observer on the new node)
//   [role=tabpanel]    re-keyed per tab (a pick mounts a fresh node);
//                      its closest .pf-panel is the pane Frame, whose
//                      first [data-pf-decode] is the PanelHeader title
//   .pf-row  .pf-fill  stagger rows and inline-width share bars
//   .pf-grid-dot       activity cells in chronological DOM order;
//                      data-future="true" ones are skipped
//   [data-pf-count][data-pf-format=score|duration|int][data-pf-prefix]
//   .pf-photo          photo hosts — the banner (also a .pf-panel) and
//                      the spine avatar (inside .pf-brackets); the boot
//                      fades them in, the image itself is never styled
//   .pf-lamp           ONLINE marker (anime pulse, desktop, isActive)
//   .pf-scan           1px line, first child of the relative content
//                      column it sweeps (anime, desktop only)
//   .pf-compact        phone sticky name bar (CSS display:none from lg)
//   .pf-hero-actions   the spine action block; the compact bar's
//                      ScrollTrigger start element

import { useRef, type RefObject } from 'react'
import { animate } from 'animejs'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CustomEase } from 'gsap/CustomEase'
import { CRIBBLE_EASE } from '@/lib/landingMotion'
import { prefersReducedMotion } from '@/lib/motion'
import { scrambleFrame } from './decodeText'
import { formatProfileCount, isProfileCountFormat } from './profileCount'

/** GSAP ease name for the site curve, registered by this chunk. Not
 *  'cribble' (welcomeMotion) or 'cribble-landing' (landingMotion): the
 *  chunks register independently and must not rely on each other. */
const EASE = 'cribble-profile'

// Module side effect (welcomeMotion.ts's pattern): 'use client' modules
// still evaluate during SSR, and both calls are idempotent by name so HMR
// re-evaluation is harmless.
if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP, ScrollTrigger, CustomEase)
  CustomEase.create(EASE, CRIBBLE_EASE)
}

/** Phone compact bar height (h-12); the bar arms once the hero actions
 *  have scrolled behind it (its sticky top offset is read at arm time). */
const COMPACT_H = 48

/** Desktop breakpoint (Tailwind lg). Below it: one column, compact bar,
 *  shorter boot, no idle loops. */
const PHONE_QUERY = '(max-width: 1023px)'
const DESKTOP_QUERY = '(min-width: 1024px)'

/** clip-path pair for the unfold. Same shape and units on both ends so
 *  GSAP interpolates the numbers instead of snapping; clearProps hands
 *  the finished panel back to the stylesheet's inset(0). */
const FOLDED = 'inset(50% 0px 50% 0px)'
const UNFOLDED = 'inset(0% 0px 0% 0px)'

function motionReduced(): boolean {
  if (typeof document === 'undefined') return true
  return (
    prefersReducedMotion() ||
    document.documentElement.dataset.motion === 'reduced'
  )
}

/** True when the element takes part in layout. getComputedStyle().display
 *  is not enough: a descendant of a `hidden lg:flex` panel reports its
 *  own display, not the ancestor's none. */
function isRendered(el: HTMLElement): boolean {
  return el.getClientRects().length > 0
}

/** `each`-style stagger that stops growing once the group would run past
 *  its budget: small groups keep the per-item beat, a 20-row service
 *  record (or 91 grid dots) compresses instead of trailing. amount =
 *  each × (n − 1) is exactly what GSAP derives from `each`, so under the
 *  cap they match. */
function stagger(each: number, count: number, maxTotal: number): gsap.StaggerVars {
  return { amount: Math.min(each * Math.max(count - 1, 0), maxTotal), from: 'start' }
}

/** Seconds between successive starts for `count` items under the same
 *  cap as stagger() — for groups animated as one tween per item. */
function step(each: number, count: number, maxTotal: number): number {
  if (count < 2) return 0
  return Math.min(each, maxTotal / (count - 1))
}

/* ---------- decode ---------- */

/** The element's single text node, or null when it holds anything else
 *  (a nested span, several children) — those are left alone rather than
 *  flattened. Writing the node's data, not the element's textContent,
 *  keeps React's reference to the node valid. */
function textNodeOf(node: HTMLElement): Text | null {
  const first = node.firstChild
  if (!first || first !== node.lastChild || first.nodeType !== Node.TEXT_NODE) return null
  return first as Text
}

/** In-flight decode per node, so a later decode of the same node (the
 *  pane swap re-decoding a header the boot is still scrambling) kills
 *  the earlier one instead of racing it for the text. */
const decoding = new WeakMap<Element, gsap.core.Tween>()

/** Scrambles the node's text back to itself over `duration`: a proxy
 *  {p: 0 → 1} drives scrambleFrame, linear so glyphs resolve left to
 *  right at a steady rate. Added to `parent` at `at` when given, else a
 *  standalone tween. textContent isn't a tweened style, so the returned
 *  restore is registered on the context: a revert mid-run (motion
 *  preference flipped, unmount) writes the final text back — only if
 *  this tween is still the node's decode, so a stale restore can never
 *  overwrite a newer title. */
function decode(
  context: gsap.Context,
  node: HTMLElement,
  duration: number,
  parent: gsap.core.Timeline | null,
  at = 0
): void {
  const text = textNodeOf(node)
  if (!text) return
  const final = text.data
  if (final.trim() === '') return
  decoding.get(node)?.kill()
  const proxy = { p: 0 }
  let frame = 0
  const vars: gsap.TweenVars = {
    p: 1,
    duration,
    ease: 'none',
    onUpdate: () => {
      text.data = scrambleFrame(final, proxy.p, frame++)
    },
    onComplete: () => {
      text.data = final
      if (decoding.get(node) === tween) decoding.delete(node)
    }
  }
  // gsap.to() lands on the global timeline; add() re-parents it before
  // the next tick.
  const tween = gsap.to(proxy, vars)
  if (parent) parent.add(tween, at)
  decoding.set(node, tween)
  context.add(() => () => {
    if (decoding.get(node) !== tween) return
    text.data = final
    decoding.delete(node)
  })
}

/* ---------- menu plate ---------- */

/** Lays the inverted plate under the selected row. Geometry is
 *  offsetLeft/offsetTop/offsetWidth/offsetHeight: the rows and the plate
 *  share .pf-menu as offsetParent, so the numbers are already in the
 *  plate's own frame — no correction for the phone strip's scrollLeft
 *  (the plate rides inside it) or for .page-zoom-out's zoom on md+
 *  (offsets are layout px, like translate). Flip.fit was the plan, but
 *  with scale:false it writes width AND height inline before it even
 *  returns vars; four plain properties in one tween is all this needs. */
function fitMenuPlate(root: HTMLElement, duration: number, onComplete?: () => void): void {
  const plate = root.querySelector<HTMLElement>('.pf-menu-plate')
  const row = root.querySelector<HTMLElement>('.pf-menu-row[aria-selected="true"]')
  if (!plate || !row || row.offsetWidth === 0) return
  if (row.offsetParent !== plate.offsetParent) return
  gsap.to(plate, {
    x: row.offsetLeft,
    y: row.offsetTop,
    width: row.offsetWidth,
    height: row.offsetHeight,
    duration,
    ease: EASE,
    overwrite: 'auto',
    onComplete
  })
}

/* ---------- pane content cascade (boot and swap share it) ---------- */

/** Rows rise, share bars fill, grid dots cascade oldest → newest. Empty
 *  groups are skipped: GSAP warns on an empty target array, and .pf-row
 *  / .pf-fill / .pf-grid-dot are only present on some panes. `at` is a
 *  timeline position when `tl` is given, a delay otherwise. */
function cascade(
  scope: HTMLElement,
  tl: gsap.core.Timeline | null,
  at: { rows: number; fills: number; dots: number },
  opts: { rows: boolean; phone: boolean }
): void {
  const q = (sel: string) => gsap.utils.toArray<HTMLElement>(sel, scope).filter(isRendered)
  const from = (targets: HTMLElement[], vars: gsap.TweenVars, when: number) => {
    if (targets.length === 0) return
    if (tl) tl.from(targets, vars, when)
    else gsap.from(targets, { ...vars, delay: when })
  }

  if (opts.rows) {
    const rows = q('.pf-row')
    from(
      rows,
      {
        autoAlpha: 0,
        y: 6,
        duration: 0.26,
        ease: EASE,
        stagger: stagger(0.03, rows.length, 0.3),
        clearProps: 'transform,opacity,visibility'
      },
      at.rows
    )
  }

  // Origin is in dossier.css; set inline too so the fill can't depend on
  // stylesheet order.
  const fills = q('.pf-fill')
  if (fills.length > 0) gsap.set(fills, { transformOrigin: 'left center' })
  from(
    fills,
    {
      scaleX: 0,
      duration: opts.phone ? 0.36 : 0.4,
      ease: 'power3.out',
      stagger: stagger(0.035, fills.length, 0.1),
      clearProps: 'transform'
    },
    at.fills
  )

  const dots = q('.pf-grid-dot:not([data-future="true"])')
  from(
    dots,
    {
      scale: 0,
      duration: 0.3,
      ease: EASE,
      stagger: stagger(0.004, dots.length, opts.phone ? 0.3 : 0.5),
      clearProps: 'transform'
    },
    at.dots
  )
}

/* ===================================================================== */

export function useProfileMotion(
  root: RefObject<HTMLElement | null>,
  opts: { ready: boolean; tab: string; tabIndex: number; isActive: boolean; desktop: boolean }
): void {
  // The boot draws the first pane in with everything else; only later
  // picks get the swap.
  const booted = useRef(false)
  const prevTab = useRef(opts.tab)

  // Keep the plate glued to the selected row through font swaps and
  // orientation changes. The phone strip's own horizontal scroll needs
  // nothing: the plate lives inside the scroller and moves with the row
  // it marks. Keyed on the lg tier because the tablist is a different
  // node on each side of it (ProfileClient moves the menu between the
  // spine and the sheet), and an observer on the detached one would
  // never fire again; the fresh node's mount snap already has the plate
  // in place, and observe() fires once on attach to confirm it.
  // revertOnUpdate disconnects the old observer before the new one arms.
  useGSAP(
    (_, contextSafe = (fn) => fn) => {
      const el = root.current
      if (!opts.ready || !el) return
      const tablist = el.querySelector<HTMLElement>('[role="tablist"]')
      if (!tablist) return
      const observer = new ResizeObserver(contextSafe(() => fitMenuPlate(el, 0)))
      observer.observe(tablist)
      return () => observer.disconnect()
    },
    { scope: root, dependencies: [opts.ready, opts.desktop], revertOnUpdate: true }
  )

  // Boot. root.current is null until the column mounts on `ready`, so the
  // effect keys on it. revertOnUpdate tears the previous run down (the
  // media contexts) should ready ever cycle; with plain dependencies
  // useGSAP defers the returned cleanup to unmount.
  useGSAP(
    () => {
      const el = root.current
      if (!opts.ready || !el) return

      const mm = gsap.matchMedia()
      const tiers = {
        reduceMotion: '(prefers-reduced-motion: reduce)',
        allowMotion: '(prefers-reduced-motion: no-preference)'
      }
      const reducedIn = (context: gsap.Context) =>
        Boolean(context.conditions?.reduceMotion) ||
        document.documentElement.dataset.motion === 'reduced'

      // Phone compact bar. Functional, so it arms on every motion tier
      // and reduced just snaps. Its own mm.add so crossing lg re-arms the
      // trigger without replaying the boot timeline below. The whole bar
      // (paper and all) hides, not just its contents: the sticky block
      // sits over the top 48px of the banner, and a blank paper strip
      // there would read as a gap.
      mm.add({ ...tiers, phone: PHONE_QUERY }, (context) => {
        if (!context.conditions?.phone) return
        const bar = el.querySelector<HTMLElement>('.pf-compact')
        const heroActions = el.querySelector<HTMLElement>('.pf-hero-actions')
        if (!bar || !heroActions || !isRendered(bar) || !isRendered(heroActions)) return
        const reduce = reducedIn(context)
        // A plain function, not the hook's contextSafe: it fires from a
        // ScrollTrigger callback that belongs to THIS context, and
        // contextSafe would run it inside the hook's outer one — GSAP
        // then files the outer context as this one's child, and the
        // revert on crossing lg walks parent → child → parent until the
        // stack overflows (Context.getTweens). The tween lands on the
        // global timeline untracked, so its teardown is registered below.
        const show = (visible: boolean) => {
          gsap.to(bar, {
            autoAlpha: visible ? 1 : 0,
            y: visible ? 0 : -6,
            duration: reduce ? 0 : 0.22,
            ease: 'power2.out',
            overwrite: 'auto'
          })
        }
        // A show still tweening when the context reverts (a rotate
        // mid-fade) must not outlive it. Runs after the set below is
        // reverted, so the bar is left as the stylesheet had it.
        context.add(() => () => gsap.killTweensOf(bar))
        gsap.set(bar, { autoAlpha: 0, y: -6 })
        // start = the hero actions' bottom edge crossing the bar's bottom
        // edge, i.e. gone under the sticky bar. The bar sticks at
        // --pf-sticky-top (the fixed top bar's height; 0 in rail mode),
        // so its bottom sits that far plus COMPACT_H below the viewport
        // top — read off the resolved style once per arm, since this
        // context is rebuilt on crossing lg. The default end ('bottom
        // top') leaves a window only as tall as the offset, which is why
        // this is onEnter/onLeaveBack and not onToggle — the bar must
        // stay once the window is passed. Not end:'max': on a page
        // shorter than the start point that resolves to end < start,
        // progress reads 1 and onEnter fires at load.
        const stickyTop = parseFloat(getComputedStyle(bar).top) || 0
        ScrollTrigger.create({
          trigger: heroActions,
          start: `bottom top+=${stickyTop + COMPACT_H}`,
          onEnter: () => show(true),
          onLeaveBack: () => show(false)
        })
      })

      mm.add(tiers, (context) => {
        // Every tier: the plate must sit under the selected row before
        // anything draws it.
        fitMenuPlate(el, 0)
        if (reducedIn(context)) return

        // Read once, not a matchMedia condition: a breakpoint crossing
        // mid-session must not replay the boot.
        const phone = window.matchMedia(PHONE_QUERY).matches
        const q = (sel: string) => gsap.utils.toArray<HTMLElement>(sel, el).filter(isRendered)
        const tl = gsap.timeline({ defaults: { ease: EASE } })
        const from = (targets: HTMLElement[], vars: gsap.TweenVars, at: number) => {
          if (targets.length > 0) tl.from(targets, vars, at)
        }

        // Beat sheet: ≈1.1s desktop, ≈0.7s phone.
        const T = phone
          ? { rules: 0, panels: 0.06, decode: 0.16, menu: 0.2, counts: 0.22, fills: 0.26, dots: 0.26, print: 0.32 }
          : { rules: 0, panels: 0.1, decode: 0.25, menu: 0.3, counts: 0.35, fills: 0.4, dots: 0.4, print: 0.55 }

        // The scan line waits for the idle loop (desktop) to take it.
        const scan = q('.pf-scan')
        if (scan.length > 0) gsap.set(scan, { autoAlpha: 0 })

        // Rules draw from the left. Phones skip the ones inside the pane.
        const rules = q('.pf-rule').filter((r) => !phone || !r.closest('[role="tabpanel"]'))
        if (rules.length > 0) gsap.set(rules, { transformOrigin: 'left center' })
        from(
          rules,
          { scaleX: 0, duration: phone ? 0.28 : 0.35, stagger: stagger(0.04, rules.length, 0.2), clearProps: 'transform' },
          T.rules
        )

        // Panels unfold from a hairline.
        const panels = q('.pf-panel')
        if (panels.length > 0) {
          tl.fromTo(
            panels,
            { clipPath: FOLDED },
            {
              clipPath: UNFOLDED,
              duration: phone ? 0.26 : 0.32,
              stagger: stagger(0.06, panels.length, phone ? 0.2 : 0.3),
              clearProps: 'clipPath'
            },
            T.panels
          )
        }

        // Identity and labels decode. One proxy tween per node.
        const decodes = q(
          phone
            ? 'h1[data-pf-decode], div[data-pf-decode]'
            : '[data-pf-decode]:not([data-pf-decode="live"])'
        )
        const decodeStep = step(0.03, decodes.length, 0.3)
        decodes.forEach((node, i) => {
          decode(context, node, phone ? 0.4 : 0.45, tl, T.decode + i * decodeStep)
        })

        // Menu rows slide in; the plate draws from the left under the
        // selected one. No clearProps on the plate: its transform carries
        // the x/y the fit set.
        const menuRows = q('.pf-menu-row')
        from(
          menuRows,
          { x: -8, duration: phone ? 0.24 : 0.3, stagger: stagger(0.04, menuRows.length, 0.2), clearProps: 'transform' },
          T.menu
        )
        const plate = el.querySelector<HTMLElement>('.pf-menu-plate')
        if (plate && isRendered(plate)) {
          gsap.set(plate, { transformOrigin: 'left center' })
          tl.from(plate, { scaleX: 0, duration: 0.32 }, T.menu)
        }

        // Count-ups. The markup already shows the final string, so the
        // numeral is zeroed here — invisible until its row lands — and
        // written back exactly on completion. textContent isn't a tweened
        // style, so a revert mid-count (motion preference flipped) would
        // strand a partial numeral; the context cleanup restores it.
        for (const node of q('[data-pf-count]')) {
          const target = Number(node.dataset.pfCount)
          if (!Number.isFinite(target) || target <= 0) continue
          const rawFormat = node.dataset.pfFormat
          const format = isProfileCountFormat(rawFormat) ? rawFormat : 'int'
          const prefix = node.dataset.pfPrefix ?? ''
          const final = formatProfileCount(target, format, prefix)
          const counter = { n: 0 }
          node.textContent = formatProfileCount(0, format, prefix)
          tl.to(
            counter,
            {
              n: target,
              duration: phone ? 0.5 : 0.68,
              ease: 'power2.out',
              onUpdate: () => {
                node.textContent = formatProfileCount(counter.n, format, prefix)
              },
              onComplete: () => {
                node.textContent = final
              }
            },
            T.counts
          )
          context.add(() => () => {
            node.textContent = final
          })
        }

        // First pane's bars and grid (its rows unfold with the panel).
        cascade(el, tl, { rows: 0, fills: T.fills, dots: T.dots }, { rows: false, phone })

        // The photos land last: the banner and spine avatar hosts fade up
        // (the images render untouched; only the host's opacity moves).
        // Affiliates avatars are plain rows and cascade with their pane.
        const photos = q('.pf-photo')
        if (photos.length > 0) {
          tl.from(
            photos,
            { autoAlpha: 0, duration: phone ? 0.38 : 0.5, ease: 'power2.out', clearProps: 'opacity,visibility' },
            T.print
          )
        }
      })

      return () => mm.revert()
    },
    { scope: root, dependencies: [opts.ready], revertOnUpdate: true }
  )

  // Pane swap: the panel re-keys on the tab, so a fresh node mounts —
  // unfold it while the plate glides to the picked row and the header
  // title re-decodes. Keyed on tabIndex too: the list can shift under an
  // unchanged tab (HANGAR appearing before LOADOUT after a refresh), and
  // the strip's box doesn't change size for the observer to notice.
  // Deferred cleanup (no revertOnUpdate) on purpose: reverting the
  // previous glide on each pick would snap the plate backwards first.
  useGSAP(
    (context, contextSafe = (fn) => fn) => {
      if (!booted.current) {
        booted.current = true
        prevTab.current = opts.tab
        return
      }
      const el = root.current
      if (!el) return
      const reduce = motionReduced()
      if (opts.tab === prevTab.current) {
        fitMenuPlate(el, 0)
        return
      }
      prevTab.current = opts.tab

      // Settle at duration 0 afterwards: a font swap or resize mid-glide
      // would otherwise leave the plate at a stale x/y.
      fitMenuPlate(el, reduce ? 0 : 0.32, contextSafe(() => fitMenuPlate(el, 0)))

      const panel = el.querySelector<HTMLElement>('[role="tabpanel"]')
      if (panel && !reduce) {
        const phone = window.matchMedia(PHONE_QUERY).matches
        // The outgoing pane is already gone (re-keyed), so the frame
        // itself takes the collapse: a subtle settle from the top edge.
        const frame = panel.closest<HTMLElement>('.pf-panel')
        if (frame) {
          gsap.set(frame, { transformOrigin: 'center top' })
          gsap.fromTo(
            frame,
            { scaleY: 0.985 },
            { scaleY: 1, duration: 0.24, ease: EASE, overwrite: 'auto', clearProps: 'transform,transformOrigin' }
          )
          const title = frame.querySelector<HTMLElement>('[data-pf-decode]')
          if (title) decode(context, title, 0.35, null)
        }
        gsap.fromTo(
          panel,
          { clipPath: FOLDED },
          { clipPath: UNFOLDED, duration: 0.28, ease: EASE, clearProps: 'clipPath' }
        )
        cascade(panel, null, { rows: 0.04, fills: 0.1, dots: 0.1 }, { rows: true, phone })
      }
      // Pane heights differ, so the compact bar's trigger point moves.
      ScrollTrigger.refresh()
    },
    { scope: root, dependencies: [opts.tab, opts.tabIndex] }
  )

  // Idle surface (desktop only): the ONLINE lamp breathes and a hairline
  // sweeps the content column every ~9s. revertOnUpdate so both stop the
  // moment ready or isActive flips, not at unmount; the mm context
  // reverts them on crossing lg.
  useGSAP(
    () => {
      const el = root.current
      if (!opts.ready || !el || motionReduced()) return
      const mm = gsap.matchMedia()
      mm.add(DESKTOP_QUERY, () => {
        const q = (sel: string) => gsap.utils.toArray<HTMLElement>(sel, el).filter(isRendered)

        // The .deck-lamp-live recipe.
        const lamps = opts.isActive ? q('.pf-lamp') : []
        const pulse =
          lamps.length > 0
            ? animate(lamps, {
                opacity: [1, 0.35],
                duration: 1400,
                alternate: true,
                loop: true,
                ease: 'inOutSine'
              })
            : null

        // Scan: translate the line down the column's full height in
        // 1.6s, fading over the last 300ms, then wait 7.5s. The height
        // is function-based and re-read on every loop (refresh()) after
        // the observer has updated it, so a pane swap mid-cycle only
        // changes the next sweep. `from` is a function too: refresh()
        // re-evaluates function values but re-reads a plain `from` off
        // the target, which would restart loop two from the bottom.
        const scan = q('.pf-scan')[0] ?? null
        const column = scan?.parentElement ?? null
        let observer: ResizeObserver | null = null
        let sweep: ReturnType<typeof animate> | null = null
        if (scan && column) {
          let height = column.offsetHeight
          observer = new ResizeObserver(() => {
            height = column.offsetHeight
          })
          observer.observe(column)
          gsap.set(scan, { visibility: 'inherit', opacity: 0 })
          sweep = animate(scan, {
            translateY: { from: () => 0, to: () => height },
            opacity: [
              { to: 0.9, duration: 0 },
              { to: 0.9, duration: 1300 },
              { to: 0, duration: 300 }
            ],
            duration: 1600,
            ease: 'inOutQuad',
            delay: 7500,
            loopDelay: 7500,
            loop: true,
            onLoop: (self) => {
              self.refresh()
            }
          })
        }

        return () => {
          pulse?.revert()
          sweep?.revert()
          observer?.disconnect()
        }
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [opts.ready, opts.isActive], revertOnUpdate: true }
  )
}
