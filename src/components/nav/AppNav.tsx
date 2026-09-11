'use client'

// Orchestrates which nav chrome renders. Position comes from NavPrefs:
//   left → command rail on md+ screens, top bar below md
//   top  → top bar everywhere
// Renders nothing until mounted: the boot script already reserved the
// correct inset via <html data-nav-*> + CSS, so there is no layout shift —
// the chrome just plays its entrance animation one frame later.
//
// Under the left position both chromes stay mounted and CSS hides the twin
// the breakpoint doesn't show, so the hidden one downgrades its LiquidMark
// to the static image (markStill) — one live WebGL shader at a time. The
// NotificationsProvider wraps both chromes for the same reason: their
// bells share one fetch/poll loop instead of running one each.

import { useEffect, useState } from 'react'
import { NotificationsProvider } from '@/components/notifications/NotificationsProvider'
import { NavRail } from './NavRail'
import { NavTopBar } from './NavTopBar'
import { useNavPrefs } from './NavPrefsContext'
import { useNavUser } from './useNavUser'
import { shouldLoadAccountQueries } from '@/lib/client/accountQueryPolicy'

// Tracks Tailwind's `md` breakpoint (min-width: 768px) — the same cut the
// chrome's hidden/md:flex + md:hidden classes key off. `null` until the
// effect runs, so SSR and first paint can't disagree with the client.
function useIsDesktop(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return isDesktop
}

export function AppNav() {
  const prefs = useNavPrefs()
  const navUser = useNavUser()
  const isDesktop = useIsDesktop()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted || !prefs) return null

  const left = prefs.position === 'left'
  // Which chrome CSS actually shows: the rail on md+ under the left
  // position, the top bar in every other case. While the breakpoint is
  // still unknown both marks render still — the mark is decorative, so a
  // static first frame is invisible and hydration stays deterministic.
  const railVisible = left && isDesktop === true
  const topBarVisible = isDesktop !== null && !railVisible

  return (
    <NotificationsProvider
      enabled={shouldLoadAccountQueries(
        !navUser.loaded ? 'loading' : navUser.user ? 'signed-in' : 'anonymous'
      )}
    >
      {left && <NavRail navUser={navUser} markStill={!railVisible} />}
      <NavTopBar
        navUser={navUser}
        markStill={!topBarVisible}
        className={left ? 'md:hidden' : ''}
      />
    </NotificationsProvider>
  )
}
