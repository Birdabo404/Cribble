'use client'

import { useEffect, useState } from 'react'
import type { SeasonState } from '@/lib/season'

// Season calendar for client pages. Fetched once on mount and re-checked
// when the tab regains focus, which is plenty for data that changes a
// handful of times a year (and flips phase at most twice a quarter).

export function useSeason(): { state: SeasonState | null; loading: boolean } {
  const [state, setState] = useState<SeasonState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch('/api/season', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data?.success) return
        setState({
          phase: data.phase === 'intermission' ? 'intermission' : 'active',
          current: data.current ?? null,
          next: data.next ?? null
        })
      } catch {
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return { state, loading }
}
