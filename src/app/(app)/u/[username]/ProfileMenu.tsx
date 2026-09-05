'use client'

// The UNIT RECORD menu — one pane at a time, RECORD first so rank and
// score are still the first thing seen. Every entry is the same list
// row: a square marker (hollow, filled when selected) and a tracked mono
// label; the selected row is inverted by ONE ink plate slid underneath
// it. On lg+ the menu is the vertical list in the spine; below lg it is
// a horizontal snap strip stuck under the compact name bar. ProfileClient
// builds it once and mounts it per tier (inside the spine from lg, as
// the sheet's own child below), so crossing lg remounts it: the plate
// snap below and the motion hook's re-armed observer cover that.
//
// The active id lives in the URL hash (#record | #hangar | #loadout |
// #service-record | #affiliates) so a pane can be deep-linked and
// survives a reload; writes go through history.replaceState because
// assigning location.hash scrolls to the matching id.
//
// The plate is a sibling span owned by the motion hook (useProfileMotion
// tweens its x / y / width / height on every pick and resize, at
// duration 0 under reduced motion). It is snapped here exactly once, on
// mount, so the first paint before any effect of the hook runs already
// shows the inversion under the right row — and never again, so the two
// can't fight over the same inline styles. Offsets are
// offsetLeft/offsetTop: the rows and the plate share .pf-menu as
// offsetParent, so the numbers are in the plate's own frame whatever
// the phone strip's scrollLeft is.
//
// Sound: hovering onto a row that isn't selected plays tapSoft (the
// provider throttles repeats); the pick itself keeps the provider's
// default tap for a [role=tab].

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { useSfx } from '@/components/sfx/SfxProvider'
import { Marker } from './parts'

export type ProfileTabId = 'record' | 'hangar' | 'loadout' | 'service-record' | 'affiliates'

export const PROFILE_TAB_LABEL: Record<ProfileTabId, string> = {
  record: 'RECORD',
  hangar: 'HANGAR',
  loadout: 'LOADOUT',
  'service-record': 'SERVICE RECORD',
  affiliates: 'AFFILIATES'
}

const isProfileTabId = (raw: string): raw is ProfileTabId =>
  Object.prototype.hasOwnProperty.call(PROFILE_TAB_LABEL, raw)

/** Tab named by the current hash, or RECORD when there is none / it is
 *  unknown. Server render (no window) always seeds RECORD; the menu is
 *  not in the DOM until the profile loads, so the seed never has to
 *  match server markup. */
