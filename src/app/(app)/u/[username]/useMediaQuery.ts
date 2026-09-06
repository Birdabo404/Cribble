'use client'

// Live matchMedia subscription for the layout decisions ProfileClient
// has to make in JS rather than CSS: the banner mounts in the spine's
// hero below lg and in the content column from lg up (one <img>, never
// two), and the TRANSMISSIONS feed is only fetched where the panel can
// show. The server snapshot is `false` — the ready markup never renders
// on the server (the profile is client-fetched), so no hydration
// mismatch can arise, and the skeleton makes no such decision.

import { useCallback, useSyncExternalStore } from 'react'

export const LG_QUERY = '(min-width: 1024px)'

export function useMediaQuery(query: string): boolean {
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
