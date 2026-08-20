'use client'

import { useEffect } from 'react'

const HOLD_MS = 2000

/**
 * Humans hold on the invite interstitial for two seconds, then bounce to
 * /login. Crawlers (no JS) never fire this and keep the OG HTML — the old
 * server 302 is exactly what starved link unfurls. `replace` keeps
 * /join/CODE out of history so Back doesn't loop through the redirect.
 */
export function JoinRedirect({ href }: { href: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.replace(href)
    }, HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [href])
  return null
}
