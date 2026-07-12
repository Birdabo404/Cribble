'use client'

// Orchestrates which nav chrome renders. Position comes from NavPrefs:
//   left → command rail on md+ screens, top bar below md
//   top  → top bar everywhere
// Renders nothing until mounted: the boot script already reserved the
// correct inset via <html data-nav-*> + CSS, so there is no layout shift —
// the chrome just plays its entrance animation one frame later.

import { useEffect, useState } from 'react'
import { NavRail } from './NavRail'
import { NavTopBar } from './NavTopBar'
import { useNavPrefs } from './NavPrefsContext'
import { useNavUser } from './useNavUser'

export function AppNav() {
  const prefs = useNavPrefs()
  const navUser = useNavUser()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted || !prefs) return null

  const left = prefs.position === 'left'

  return (
    <>
      {left && <NavRail navUser={navUser} />}
      <NavTopBar navUser={navUser} className={left ? 'md:hidden' : ''} />
    </>
  )
}
