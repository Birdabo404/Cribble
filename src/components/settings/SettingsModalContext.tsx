'use client'

// Global settings-modal state. The provider wraps AppShell in the (app)
// layout so nav chrome (AccountMenu, NotificationBell) and page CTAs can
// open settings from anywhere without a route change. The modal itself is
// rendered by SettingsModalHost, mounted INSIDE AppShell so the sections
// can reach NavPrefs / BackgroundMusic / theme providers.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { SettingsSectionId } from './sectionIds'

interface SettingsModalContextValue {
  /** Active section while the modal is open, null while closed. */
  section: SettingsSectionId | null
  /** Opens the modal on a section (or switches sections while open). */
  openSettings: (section?: SettingsSectionId) => void
  closeSettings: () => void
}

const SettingsModalContext = createContext<SettingsModalContextValue | null>(null)

export function SettingsModalProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<SettingsSectionId | null>(null)

  const openSettings = useCallback((next: SettingsSectionId = 'account') => {
    setSection(next)
  }, [])
  const closeSettings = useCallback(() => setSection(null), [])

  const value = useMemo(
    () => ({ section, openSettings, closeSettings }),
    [section, openSettings, closeSettings]
  )

  return <SettingsModalContext.Provider value={value}>{children}</SettingsModalContext.Provider>
}

export function useSettingsModal(): SettingsModalContextValue {
  const ctx = useContext(SettingsModalContext)
  if (!ctx) {
    throw new Error('useSettingsModal must be used within SettingsModalProvider')
  }
  return ctx
}
