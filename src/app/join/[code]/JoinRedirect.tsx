'use client'

import { useEffect } from 'react'

/**
 * Humans bounce to /login almost immediately; crawlers (no JS) stay on
 * the interstitial and read the invite metadata — the old server 302 is
 * exactly what starved link unfurls. `replace` keeps /join/CODE out of
 * history so Back doesn't loop through the redirect.
 */
export function JoinRedirect({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href)
  }, [href])
  return null
}
