'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'
import { fetchMe as requestMe, invalidate as invalidateMe } from '@/lib/client/fetchMe'
import {
  EMPTY_SCORES,
  EMPTY_STATS,
  type ActiveDevice,
  type ActivityDay,
  type MeFetchResult,
  type MeScores,
  type MeStats,
  type MeUser,
  type RankInfo,
  type ToolRow
} from '@/types/dashboard'

const POLL_INTERVAL_MS = 30_000
const PUSH_REFRESH_DEBOUNCE_MS = 1_200

export interface DashboardData {
  user: MeUser | null
  scores: MeScores
  stats: MeStats
  activeDevice: ActiveDevice | null
  tools: ToolRow[]
  activity: ActivityDay[]
  rank: RankInfo | null
  loading: boolean
  error: string | null
  fetchMe: () => Promise<MeFetchResult>
  refreshDashboard: () => Promise<MeFetchResult>
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
  const [rank, setRank] = useState<RankInfo | null>(null)

  // True once a /api/user/me response has populated state. Transient
  // failures after that point must keep the last good data on screen
  // instead of tearing the dashboard down to an error state.
  const hasDataRef = useRef(false)

  const fetchMe = useCallback(async (): Promise<MeFetchResult> => {
    // Goes through the shared /me client cache, so a dashboard mount
    // reuses the nav shell's request instead of firing a duplicate.
    const result = await requestMe()
    if (!result.ok) {
      // 401 means the session is genuinely gone (the API returns 503 for
      // transient lookup failures) — only then is a login bounce correct.
      if (result.status === 401) {
        router.push('/login')
        return { ok: false }
      }
      // Network blips (dev-server rebuilds, wake from sleep) and 5xx land
      // here. Callers run from intervals and fire-and-forget listeners, so
      // this must resolve — a throw becomes an unhandled rejection. Only
      // surface the error when there is no data yet; a later successful
      // poll clears it.
      if (!hasDataRef.current) setError('Failed to load profile')
      return { ok: false }
    }
    const data = result.data
    hasDataRef.current = true
    setError(null)
    setUser(data.user)
    if (data.scores) setScores(data.scores)
    if (data.stats) setStats(data.stats)
    setActiveDevice(data.activeDevice || null)
    // rank is a newer /me field; older server builds omit it entirely.
    setRank(data.rank ?? null)
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

  const refreshDashboard = useCallback(async (): Promise<MeFetchResult> => {
    // Refreshes announce "something changed server-side" (extension sync,
    // manual refresh, poll tick) — skip the short /me TTL cache so the
    // new state is actually fetched.
    invalidateMe()
    const [me] = await Promise.all([fetchMe(), fetchTools(), fetchActivity()])
    return me
  }, [fetchMe, fetchTools, fetchActivity])

  // First load: everything in parallel, and the loading gate clears when
  // the core trio (me + tools + activity) settles. None of these reject:
  // on a dead session /me handles the login bounce while tools/activity
  // quietly 401 — same signed-out end state as before, minus the
  // sequential waterfall.
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      await Promise.all([fetchMe(), fetchTools(), fetchActivity()])
      if (!cancelled) setLoading(false)
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [fetchMe, fetchTools, fetchActivity])

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
    // Data is fresh when this effect mounts (init/login just fetched), so
    // the staleness clock starts now.
    let lastRefreshAt = Date.now()
    const runRefresh = () => {
      lastRefreshAt = Date.now()
      void refreshRef.current()
    }
    const id = setInterval(() => {
      // Hidden tabs skip the poll entirely; the visibility handler below
      // catches up the moment the player returns.
      if (document.hidden) return
      runRefresh()
    }, POLL_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.hidden) return
      // Only refresh when the tab was hidden long enough to have missed a
      // tick — quick tab flips shouldn't burst requests.
      if (Date.now() - lastRefreshAt >= POLL_INTERVAL_MS) runRefresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [userId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = () => {
      if (timer) return
      timer = setTimeout(async () => {
        timer = null
        const previousTotal = totalScoreRef.current
        const result = await refreshRef.current()
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
    rank,
    loading,
    error,
    fetchMe,
    refreshDashboard
  }
}
