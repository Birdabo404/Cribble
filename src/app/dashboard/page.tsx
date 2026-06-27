'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { AccountModal } from '@/components/dashboard-v2/AccountModal'
import { ActivityCard } from '@/components/dashboard-v2/ActivityCard'
import { AsciiBanner } from '@/components/dashboard-v2/AsciiBanner'
import { ErrorScreen } from '@/components/dashboard-v2/ErrorScreen'
import { HeroCard } from '@/components/dashboard-v2/HeroCard'
import { Header, type ConnectionState } from '@/components/dashboard-v2/Header'
import { LeaderboardCard } from '@/components/dashboard-v2/LeaderboardCard'
import { LoadingScreen } from '@/components/dashboard-v2/LoadingScreen'
import { SeasonCard } from '@/components/dashboard-v2/SeasonCard'
import { StatsStrip } from '@/components/dashboard-v2/StatsStrip'
import { ToolsCard } from '@/components/dashboard-v2/ToolsCard'
import { SEASON } from '@/components/dashboard-v2/format'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useExtensionSync } from '@/hooks/useExtensionSync'
import { calculateStreak } from '@/lib/activity'
import type { GlobalTotals, RankInfo } from '@/types/dashboard'

export default function DashboardV2() {
  const router = useRouter()
  const [accountOpen, setAccountOpen] = useState(false)

  const {
    user,
    scores,
    stats,
    activeDevice,
    tools,
    activity,
    leaderboard,
    profile,
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

  const globalTotals: GlobalTotals = useMemo(() => {
    const totalPlayers = leaderboard.length
    const activePlayers = leaderboard.filter((u) => u.isActive).length
    const totalPoints = leaderboard.reduce((s, u) => s + (u.score || 0), 0)
    return { totalPlayers, activePlayers, totalPoints }
  }, [leaderboard])

  const nearbyLeaders = useMemo(() => {
    if (leaderboard.length === 0) return []
    if (!user) return leaderboard.slice(0, 6)
    const idx = leaderboard.findIndex((u) => u.userId === user.id)
    if (idx === -1) return leaderboard.slice(0, 6)
    const top = leaderboard.slice(0, 3)
    const start = Math.max(0, idx - 1)
    const window = leaderboard.slice(start, start + 3)
    const seen = new Set<number>()
    return [...top, ...window].filter((u) => {
      if (seen.has(u.userId)) return false
      seen.add(u.userId)
      return true
    }).slice(0, 6)
  }, [leaderboard, user])

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
    <div className="min-h-screen bg-black text-zinc-100 font-mono selection:bg-[#02fe01]/20">
      <SpaceBackdrop />
      {/* horizon line — thin emerald scanline at the bottom for retro hint */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 h-px opacity-25 z-0"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(2,254,1,0.55), transparent)'
        }}
      />

      <div className="dash-reveal-root relative z-10 max-w-6xl mx-auto px-6 pt-10 pb-10">
        <Header
          user={user}
          connection={connectionState}
          lastSync={activeDevice?.last_sync_at || user.last_extension_sync || null}
          onSync={handleSync}
          syncing={syncing}
          onOpenAccount={() => setAccountOpen(true)}
        />

        <AccountModal
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          user={user}
          totalScore={scores.total_score}
          activeDevice={activeDevice}
          rank={rankInfo}
          onLogout={handleLogout}
          streak={streak}
          role={profile.role}
          goal={profile.goal}
        />

        <AsciiBanner username={user.twitter_username} />

        <main className="mt-8 grid grid-cols-12 gap-5">
          <HeroCard
            score={scores.total_score}
            todayDelta={scores.today_score}
            rank={rankInfo}
            tier={user.subscription_tier}
          />
          <SeasonCard pct={seasonProgress.pct} daysLeft={seasonProgress.daysLeft} />

          <StatsStrip
            streak={streak}
            stats={stats}
          />

          <ActivityCard activity={activity} />
          <ToolsCard tools={tools} />

          <LeaderboardCard
            rows={nearbyLeaders}
            currentUserId={user.id}
            totals={globalTotals}
            myRank={rankInfo}
          />
        </main>

        <footer className="mt-8 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
          <span>CRIBBLE · PRIVATE BETA</span>
          <span className="text-[#02fe01]/60">v2 · {new Date().toLocaleDateString('en-US')}</span>
        </footer>
      </div>

      <style jsx global>{`
        /* First-paint cascade — header → DASHBOARD banner → cards → footer.
           Plays once on mount; subsequent re-renders don't reapply because
           the keyframe runs to completion with "both" fill. */
        .dash-reveal-root > header,
        .dash-reveal-root > section,
        .dash-reveal-root > main > *,
        .dash-reveal-root > footer {
          animation: dash-reveal-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .dash-reveal-root > header {
          animation-delay: 0ms;
        }
        /* AsciiBanner — the "DASHBOARD" wordmark, where the cascade originates */
        .dash-reveal-root > section {
          animation-delay: 70ms;
        }
        .dash-reveal-root > main > *:nth-child(1) {
          animation-delay: 150ms;
        }
        .dash-reveal-root > main > *:nth-child(2) {
          animation-delay: 210ms;
        }
        .dash-reveal-root > main > *:nth-child(3) {
          animation-delay: 270ms;
        }
        .dash-reveal-root > main > *:nth-child(4) {
          animation-delay: 330ms;
        }
        .dash-reveal-root > main > *:nth-child(5) {
          animation-delay: 390ms;
        }
        .dash-reveal-root > main > *:nth-child(6) {
          animation-delay: 450ms;
        }
        .dash-reveal-root > footer {
          animation-delay: 520ms;
        }

        @keyframes dash-reveal-in {
          0% {
            opacity: 0;
            transform: translateY(10px);
            filter: blur(4px);
          }
          60% {
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
            filter: blur(0);
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
