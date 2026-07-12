'use client'

// /profile is a stable alias: resolve the session user, then land on
// their public dossier at /u/[username]. Kept because the nav rail,
// account menu, and old links all point here.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ProfileRedirect() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const resolve = async () => {
      try {
        const res = await fetch('/api/user/me', { credentials: 'include' })
        if (res.status === 401) {
          router.replace('/login')
          return
        }
        if (!res.ok) throw new Error('me fetch failed')
        const data = await res.json()
        const username = data?.user?.twitter_username
        if (cancelled) return
        if (username) {
          router.replace(`/u/${encodeURIComponent(username)}`)
        } else {
          router.replace('/dashboard')
        }
      } catch {
        if (!cancelled) router.replace('/dashboard')
      }
    }
    void resolve()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <div className="relative mx-auto max-w-2xl px-6 pt-24 text-center">
      <div className="text-[10px] tracking-[0.4em] text-zinc-500 animate-pulse">
        OPENING DOSSIER…
      </div>
    </div>
  )
}
