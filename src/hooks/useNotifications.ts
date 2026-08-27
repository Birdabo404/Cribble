'use client'

// Notifications feed state. One NotificationsProvider (mounted by AppNav)
// runs useNotificationsSource — the fetch + poll + refresh-channel owner —
// and every bell reads the shared state through useNotifications(). AppNav
// keeps both nav chromes mounted (rail + top bar, one CSS-hidden), so
// per-bell state used to mean two parallel pollers hitting
// /api/user/notifications; the provider guarantees exactly one.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import {
  normalizeNotificationType,
  type AppNotification
} from '@/types/notifications'

const POLL_INTERVAL_MS = 60_000

// Module-level refresh channel: lets sync flows nudge the feed to refetch
// immediately (a fresh rank/milestone may have just landed) without prop
// drilling through the header. No-op when no provider is mounted.
const refreshListeners = new Set<() => void>()

export function requestNotificationsRefresh(): void {
  refreshListeners.forEach((listener) => listener())
}

export interface NotificationsApi {
  notifications: AppNotification[]
  unreadCount: number
  loading: boolean
  refresh: () => Promise<void>
  markAllRead: () => Promise<void>
}

/**
 * Owns the notifications state: initial fetch, the 60s poll (skipped while
 * the tab is hidden, with a catch-up refetch when it resurfaces), the
 * requestNotificationsRefresh channel, and mark-all-read. Call this from
 * NotificationsProvider ONLY — a second mount would restore the duplicate
 * polling the provider exists to remove.
 */
export function useNotificationsSource(enabled = true): NotificationsApi {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/user/notifications', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      if (!data.success || !Array.isArray(data.notifications)) return
      setNotifications(
        (data.notifications as AppNotification[]).map((n) => ({
          ...n,
          type: normalizeNotificationType(n.type),
          data: n.data ?? {}
        }))
      )
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0)
    } catch {
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
    let lastFetchAt = Date.now()
    const run = () => {
      lastFetchAt = Date.now()
      void refresh()
    }
    const id = setInterval(() => {
      // Hidden tabs skip the poll entirely; the visibility handler below
      // catches up when the tab comes back.
      if (document.hidden) return
      run()
    }, POLL_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.hidden) return
      // Only refetch when hidden long enough to have missed a tick —
      // quick tab flips shouldn't burst requests.
      if (Date.now() - lastFetchAt >= POLL_INTERVAL_MS) run()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refresh])

  useEffect(() => {
    const listener = () => {
      void refresh()
    }
    refreshListeners.add(listener)
    return () => {
      refreshListeners.delete(listener)
    }
  }, [refresh])

  const markAllRead = useCallback(async () => {
    if (!enabled) return
    setUnreadCount(0)
    try {
      await fetch('/api/user/notifications', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      })
    } catch {}
  }, [enabled])

  // Memoized so provider re-renders from above don't cascade into every
  // bell — the reference only changes when the feed state itself does.
  return useMemo(
    () => ({ notifications, unreadCount, loading, refresh, markAllRead }),
    [notifications, unreadCount, loading, refresh, markAllRead]
  )
}

// Lives here (not in the provider's .tsx) so this hook module has no
// component imports; the provider imports from us, never the reverse.
export const NotificationsContext = createContext<NotificationsApi | null>(null)

export function useNotifications(): NotificationsApi {
  const api = useContext(NotificationsContext)
  if (!api) {
    throw new Error(
      'useNotifications must render under <NotificationsProvider> (AppNav mounts it)'
    )
  }
  return api
}
