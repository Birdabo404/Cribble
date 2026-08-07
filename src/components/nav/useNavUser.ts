'use client'

// Session user for the persistent nav shell. Fetched once per hard load
// (the (app) layout never remounts on client-side navigation) through the
// shared /me client cache, so this and the mounting page's own /me fetch
// collapse into a single request. Tolerates signed-out visitors — the
// leaderboard is viewable without a session, so the nav swaps the account
// menu for a SIGN IN link instead of redirecting.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchMe, invalidate as invalidateMe } from '@/lib/client/fetchMe'
import type { ActiveDevice, MeUser } from '@/types/dashboard'

export interface NavUserState {
  user: MeUser | null
  activeDevice: ActiveDevice | null
  loaded: boolean
  logout: () => Promise<void>
}

export function useNavUser(): NavUserState {
  const router = useRouter()
  const [user, setUser] = useState<MeUser | null>(null)
  const [activeDevice, setActiveDevice] = useState<ActiveDevice | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const result = await fetchMe()
      if (cancelled) return
      if (result.ok) {
        setUser(result.data.user ?? null)
        setActiveDevice(result.data.activeDevice ?? null)
      }
      setLoaded(true)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } finally {
      // The session is gone but /login is a soft navigation — drop the
      // cached /me so nothing keeps rendering the dead session's user.
      invalidateMe()
      router.push('/login')
    }
  }, [router])

  return { user, activeDevice, loaded, logout }
}
