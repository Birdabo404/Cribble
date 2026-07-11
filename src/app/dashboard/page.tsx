'use client'

// Dashboard v3 — command-console layout.
// Previous design is preserved at /dashboard/legacy for rollback.

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { Toaster } from '@/components/Toaster'
import { AsciiBanner } from '@/components/dashboard-v2/AsciiBanner'
import { ErrorScreen } from '@/components/dashboard-v2/ErrorScreen'
import { LoadingScreen } from '@/components/dashboard-v2/LoadingScreen'
import { SEASON } from '@/components/dashboard-v2/format'
import { ActivityCard } from '@/components/dashboard-v3/ActivityCard'
import { AmbientGlow } from '@/components/dashboard-v3/AmbientGlow'
import { AsteroidShower } from '@/components/dashboard-v3/AsteroidShower'
import { GlassTilt } from '@/components/dashboard-v3/GlassTilt'
import { Header, type ConnectionState } from '@/components/dashboard-v3/Header'
import { HeroCard } from '@/components/dashboard-v3/HeroCard'
import { KpiStrip } from '@/components/dashboard-v3/KpiStrip'
import { SeasonRail } from '@/components/dashboard-v3/SeasonRail'
import { ToolsCard } from '@/components/dashboard-v3/ToolsCard'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useExtensionSync } from '@/hooks/useExtensionSync'
import { calculateStreak } from '@/lib/activity'
import type { RankInfo } from '@/types/dashboard'

export default function DashboardV3() {
  const router = useRouter()

  const {
    user,
    scores,
    stats,
    activeDevice,
    tools,
    activity,
    leaderboard,
    loading,
    error,
    fetchMe,
    refreshDashboard
  } = useDashboardData()

  const { syncing, handleSync } = useExtensionSync({
    user,
    activeDevice,
    fetchMe,
    refreshDashboard
  })

  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshDashboard({ scope: 'full' })
    } finally {
      setRefreshing(false)
    }
  }, [refreshDashboard])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } finally {
      router.push('/login')
    }
  }

  const streak = useMemo(() => calculateStreak(activity), [activity])

  const rankInfo: RankInfo | null = useMemo(() => {
    if (!user || leaderboard.length === 0) return null
    const idx = leaderboard.findIndex((u) => u.userId === user.id)
    if (idx === -1) return null
    return { position: idx + 1, total: leaderboard.length }
  }, [user, leaderboard])

  const seasonProgress = useMemo(() => {
    const start = new Date(SEASON.startISO).getTime()
    const end = new Date(SEASON.endISO).getTime()
    const now = Date.now()
    const total = end - start
    const elapsed = Math.max(0, Math.min(now - start, total))
    const pct = total > 0 ? Math.round((elapsed / total) * 100) : 0
    const daysLeft = Math.max(0, Math.ceil((end - now) / 86400_000))
    return { pct, daysLeft }
  }, [])

  const connectionState: ConnectionState = useMemo(() => {
    const last = activeDevice?.last_sync_at || user?.last_extension_sync
    if (!last) return 'offline'
    const diff = Date.now() - new Date(last).getTime()
    if (diff < 5 * 60_000) return 'online'
    if (diff < 24 * 3600_000) return 'idle'
    return 'offline'
  }, [activeDevice, user])

  if (loading) return <LoadingScreen />
  if (error || !user) return <ErrorScreen message={error} />

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-mono selection:bg-accent/20">
      <SpaceBackdrop />
      <AmbientGlow />
      <AsteroidShower />
      <GlassTilt />
      {/* horizon line — thin accent scanline at the bottom for retro hint */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 h-px opacity-25 z-0"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgb(var(--accent-rgb)/0.55), transparent)'
        }}
      />

      <div className="dash-reveal-root relative z-10 max-w-6xl mx-auto px-6 pt-10 pb-10">
        <Header
          user={user}
          connection={connectionState}
          lastSync={activeDevice?.last_sync_at || user.last_extension_sync || null}
          onSync={handleSync}
          syncing={syncing}
          activeDevice={activeDevice}
          onLogout={handleLogout}
        />

        <AsciiBanner username={user.twitter_username} />

        <main className="mt-8 grid grid-cols-12 gap-5">
          <HeroCard
            scores={scores}
            rank={rankInfo}
            tier={user.subscription_tier}
            activity={activity}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
          <SeasonRail
            pct={seasonProgress.pct}
            daysLeft={seasonProgress.daysLeft}
            streak={streak}
            activity={activity}
          />

          <KpiStrip stats={stats} />

          <ActivityCard activity={activity} />
          <ToolsCard tools={tools} />
        </main>

        <footer className="mt-8 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
          <span>CRIBBLE · PRIVATE BETA</span>
          <span className="text-accent/60">v3 · {new Date().toLocaleDateString('en-US')}</span>
        </footer>
      </div>

      {/* Outside dash-reveal-root so the entrance cascade never delays toasts */}
      <Toaster />

      <style jsx global>{`
        /* First-paint cascade — header → DASHBOARD banner → cards → footer.
           Uses "backwards" fill (not "both") so the finished animation
           releases the transform, letting the liquid-glass hover lift work.

           Each block also publishes its delay as --ad-base; the inherited
           variable lets elements INSIDE a card stagger relative to their
           card's entrance (see the .anim-* utilities in globals.css). */
        .dash-reveal-root > header,
        .dash-reveal-root > section,
        .dash-reveal-root > main > *,
        .dash-reveal-root > footer {
          animation: dash-reveal-in 760ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--ad-base, 0ms);
        }
        .dash-reveal-root > header {
          --ad-base: 0ms;
        }
        /* AsciiBanner — the "DASHBOARD" wordmark, where the cascade originates */
        .dash-reveal-root > section {
          --ad-base: 90ms;
        }
        .dash-reveal-root > main > *:nth-child(1) {
          --ad-base: 180ms;
        }
        .dash-reveal-root > main > *:nth-child(2) {
          --ad-base: 260ms;
        }
        .dash-reveal-root > main > *:nth-child(3) {
          --ad-base: 340ms;
        }
        .dash-reveal-root > main > *:nth-child(4) {
          --ad-base: 420ms;
        }
        .dash-reveal-root > main > *:nth-child(5) {
          --ad-base: 500ms;
        }
        .dash-reveal-root > footer {
          --ad-base: 600ms;
        }

        /* "from"-only keyframe: animates to each element's natural style,
           so nothing is pinned after the animation completes. */
        @keyframes dash-reveal-in {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.985);
            filter: blur(8px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .dash-reveal-root > header,
          .dash-reveal-root > section,
          .dash-reveal-root > main > *,
          .dash-reveal-root > footer {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
