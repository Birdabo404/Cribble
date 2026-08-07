'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  normalizeNotificationType,
  type AppNotification
} from '@/types/notifications'

const POLL_INTERVAL_MS = 60_000

// Module-level refresh channel: lets sync flows nudge the bell to refetch
// immediately (a fresh rank/milestone may have just landed) without prop
// drilling through the header. No-op when no bell is mounted.
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

export function useNotifications(): NotificationsApi {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
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
  }, [])

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
    setUnreadCount(0)
    try {
      await fetch('/api/user/notifications', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      })
    } catch {}
  }, [])

  return { notifications, unreadCount, loading, refresh, markAllRead }
}
