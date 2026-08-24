'use client'

import { useEffect } from 'react'

const HEARTBEAT_MS = 30_000

function ping(): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return
  }
  void fetch('/api/analytics/hit', { method: 'POST', keepalive: true })
}

/** First-party heartbeat for the leaderboard visitor ticker. Renders
 *  nothing; posts a hash-only ping on load and while the tab is visible. */
export function VisitorPulse() {
  useEffect(() => {
    ping()
    const id = setInterval(ping, HEARTBEAT_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
