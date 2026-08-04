'use client'

// Animation stage budget for the Supply Depot. The shop mounts ~20
// PlateLayer scenes at once and, left alone, every one of them animates
// forever — far below the fold and clipped inside shelf scrollers alike.
// One shared IntersectionObserver flips `data-offstage` on card roots as
// they enter/leave the stage; the page's CSS pauses every scene animation
// under `[data-offstage]` (see shop/page.tsx). Paused — not removed — so
// a returning card resumes mid-loop instead of restarting its scene.
//
// SSR/hydration contract: cards render `data-offstage` PRESENT in their
// JSX, so the server markup and the client's first render agree, and
// below-fold scenes never run a first-frame animation burst. After
// hydration only the observer touches the attribute; React never diffs it
// again because the JSX value stays constant.

import { useEffect, type RefObject } from 'react'

export const OFFSTAGE_ATTR = 'data-offstage'

// One module-level observer shared by every shop card, created lazily on
// first client use (module scope must stay SSR-safe). The document
// viewport root covers both axes: a shelf card clipped away by its
// horizontal scroller has no viewport intersection either, so no
// per-scroller observers are needed. 150px of rootMargin wakes scenes
// just before they scroll into view.
let stageObserver: IntersectionObserver | null = null

function getStageObserver(): IntersectionObserver {
  if (!stageObserver) {
    stageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.removeAttribute(OFFSTAGE_ATTR)
          else entry.target.setAttribute(OFFSTAGE_ATTR, '')
        }
      },
      { rootMargin: '150px' }
    )
  }
  return stageObserver
}

/** Card roots call this with their root ref (and render `data-offstage`
 * in JSX — see the SSR contract above); the shared observer then owns the
 * attribute for the element's whole mounted life. */
export function useOnStage(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = getStageObserver()
    observer.observe(el)
    return () => observer.unobserve(el)
  }, [ref])
}
