'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'
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

  // True once a /api/user/me response has populated state. Transient
  // failures after that point must keep the last good data on screen
  // instead of tearing the dashboard down to an error state.
  const hasDataRef = useRef(false)

  const fetchMe = useCallback(async (): Promise<MeFetchResult> => {
    let data: MeResponsePayload
    try {
      const res = await fetch('/api/user/me', { credentials: 'include' })
      // 401 means the session is genuinely gone (the API returns 503 for
      // transient lookup failures) — only then is a login bounce correct.
      if (res.status === 401) {
        router.push('/login')
        return { ok: false }
      }
      if (!res.ok) throw new Error(`me fetch failed (${res.status})`)
      data = await res.json()
    } catch {
      // Network blips (dev-server rebuilds, wake from sleep) and 5xx land
      // here. Callers run from intervals and fire-and-forget listeners, so
      // this must resolve — a throw becomes an unhandled rejection. Only
      // surface the error when there is no data yet; a later successful
      // poll clears it.
      if (!hasDataRef.current) setError('Failed to load profile')
      return { ok: false }
    }
    hasDataRef.current = true
    setError(null)
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

  // Latest total score, readable from the push-refresh listener below
  // without re-subscribing it on every scores update.
  const totalScoreRef = useRef(0)
  useEffect(() => {
    totalScoreRef.current = scores.total_score
  }, [scores.total_score])

  // Keyed on the id, not the object: `user` is replaced by every poll, and
  // an object dependency would tear down and recreate the interval each tick.
  const userId = user?.id ?? null
  useEffect(() => {
    if (userId === null) return
    const id = setInterval(() => {
      void refreshRef.current({ scope: 'core' })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [userId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = () => {
      if (timer) return
      timer = setTimeout(async () => {
        timer = null
        const previousTotal = totalScoreRef.current
        const result = await refreshRef.current({ scope: 'core' })
        if (!result.ok || !result.data.scores) return
        const delta = result.data.scores.total_score - previousTotal
        // previousTotal > 0 guards the first load, where the "gain" would
        // just be the lifetime total arriving.
        if (delta > 0 && previousTotal > 0) {
          toast({
            kind: 'score',
            title: 'POINTS EARNED',
            body: 'Background sync from your extension.',
            scoreDelta: delta,
            durationMs: 4200
          })
          requestNotificationsRefresh()
        }
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
