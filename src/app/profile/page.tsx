'use client'

// Placeholder profile page — the dropdown's PROFILE item lands here.
// Full profile (mission, role, stats, badges) to be built out.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { tierAccent } from '@/components/dashboard-v2/format'
import type { MeUser } from '@/types/dashboard'

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<MeUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/user/me', { credentials: 'include' })
        if (res.status === 401) {
          router.push('/login')
          return
        }
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setUser(data.user)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-mono selection:bg-accent/20">
      <SpaceBackdrop />
      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-10 pb-10">
        <header className="flex items-center justify-between gap-4">
          <div className="text-sm tracking-[0.4em] text-zinc-100 font-semibold">
            CRIBBLE<span className="text-accent">.</span>
          </div>
          <a
            href="/dashboard"
            className="text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            ← DASHBOARD
          </a>
        </header>

        <main className="mt-12">
          <div className="rounded-2xl glass-pop overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3 border-b border-white/[0.08]">
              <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]" />
              <span className="text-[10px] tracking-[0.4em] text-zinc-300">PROFILE</span>
            </div>

            <div className="p-6">
              {loading ? (
                <div className="text-[10px] tracking-[0.3em] text-zinc-500 animate-pulse">
                  LOADING…
                </div>
              ) : user ? (
                <div className="flex items-center gap-4">
                  {user.twitter_profile_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.twitter_profile_image}
                      alt={user.twitter_username}
                      className="h-16 w-16 rounded-full border border-zinc-800 object-cover"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-full border border-zinc-800 bg-zinc-900" />
                  )}
                  <div className="min-w-0">
                    <div className="text-lg text-zinc-50 truncate">
                      {user.twitter_name || user.twitter_username}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      @{user.twitter_username}
                    </div>
                    <span
                      className={`mt-2 inline-block text-[9px] tracking-[0.3em] px-1.5 py-0.5 rounded border ${tierAccent(user.subscription_tier)}`}
                    >
                      {(user.subscription_tier || 'FREE').toUpperCase()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-500">Could not load profile.</div>
              )}

              <div className="mt-6 rounded-lg liquid-glass-inset px-4 py-3.5">
                <div className="text-[9px] tracking-[0.3em] text-accent/80">
                  {'// '}UNDER CONSTRUCTION
                </div>
                <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                  The full pilot profile — mission, role, badges, and career stats — is on its
                  way. For now, your numbers live on the dashboard.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
