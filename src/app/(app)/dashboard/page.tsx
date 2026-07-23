'use client'

// Dashboard v3 — command-console layout.
// Navigation chrome (rail/top bar) lives in the (app) shell layout; this
// page publishes its sync status to the nav via usePublishNavStatus.

import { useCallback, useMemo, useState } from 'react'
import { AsciiBanner } from '@/components/dashboard-v2/AsciiBanner'
import { ErrorScreen } from '@/components/dashboard-v2/ErrorScreen'
import { LoadingScreen } from '@/components/dashboard-v2/LoadingScreen'
import { ActivityCard } from '@/components/dashboard-v3/ActivityCard'
import { AsteroidShower } from '@/components/dashboard-v3/AsteroidShower'
import { ExtensionNudge } from '@/components/dashboard-v3/ExtensionNudge'
import { HeroCard } from '@/components/dashboard-v3/HeroCard'
import { KpiStrip } from '@/components/dashboard-v3/KpiStrip'
import { SeasonRail } from '@/components/dashboard-v3/SeasonRail'
import { ToolsCard } from '@/components/dashboard-v3/ToolsCard'
import {
  usePublishNavStatus,
  type ConnectionState,
  type NavStatus
} from '@/components/nav/NavStatusContext'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useExtensionSync } from '@/hooks/useExtensionSync'
import { useSeason } from '@/hooks/useSeason'
import { calculateStreak } from '@/lib/activity'
import { daysUntil, seasonProgress } from '@/lib/season'
import type { RankInfo } from '@/types/dashboard'

export default function DashboardV3() {
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

  const { phase, syncing, handleSync } = useExtensionSync({
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

  const streak = useMemo(() => calculateStreak(activity), [activity])

  const rankInfo: RankInfo | null = useMemo(() => {
    if (!user || leaderboard.length === 0) return null
    const idx = leaderboard.findIndex((u) => u.userId === user.id)
    if (idx === -1) return null
    return { position: idx + 1, total: leaderboard.length }
  }, [user, leaderboard])

  const { state: seasonState } = useSeason()

  // The rail's story depends on the phase: a live season shows progress
  // toward its lock; an intermission counts down to the next launch.
  const seasonRail = useMemo(() => {
    if (seasonState?.phase === 'active' && seasonState.current) {
      const { pct, daysLeft } = seasonProgress(
        seasonState.current.startsAt,
        seasonState.current.endsAt
      )
      return { name: seasonState.current.name, pct, daysLeft, daysLabel: 'D LEFT' }
    }
    if (seasonState?.phase === 'intermission' && seasonState.next) {
      return {
        name: 'INTERMISSION',
        pct: 100,
        daysLeft: daysUntil(seasonState.next.startsAt),
        daysLabel: 'D TO LAUNCH'
      }
    }
    // Calendar still loading (or none exists yet) — neutral placeholder.
    return {
      name: seasonState?.current?.name ?? 'SEASON',
      pct: 0,
      daysLeft: 0,
      daysLabel: 'D LEFT'
    }
  }, [seasonState])

  const connectionState: ConnectionState = useMemo(() => {
    const last = activeDevice?.last_sync_at || user?.last_extension_sync
    if (!last) return 'offline'
    const diff = Date.now() - new Date(last).getTime()
    if (diff < 5 * 60_000) return 'online'
    if (diff < 24 * 3600_000) return 'idle'
    return 'offline'
  }, [activeDevice, user])

  // Surface connection + sync controls in the persistent nav shell.
  const navStatus = useMemo<NavStatus>(
    () => ({
      connection: connectionState,
      lastSync: activeDevice?.last_sync_at || user?.last_extension_sync || null,
      onSync: handleSync,
      syncing
    }),
    [connectionState, activeDevice, user, handleSync, syncing]
  )
  usePublishNavStatus(navStatus)

  if (loading) return <LoadingScreen />
  if (error || !user) return <ErrorScreen message={error} />

  return (
    <>
      <AsteroidShower />

      <div className="page-zoom-out dash-reveal-root dash-duotone relative max-w-6xl mx-auto px-6 pt-6 pb-10">
        <AsciiBanner username={user.twitter_username} />

        <main className="mt-8 grid grid-cols-12 gap-5">
          <ExtensionNudge user={user} activeDevice={activeDevice} phase={phase} />
          <HeroCard
            scores={scores}
            rank={rankInfo}
            tier={user.subscription_tier}
            activity={activity}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
          <SeasonRail
            name={seasonRail.name}
            pct={seasonRail.pct}
            daysLeft={seasonRail.daysLeft}
            daysLabel={seasonRail.daysLabel}
            streak={streak}
            activity={activity}
          />

          <KpiStrip stats={stats} />

          <ActivityCard activity={activity} />
          <ToolsCard tools={tools} />
        </main>

        {/* Dossier footer — build line on a dotted leader, stamped with a
            barcode strip. */}
        <footer className="mt-10 flex items-baseline gap-4 font-data text-[9px] tracking-[0.3em] text-zinc-600">
          <span className="shrink-0">CRIBBLE · PRIVATE BETA</span>
          <span aria-hidden className="dash-leader-dots" />
          <span className="shrink-0 text-zinc-500">
            CONSOLE V3 ·{' '}
            {new Date()
              .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
              .toUpperCase()}
          </span>
          <span aria-hidden className="dash-barcode h-3.5 w-20 shrink-0" />
        </footer>
      </div>

      <style jsx global>{`
        /* First-paint cascade — DASHBOARD banner → cards → footer.
           Uses "backwards" fill (not "both") so the finished animation
           releases the transform, letting the liquid-glass hover lift work.

           Each block also publishes its delay as --ad-base; the inherited
           variable lets elements INSIDE a card stagger relative to their
           card's entrance (see the .anim-* utilities in globals.css). */
        .dash-reveal-root > section,
        .dash-reveal-root > main > *,
        .dash-reveal-root > footer {
          animation: dash-reveal-in 760ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--ad-base, 0ms);
        }
        /* AsciiBanner — the "DASHBOARD" wordmark, where the cascade originates */
        .dash-reveal-root > section {
          --ad-base: 0ms;
        }
        .dash-reveal-root > main > *:nth-child(1) {
          --ad-base: 100ms;
        }
        .dash-reveal-root > main > *:nth-child(2) {
          --ad-base: 180ms;
        }
        .dash-reveal-root > main > *:nth-child(3) {
          --ad-base: 260ms;
        }
        .dash-reveal-root > main > *:nth-child(4) {
          --ad-base: 340ms;
        }
        .dash-reveal-root > main > *:nth-child(5) {
          --ad-base: 420ms;
        }
        .dash-reveal-root > footer {
          --ad-base: 520ms;
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
          .dash-reveal-root > section,
          .dash-reveal-root > main > *,
          .dash-reveal-root > footer {
            animation: none;
          }
        }
      `}</style>
    </>
  )
}
