'use client'

// Live `(min-width: Npx)` subscription for the layout decisions the bag
// page has to make in JS rather than CSS: which register density to
// render, which tab id labels the panel, and whether Enter on a locked
// item opens the spec drawer (the sheet is not on screen below lg). Same
// shape as the profile page's useMediaQuery: useSyncExternalStore with a
// `false` server snapshot, so SSR and the first client paint agree and
// the desktop layout lands in the post-hydration render.

import { useCallback, useSyncExternalStore } from 'react'

/** Tailwind's default `md` / `lg` screens, in px. */
export const MD_MIN = 768
export const LG_MIN = 1024

export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query]
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
