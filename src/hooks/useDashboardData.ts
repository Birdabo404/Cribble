'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  EMPTY_SCORES,
  EMPTY_STATS,
  type ActiveDevice,
  type ActivityDay,
  type LeaderUser,
  type MeFetchResult,
  type MeResponsePayload,
  type MeScores,
  type MeStats,
  type MeUser,
  type OnboardingProfile,
  type ToolRow
} from '@/types/dashboard'

export type RefreshScope = 'core' | 'full'

const POLL_INTERVAL_MS = 30_000
const PUSH_REFRESH_DEBOUNCE_MS = 1_200

export interface DashboardData {
  user: MeUser | null
  scores: MeScores
  stats: MeStats
  activeDevice: ActiveDevice | null
  tools: ToolRow[]
  activity: ActivityDay[]
  leaderboard: LeaderUser[]
  profile: OnboardingProfile
  loading: boolean
  error: string | null
  fetchMe: () => Promise<MeFetchResult>
  refreshDashboard: (opts: { scope: RefreshScope }) => Promise<MeFetchResult>
}

export function useDashboardData(): DashboardData {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [user, setUser] = useState<MeUser | null>(null)
  const [scores, setScores] = useState<MeScores>(EMPTY_SCORES)
  const [stats, setStats] = useState<MeStats>(EMPTY_STATS)
  const [activeDevice, setActiveDevice] = useState<ActiveDevice | null>(null)
  const [tools, setTools] = useState<ToolRow[]>([])
  const [activity, setActivity] = useState<ActivityDay[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderUser[]>([])
  const [profile, setProfile] = useState<OnboardingProfile>({ role: null, goal: null })

  const fetchMe = useCallback(async (): Promise<MeFetchResult> => {
    const res = await fetch('/api/user/me', { credentials: 'include' })
    if (res.status === 401) {
      router.push('/login')
      return { ok: false }
    }
    if (!res.ok) {
      setError('Failed to load profile')
      return { ok: false }
    }
    const data: MeResponsePayload = await res.json()
    setUser(data.user)
    if (data.scores) setScores(data.scores)
    if (data.stats) setStats(data.stats)
    setActiveDevice(data.activeDevice || null)
    return { ok: true, data }
  }, [router])

  const fetchTools = useCallback(async () => {
    try {
      const res = await fetch('/api/user/tools?limit=5', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      if (data.success && Array.isArray(data.tools)) setTools(data.tools)
    } catch {}
  }, [])

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/user/activity?days=84', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      if (data.success && Array.isArray(data.activity)) setActivity(data.activity)
    } catch {}
  }, [])

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      if (!data.success) return
      const rows = Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.leaderboard)
          ? data.leaderboard
          : []
      if (rows.length > 0) {
        setLeaderboard(rows)
      } else {
        setLeaderboard([])
      }
    } catch {}
  }, [])

  const fetchOnboarding = useCallback(async () => {
    try {
      const res = await fetch('/api/user/onboarding', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      const metaRole =
        data?.role ||
        (typeof data?.metadata?.role === 'string' ? data.metadata.role : null)
      const metaGoal =
        typeof data?.metadata?.goal === 'string' ? data.metadata.goal : null
      setProfile({ role: metaRole, goal: metaGoal })
    } catch {}
  }, [])

  const refreshDashboard = useCallback(
    async ({ scope }: { scope: RefreshScope }): Promise<MeFetchResult> => {
      const me = await fetchMe()
      if (!me.ok) return me
      const tasks: Promise<unknown>[] = [fetchTools(), fetchActivity()]
      switch (scope) {
        case 'core':
          break
        case 'full':
          tasks.push(fetchLeaderboard())
          break
      }
      await Promise.all(tasks)
      return me
    },
    [fetchMe, fetchTools, fetchActivity, fetchLeaderboard]
  )

  // Onboarding is only ever fetched here.
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const me = await fetchMe()
      if (!me.ok || cancelled) {
        setLoading(false)
        return
      }
      await Promise.all([
        fetchTools(),
        fetchActivity(),
        fetchLeaderboard(),
        fetchOnboarding()
      ])
      if (!cancelled) setLoading(false)
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [fetchMe, fetchTools, fetchActivity, fetchLeaderboard, fetchOnboarding])

  // Keeps the poll/listener effects from tearing down on every refresh.
  const refreshRef = useRef(refreshDashboard)
  useEffect(() => {
    refreshRef.current = refreshDashboard
  }, [refreshDashboard])

  useEffect(() => {
    if (!user) return
    const id = setInterval(() => {
      void refreshRef.current({ scope: 'core' })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [user])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void refreshRef.current({ scope: 'core' })
      }, PUSH_REFRESH_DEBOUNCE_MS)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'CRIBBLE_POINTS_EARNED') {
        scheduleRefresh()
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      if (timer) clearTimeout(timer)
    }
  }, [])

  return {
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
  }
}
