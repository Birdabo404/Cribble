'use client'

// Navigation preferences — position (left rail vs top bar) and rail
// expansion. Persisted to localStorage and mirrored onto <html> as
// data-nav-pos / data-nav-exp so pure CSS can lay out the content inset
// before React hydrates (a boot script in the root layout seeds the
// attributes pre-paint; see navBoot.ts).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { NAV_EXPANDED_KEY, NAV_POSITION_KEY } from './navBoot'

export type NavPosition = 'left' | 'top'

export interface NavPrefs {
  position: NavPosition
  expanded: boolean
  setPosition: (position: NavPosition) => void
  setExpanded: (expanded: boolean) => void
  toggleExpanded: () => void
}

// Defaults: top bar, and if the user switches to the left rail it starts
// collapsed — expanding is an explicit user action.
function readPosition(): NavPosition {
  if (typeof window === 'undefined') return 'top'
  try {
    return window.localStorage.getItem(NAV_POSITION_KEY) === 'left' ? 'left' : 'top'
  } catch {
    return 'top'
  }
}

function readExpanded(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(NAV_EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

const NavPrefsCtx = createContext<NavPrefs | null>(null)

export function NavPrefsProvider({ children }: { children: ReactNode }) {
  const [position, setPositionState] = useState<NavPosition>(readPosition)
  const [expanded, setExpandedState] = useState<boolean>(readExpanded)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.navPos = position
    root.dataset.navExp = expanded ? '1' : '0'
    try {
      window.localStorage.setItem(NAV_POSITION_KEY, position)
      window.localStorage.setItem(NAV_EXPANDED_KEY, expanded ? '1' : '0')
    } catch {}
  }, [position, expanded])

  const setPosition = useCallback((next: NavPosition) => {
    setPositionState(next)
  }, [])

  const setExpanded = useCallback((next: boolean) => {
    setExpandedState(next)
  }, [])

  const toggleExpanded = useCallback(() => {
    setExpandedState((v) => !v)
  }, [])

  const value = useMemo<NavPrefs>(
    () => ({ position, expanded, setPosition, setExpanded, toggleExpanded }),
    [position, expanded, setPosition, setExpanded, toggleExpanded]
  )

  return <NavPrefsCtx.Provider value={value}>{children}</NavPrefsCtx.Provider>
}

/** Null outside the app shell (e.g. if a nav-aware control renders on a
 *  marketing page) — callers hide their UI in that case. */
export function useNavPrefs(): NavPrefs | null {
  return useContext(NavPrefsCtx)
}
