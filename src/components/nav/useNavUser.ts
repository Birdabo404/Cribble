'use client'

// Session user for the persistent nav shell. Fetched once per hard load
// (the (app) layout never remounts on client-side navigation). Tolerates
// signed-out visitors — the leaderboard is viewable without a session, so
// the nav swaps the account menu for a SIGN IN link instead of redirecting.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
      try {
        const res = await fetch('/api/user/me', { credentials: 'include' })
        if (cancelled || !res.ok) return
        const data = await res.json()
        if (cancelled) return
        setUser(data.user ?? null)
        setActiveDevice(data.activeDevice ?? null)
      } catch {
      } finally {
        if (!cancelled) setLoaded(true)
      }
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
      router.push('/login')
    }
  }, [router])

  return { user, activeDevice, loaded, logout }
}