function tabFromHash(): ProfileTabId {
  if (typeof window === 'undefined') return 'record'
  const raw = window.location.hash.replace(/^#/, '')
  return isProfileTabId(raw) ? raw : 'record'
}

/** `available` is the tab list the record currently offers (see
 *  tabsFor). HANGAR only exists once something is docked or the owner
 *  is looking, AFFILIATES only for approved teams — and both read as
 *  absent until the payload lands, so the requested id is kept as-is
 *  and the fallback is derived, not written back. A #hangar or
 *  #affiliates deep link then resolves the moment the payload says the
 *  pane exists, and a profile without it (or a roster / fleet that
 *  disappears on refresh) reads RECORD without losing the hash. */
export function useProfileTab(
  available: ProfileTabId[]
): [ProfileTabId, (t: ProfileTabId) => void] {
  const [requested, setRequested] = useState<ProfileTabId>(tabFromHash)

  // Read again once mounted: on a client-side navigation (page.tsx keys
  // ProfileClient per pilot, so a roster row or search hit mounts a
  // fresh one) the render-time seed above runs before the router has
  // written the new URL, so it can still see the previous record's hash.
  // Nothing flashes — the pane is not on screen until the payload lands.
  useEffect(() => {
    setRequested(tabFromHash())
  }, [])

  const setTab = useCallback((next: ProfileTabId) => {
    setRequested(next)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${next}`)
    }
  }, [])

  const tab: ProfileTabId = available.includes(requested) ? requested : 'record'

  return [tab, setTab]
}

/** Lays the plate under the selected row. Inline styles, not React
 *  state: the motion hook owns the same properties from here on and GSAP
 *  reads the current transform back before tweening from it. A plate
 *  that already carries a transform is the hook's and is left alone —
 *  StrictMode replays this effect a few ms after the hook has booted,
 *  and a bare translate here would wipe the scaleX it is drawing. */
function snapPlate(list: HTMLElement, plate: HTMLElement): void {
  if (plate.style.transform) return
  const row = list.querySelector<HTMLElement>('.pf-menu-row[aria-selected="true"]')
  if (!row || row.offsetWidth === 0) return
  plate.style.transform = `translate(${row.offsetLeft}px, ${row.offsetTop}px)`
  plate.style.width = `${row.offsetWidth}px`
  plate.style.height = `${row.offsetHeight}px`
}

export function ProfileMenu({
  tabs,
  active,
  onChange,
  className = ''
}: {
  tabs: ProfileTabId[]
  active: ProfileTabId
  onChange: (t: ProfileTabId) => void
  className?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const plateRef = useRef<HTMLSpanElement>(null)
  const { play } = useSfx()

  // Mount only (reads the DOM's aria-selected, so no prop dependency):
  // every later move — picks, font swaps, orientation, the lg breakpoint
  // — is the motion hook's.
  useLayoutEffect(() => {
    const list = listRef.current
    const plate = plateRef.current
    if (list && plate) snapPlate(list, plate)
  }, [])

  // Phone strip: four or five rows overflow it, so a row picked half
  // off-screen (or named by a deep link) is nudged fully into view.
  // Horizontal only and by hand — scrollIntoView could also scroll the
  // page vertically, which a #hash load must never do.
  useEffect(() => {
    const scroller = listRef.current
    const row = scroller?.querySelector<HTMLElement>(`#pf-tab-${active}`)
    if (!row || !scroller || scroller.scrollWidth <= scroller.clientWidth) return
    const left = row.offsetLeft
    const right = left + row.offsetWidth
    const viewLeft = scroller.scrollLeft
    const viewRight = viewLeft + scroller.clientWidth
    if (left >= viewLeft && right <= viewRight) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollTo({
      left: left < viewLeft ? left : right - scroller.clientWidth,
      behavior: reduce ? 'auto' : 'smooth'
    })
  }, [active])

  // Roving focus: one tab stop for the whole list, arrows move within it
  // (wrapping — both axes, since the list runs across on phones and down
  // on lg), Home/End jump. Buttons already activate on Enter/Space.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(active)
    let next: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (i + 1) % tabs.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (i - 1 + tabs.length) % tabs.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = tabs.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    const id = tabs[next]
    onChange(id)
    // tabIndex -1 buttons still take programmatic focus, so no need to
    // wait for the re-render that promotes the new row to 0
    listRef.current?.querySelector<HTMLButtonElement>(`#pf-tab-${id}`)?.focus()
  }

  return (
    // Below lg: stuck under the 3rem compact bar (ProfileClient's
    // .pf-compact, z-30 over this z-20) for the whole scroll — it is the
    // sheet's direct child there — on paper so rows never read through
    // it, ruled top and bottom. lg+: a static block in the spine; the
    // caller's className frames and spaces it (lg:border overrides
    // border-y).
    <div
      className={`pf-panel sticky top-[calc(var(--pf-sticky-top)+3rem)] z-20 border-y border-[color:var(--pf-line-soft)] bg-[color:var(--pf-paper)] lg:static lg:bg-transparent ${className}`}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label="Unit record sections"
        onKeyDown={onKeyDown}
        className="pf-menu flex snap-x overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-col lg:overflow-visible"
      >
        {tabs.map((id) => {
          const selected = id === active
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`pf-tab-${id}`}
              aria-selected={selected}
              // only the selected pane is mounted (ProfileClient re-keys
              // one [role=tabpanel] on the tab), so only its tab may
              // point at it — a dangling idref is an ARIA violation
              aria-controls={selected ? `pf-pane-${id}` : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(id)}
              onPointerEnter={(e) => {
                // mouse only: a touch fires pointerenter right before the
                // pointerdown tap, which would double the sound
                if (!selected && e.pointerType === 'mouse') play('tapSoft')
              }}
              // phone strip rows sit on the sheet gutter; lg rows sit
              // inside the framed list, so they take the panel inset
              className="pf-menu-row snap-start gap-3 px-[var(--pf-gutter)] lg:px-[var(--pf-inset)]"
            >
              <Marker hollow={!selected} />
              <span data-pf-decode className="whitespace-nowrap">
                {PROFILE_TAB_LABEL[id]}
              </span>
            </button>
          )
        })}
        {/* the inversion; snapped once above, then the motion hook's */}
        <span ref={plateRef} aria-hidden className="pf-menu-plate" />
      </div>
    </div>
  )
}
