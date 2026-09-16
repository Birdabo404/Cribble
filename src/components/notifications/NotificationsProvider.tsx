'use client'

// Single owner of the notifications feed. AppNav wraps both nav chromes in
// this provider so their bells share one fetch/poll loop (state and logic
// live in useNotifications.ts — see useNotificationsSource), and marking
// read from either bell updates every badge at once.

import type { ReactNode } from 'react'
import {
  NotificationsContext,
  useNotificationsSource
} from '@/hooks/useNotifications'

export function NotificationsProvider({
  children,
  enabled = true
}: {
  children: ReactNode
  enabled?: boolean
}) {
  const api = useNotificationsSource(enabled)
  return (
    <NotificationsContext.Provider value={api}>
      {children}
    </NotificationsContext.Provider>
  )
}
