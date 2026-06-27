'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SetupWizardModal from '@/components/SetupWizardModal'
import AnimatedCounter from '@/components/AnimatedCounter'
import RadarDisplay from '@/components/RadarDisplay'
import { calculateStreak } from '@/lib/activity'

interface User {
  id: number
  twitter_username: string
  twitter_name: string
  twitter_profile_image: string
  created_at: string
  last_login: string
  subscription_tier?: 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'PREMIUM+'
  user_type?: 'student' | 'developer' | 'researcher' | 'analyst' | 'content_creator' | 'crypto'
}

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [extensionDetected, setExtensionDetected] = useState(false)
  const [extensionUuid, setExtensionUuid] = useState<string | null>(null)
  const [showSetupWizard, setShowSetupWizard] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [glitching, setGlitching] = useState(false)
  const [extensionStats, setExtensionStats] = useState({
    totalScore: 0,
    todayScore: 0,
    totalVisits: 0,
    todayVisits: 0,
    totalTime: 0,
    todayTime: 0,
    activeTime: 0,
    efficiency: 0,
    streak: 0,
    rank: 'Rookie'
  })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<{
    state: 'unknown' | 'connected' | 'inactive' | 'missing'
    deviceUuid?: string
    lastSync?: string | null
    message?: string
  }>({ state: 'unknown' })
  const [isForcingSync, setIsForcingSync] = useState(false)
  const [resetConfirm, setResetConfirm] = useState('')
  const [isResetting, setIsResetting] = useState(false)
  const enableReset = process.env.NEXT_PUBLIC_ENABLE_RESET_BUTTON === 'true'

  const [leaderboardRank, setLeaderboardRank] = useState<{ position: number; total: number } | null>(null)
  const [activityData, setActivityData] = useState<{ date: string; score: number }[]>([])
  const [toasts, setToasts] = useState<{ id: string; points: number; domain: string }[]>([])
  const [isLiveSyncing, setIsLiveSyncing] = useState(false)

  useEffect(() => {
    fetchUserData()
    initializeExtensionConnection()
    const glitchInterval = setInterval(() => {
      if (Math.random() > 0.8) {
        setGlitching(true)
        setTimeout(() => setGlitching(false), 80)
      }
    }, 4000)
    return () => clearInterval(glitchInterval)
  }, [])

  useEffect(() => {
    if (user) {
      fetchUserScores()
      const interval = setInterval(() => {
        setIsLiveSyncing(true)
        fetchUserScores().finally(() => setTimeout(() => setIsLiveSyncing(false), 1000))
      }, 30_000)
      return () => clearInterval(interval)
    }
  }, [user])

  useEffect(() => {
    if (extensionUuid) {
      fetchConnectionHealth(extensionUuid)
    } else {
      setConnectionStatus({ state: 'missing', message: 'No device registered' })
    }
  }, [extensionUuid])

  const fetchUserData = async () => {
    try {
      const response = await fetch('/api/user/me', { credentials: 'include' })
      if (response.ok) {
        const userData = await response.json()
        setUser(userData.user)
      } else {
        setError('Please log in to view your dashboard')
      }
    } catch {
      setError('Failed to load user data')
    } finally {
      setLoading(false)
    }
  }

  const initializeExtensionConnection = () => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data.type === 'CRIBBLE_POINTS_EARNED') {
        addToast(event.data.points, event.data.domain)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }

  const checkActiveDevice = async () => {
    if (!user) return
    try {
      const response = await fetch('/api/extension/devices', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.devices) {
          const activeDevice = data.devices.find((d: any) => d.isActive)
          if (activeDevice) {
            setExtensionUuid(activeDevice.deviceUuid)
            setExtensionDetected(true)
          } else {
            setExtensionDetected(false)
          }
        } else {
          setExtensionDetected(false)
        }
      } else {
        setExtensionDetected(false)
      }
    } catch {
      setExtensionDetected(false)
    }
  }

  const fetchUserScores = async () => {
    if (!user) return
    try {
      const response = await fetch('/api/user/me', { credentials: 'include' })
      if (response.ok) {
        const result = await response.json()
        const scores = result.scores || {}
        const stats = result.stats || {}
        setExtensionStats((prev) => ({
          totalScore: scores.total_score || 0,
          todayScore: scores.today_score || 0,
          totalVisits: stats.total_visits || 0,
          todayVisits: stats.today_visits || 0,
          totalTime: stats.total_time || 0,
          todayTime: stats.today_time || 0,
          activeTime: stats.today_active_time || 0,
          efficiency: stats.efficiency || 0,
          streak: prev.streak || 0,
          rank: 'Active'
        }))
        if (result.activeDevice) {
          setExtensionUuid(result.activeDevice.device_uuid)
          setExtensionDetected(true)
        } else {
          setExtensionDetected(false)
        }
      } else {
        setExtensionDetected(false)
      }
    } catch {
      setExtensionDetected(false)
    }
  }

  const handleSetupComplete = (deviceUuid: string) => {
    setExtensionUuid(deviceUuid)
    setExtensionDetected(true)
    fetchUserScores()
  }

  const fetchConnectionHealth = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/device/verify?deviceUuid=${encodeURIComponent(deviceId)}`)
      if (res.ok) {
        const data = await res.json()
        setConnectionStatus({
          state: data.isActive ? 'connected' : 'inactive',
          deviceUuid: data.device?.uuid || deviceId,
          lastSync: data.device?.lastSync || null,
          message: data.message
        })
      } else {
        setConnectionStatus({ state: 'missing', deviceUuid: deviceId, message: 'Device not found' })
      }
    } catch {
      setConnectionStatus({ state: 'unknown', deviceUuid: deviceId, message: 'Network error' })
    }
  }

  const handleForceSync = async () => {
    if (!user || !extensionUuid) return
    setIsForcingSync(true)
    try {
      const payload = { deviceUuid: extensionUuid, events: [], batchId: crypto.randomUUID() }
      const res = await fetch('/api/extension/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        await fetchUserScores()
        await fetchConnectionHealth(extensionUuid)
      }
    } catch {
      console.error('Force sync error')
    } finally {
      setIsForcingSync(false)
    }
  }

  const handleDisconnect = () => {
    setExtensionUuid(null)
    setExtensionDetected(false)
    setConnectionStatus({ state: 'missing', message: 'Disconnected' })
  }

  const handleResetData = async () => {
    if (!enableReset) return
    if (resetConfirm !== 'RESET_ALL_DATA') return
    setIsResetting(true)
    try {
      const res = await fetch('/api/debug/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_all', confirmToken: 'RESET_ALL_DATA' })
      })
      if (res.ok) {
        setResetConfirm('')
        setShowDeleteConfirm(false)
        setExtensionDetected(false)
        setExtensionUuid(null)
        await fetchUserScores()
        setConnectionStatus({ state: 'unknown' })
      }
    } catch {
      console.error('Reset error')
    } finally {
      setIsResetting(false)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      window.location.href = '/'
    } catch {
      console.error('Logout failed')
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return
    setIsDeleting(true)
    try {
      const response = await fetch('/api/user/delete', { method: 'DELETE' })
      if (response.ok) window.location.href = '/'
    } catch {
      console.error('Delete account error')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
      setDeleteConfirmText('')
    }
  }

  useEffect(() => {
    if (user) checkActiveDevice()
  }, [user])

  useEffect(() => {
    if (user) fetchLeaderboardRank()
  }, [user, extensionStats.totalScore])

  useEffect(() => {
    if (user) fetchActivityData()
  }, [user, extensionStats.todayScore])

  const fetchLeaderboardRank = async () => {
    try {
      const res = await fetch('/api/leaderboard')
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.leaderboard) {
          const idx = data.leaderboard.findIndex((u: any) => u.id === user?.id)
          if (idx !== -1) setLeaderboardRank({ position: idx + 1, total: data.leaderboard.length })
        }
      }
    } catch { /* silent */ }
  }

  const fetchActivityData = async () => {
    try {
      const res = await fetch('/api/user/activity?days=84', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.activity) {
          setActivityData(data.activity)
          setExtensionStats((prev) => ({ ...prev, streak: calculateStreak(data.activity) }))
        }
      }
    } catch {
      setActivityData([])
    }
  }

  const addToast = (points: number, domain: string) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, points, domain }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }

  useEffect(() => {
    if (isForcingSync) {
      setIsLiveSyncing(true)
    } else {
      const t = setTimeout(() => setIsLiveSyncing(false), 1500)
      return () => clearTimeout(t)
    }
  }, [isForcingSync])

  const formatTime = (ms: number) => {
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    const rm = m % 60
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`
  }

  // GitHub-style calendar: 52 weeks × 7 days
  const buildCalendarGrid = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayDow = today.getDay()
    const endDate = new Date(today)
    endDate.setDate(today.getDate() + (6 - todayDow))
    const totalWeeks = 52
    const startDate = new Date(endDate)
    startDate.setDate(endDate.getDate() - totalWeeks * 7 + 1)
    const scoreMap: Record<string, number> = {}
    for (const d of activityData) scoreMap[d.date] = d.score
    const weeks: { date: string; score: number; isToday: boolean; isFuture: boolean }[][] = []
    let cursor = new Date(startDate)
    for (let w = 0; w < totalWeeks; w++) {
      const week: { date: string; score: number; isToday: boolean; isFuture: boolean }[] = []
      for (let d = 0; d < 7; d++) {
        const dateKey = cursor.toISOString().split('T')[0]
        week.push({
          date: dateKey,
          score: scoreMap[dateKey] || 0,
          isToday: dateKey === today.toISOString().split('T')[0],
          isFuture: cursor > today
        })
        cursor.setDate(cursor.getDate() + 1)
      }
      weeks.push(week)
    }
    const monthLabels: (string | null)[] = weeks.map((week) => {
      const firstDay = new Date(week[0].date + 'T00:00:00')
      return firstDay.getDate() <= 7 ? firstDay.toLocaleString('default', { month: 'short' }) : null
    })
    return { weeks, monthLabels }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="text-[#02fe01] text-sm tracking-[0.3em] animate-pulse">LOADING...</div>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4 font-mono">
        <div className="text-center border border-red-500/30 bg-red-500/5 p-8 rounded">
          <div className="text-red-400 text-sm tracking-widest mb-4">ACCESS DENIED</div>
          <p className="text-gray-500 text-xs mb-6">{error}</p>
          <a href="/" className="border border-red-500/40 text-red-400 px-6 py-2 rounded text-xs hover:bg-red-500/10 transition-all">
            RETURN HOME
          </a>
        </div>
      </div>
    )
  }

  const todayPct = Math.min(100, Math.max(0, Math.round((Math.max(0, extensionStats.todayScore) / 150000) * 100)))
  const connState = connectionStatus.state
  const { weeks: calendarWeeks, monthLabels } = buildCalendarGrid()

  const tierColors: Record<string, string> = {
    'PREMIUM+': 'text-yellow-300 border-yellow-500/40 bg-yellow-500/8',
    'PREMIUM':  'text-yellow-300 border-yellow-500/40 bg-yellow-500/8',
    'PRO':      'text-orange-300 border-orange-500/40 bg-orange-500/8',
    'BASIC':    'text-blue-300 border-blue-500/40 bg-blue-500/8',
    'FREE':     'text-gray-500 border-gray-700 bg-transparent',
  }
  const tierLabel = user.subscription_tier === 'PREMIUM' ? 'PREMIUM+' : (user.subscription_tier || 'FREE')
  const tierCls = tierColors[tierLabel] ?? tierColors['FREE']

  const connDot =
    connState === 'connected' ? 'bg-[#02fe01]' :
    connState === 'inactive'  ? 'bg-yellow-400' :
    'bg-red-500'

  return (
    <>
      <div
        className={`min-h-screen bg-black text-white font-mono relative transition-transform ${glitching ? 'translate-x-[1px]' : ''}`}
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(2,254,1,0.015) 0px, transparent 1px, transparent 5px)' }}
      >

        {/* ── Header ── */}
        <header className="border-b border-white/5 bg-black/95 px-6 py-3 sticky top-0 z-20">
          <div className="max-w-[1200px] mx-auto flex items-center justify-between">
            <span className="text-sm font-bold text-[#02fe01] tracking-[0.25em] cribble-title-glow">CRIBBLE.DEV</span>
            <div className="flex items-center gap-2">
              {isLiveSyncing && (
                <div className="flex items-center gap-1.5 text-[10px] text-[#02fe01]/50 mr-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#02fe01] animate-ping" />
                  LIVE
                </div>
              )}
              <button
                onClick={() => router.push('/leaderboard')}
                className="px-3 py-1.5 border border-white/10 text-gray-400 hover:text-white hover:border-white/25 rounded text-[10px] tracking-widest transition-all"
              >
                LEADERBOARD
              </button>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 border border-white/8 text-gray-600 hover:text-red-400 hover:border-red-500/30 rounded text-[10px] tracking-widest transition-all"
              >
                EXIT
              </button>
            </div>
          </div>
        </header>

        {/* ── Main ── */}
        <main className="max-w-[1400px] mx-auto px-8 py-8 space-y-5">

          {/* ── MAIN GRID: player | content | connection, side cols span 2 rows ── */}
          <div className="hidden md:grid gap-5" style={{ gridTemplateColumns: '300px 1fr 260px', gridTemplateRows: 'auto auto' }}>

            {/* ─ Col 1: Player Card — spans both rows ─ */}
            <div className="db-panel flex flex-col gap-0" style={{ padding: 0, overflow: 'hidden', gridColumn: '1', gridRow: '1 / 3' }}>
              {/* Avatar section */}
              <div className="flex flex-col items-center text-center px-6 pt-8 pb-6 border-b border-white/5">
                <div className="relative mb-4">
                  <img
                    src={
                      user.twitter_profile_image
                        ? user.twitter_profile_image.replace('_normal', '_400x400')
                        : `https://unavatar.io/twitter/${user.twitter_username}`
                    }
                    alt={user.twitter_name}
                    width={96}
                    height={96}
                    className="w-24 h-24 rounded-full object-cover border-2 border-white/15"
                    onError={(e) => {
                      const t = e.target as HTMLImageElement
                      t.src = `https://unavatar.io/twitter/${user.twitter_username}`
                    }}
                  />
                  <div className={`absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full border-2 border-black ${connDot}`} />
                </div>
                <div className="text-base font-bold text-white leading-tight">@{user.twitter_username}</div>
                <div className="text-sm text-gray-500 mt-1 mb-3">{user.twitter_name}</div>
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded border ${tierCls}`}>{tierLabel}</span>
                  {leaderboardRank && (
                    <span className="text-xs text-gray-500 border border-white/10 px-2.5 py-1 rounded">
                      #{leaderboardRank.position} global
                    </span>
                  )}
                </div>
              </div>

              {/* Streak + Rank */}
              <div className="grid grid-cols-2 divide-x divide-white/5 border-b border-white/5">
                <div className="px-5 py-4 text-center">
                  <div className="text-[10px] text-gray-600 tracking-widest mb-2">STREAK</div>
                  <div className="text-3xl font-bold text-[#02fe01] cribble-score-glow tabular-nums leading-none">
                    {extensionStats.streak}
                  </div>
                  <div className="text-xs text-gray-700 mt-1">days</div>
                </div>
                <div className="px-5 py-4 text-center">
                  <div className="text-[10px] text-gray-600 tracking-widest mb-2">RANK</div>
                  <div className="text-3xl font-bold text-white tabular-nums leading-none">
                    {leaderboardRank ? `#${leaderboardRank.position}` : '—'}
                  </div>
                  <div className="text-xs text-gray-700 mt-1">global</div>
                </div>
              </div>

              {/* Nav buttons */}
              <div className="px-5 py-4 flex flex-col gap-2">
                <button
                  onClick={() => router.push('/leaderboard')}
                  className="w-full py-2.5 text-xs tracking-widest border border-white/10 text-gray-400 hover:text-[#02fe01] hover:border-[#02fe01]/30 rounded transition-all"
                >
                  LEADERBOARD
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="w-full py-2.5 text-xs tracking-widest border border-white/10 text-gray-400 hover:text-white hover:border-white/25 rounded transition-all"
                >
                  SETTINGS
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full py-2.5 text-xs tracking-widest border border-white/5 text-gray-600 hover:text-red-400 hover:border-red-500/25 rounded transition-all"
                >
                  SIGN OUT
                </button>
              </div>
            </div>

            {/* ─ Col 2 Row 1: Score + Stats ─ */}
            <div className="flex flex-col gap-5" style={{ gridColumn: '2', gridRow: '1' }}>

              {/* Score panel */}
              <div className="db-panel flex gap-8 items-stretch" style={{ padding: '24px 28px' }}>
                {/* Total score */}
                <div className="flex flex-col justify-center min-w-0">
                  <div className="text-xs text-gray-500 tracking-widest mb-2">TOTAL SCORE</div>
                  <div className="text-5xl font-bold text-[#02fe01] cribble-score-glow tabular-nums leading-none">
                    <AnimatedCounter
                      value={extensionStats.totalScore}
                      formatter={(v: number) => Math.round(v).toLocaleString()}
                      duration={1200}
                    />
                  </div>
                  <div className="text-xs text-gray-600 mt-2">AI INTERACTION PTS</div>
                </div>

                <div className="w-px bg-white/5 flex-shrink-0" />

                {/* Today */}
                <div className="flex flex-col justify-center flex-1 min-w-0">
                  <div className="flex items-baseline justify-between mb-3">
                    <div>
                      <div className="text-xs text-gray-500 tracking-widest mb-2">TODAY</div>
                      <div className="text-4xl font-bold text-white tabular-nums leading-none">
                        <AnimatedCounter
                          value={Math.max(0, extensionStats.todayScore)}
                          formatter={(v: number) => Math.round(v).toLocaleString()}
                          duration={1000}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-600">/ 150,000</div>
                      <div className="text-lg font-bold text-[#02fe01]">{todayPct}%</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="flex gap-0.5">
                    {Array.from({ length: 30 }).map((_, i) => {
                      const filled = i < Math.round(30 * (todayPct / 100))
                      return (
                        <div
                          key={i}
                          className="flex-1 h-1.5 rounded-sm"
                          style={{
                            background: filled ? '#02fe01' : 'rgba(255,255,255,0.05)',
                            boxShadow: filled ? '0 0 4px rgba(2,254,1,0.35)' : 'none'
                          }}
                        />
                      )
                    })}
                  </div>
                  <div className="flex justify-between mt-1.5 text-[10px] text-gray-700">
                    <span>0</span><span>75k</span><span>150k</span>
                  </div>
                </div>
              </div>

              {/* 4 stat cards */}
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'VISITS TODAY', value: extensionStats.todayVisits, color: '#a78bfa', display: null as string | null },
                  { label: 'ACTIVE TIME',  value: null, color: '#fbbf24', display: formatTime(extensionStats.activeTime) },
                  { label: 'EFFICIENCY',   value: extensionStats.efficiency, color: '#f472b6', display: null, fmt: (v: number) => `${Math.round(v)}%` },
                  { label: 'TOTAL TIME',   value: null, color: '#02fe01', display: formatTime(extensionStats.totalTime) },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-lg"
                    style={{ background: '#080808', border: '1px solid rgba(255,255,255,0.07)', padding: '18px 20px' }}
                  >
                    <div className="text-[10px] tracking-widest mb-2" style={{ color: `${s.color}70` }}>{s.label}</div>
                    <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: s.color }}>
                      {s.display !== null
                        ? s.display
                        : s.value !== null && s.value !== undefined
                          ? (s.fmt ? s.fmt(s.value) : (
                            <AnimatedCounter value={s.value} duration={800} />
                          ))
                          : '—'
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ─ Col 3: Connection — spans both rows ─ */}
            <div className="db-panel flex flex-col" style={{ padding: '20px', gridColumn: '3', gridRow: '1 / 3' }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-gray-500 tracking-widest">EXTENSION</span>
                <span
                  className="text-[10px] font-bold px-2.5 py-1 rounded border"
                  style={
                    connState === 'connected'
                      ? { color: '#02fe01', borderColor: 'rgba(2,254,1,0.3)', background: 'rgba(2,254,1,0.06)' }
                      : connState === 'inactive'
                      ? { color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.06)' }
                      : connState === 'missing'
                      ? { color: '#f87171', borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.06)' }
                      : { color: '#6b7280', borderColor: 'rgba(107,114,128,0.3)', background: 'transparent' }
                  }
                >
                  {connState === 'connected' ? 'ONLINE' : connState === 'inactive' ? 'IDLE' : connState === 'missing' ? 'OFFLINE' : '...'}
                </span>
              </div>

              {/* Radar */}
              <div className="flex-1 flex items-center justify-center py-2">
                <RadarDisplay status={connState} />
              </div>

              {/* Device info */}
              {(connState === 'connected' || connState === 'inactive') && (
                <div className="text-xs text-gray-600 space-y-2 mb-4">
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-500">Device</span>
                    <span className="font-mono text-gray-400 truncate">{connectionStatus.deviceUuid?.slice(0, 10) ?? '—'}…</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-500">Last sync</span>
                    <span className="text-gray-400">{connectionStatus.lastSync ? new Date(connectionStatus.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  </div>
                </div>
              )}

              {(connState === 'missing' || connState === 'unknown') && (
                <div className="text-xs text-gray-600 text-center mb-4">No extension connected</div>
              )}

              {/* Buttons */}
              <div className="flex flex-col gap-2">
                {(connState === 'missing' || connState === 'unknown') ? (
                  <button
                    onClick={() => setShowSetupWizard(true)}
                    className="w-full py-2.5 bg-[#02fe01] hover:bg-[#02fe01]/90 text-black rounded text-xs font-bold tracking-widest transition-all active:scale-[0.97]"
                  >
                    SETUP
                  </button>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <button
                        onClick={handleForceSync}
                        disabled={!extensionUuid || isForcingSync}
                        className="flex-1 py-2.5 border border-white/10 text-gray-400 hover:text-[#02fe01] hover:border-[#02fe01]/30 rounded text-xs tracking-widest disabled:opacity-40 transition-all"
                      >
                        {isForcingSync ? '…' : 'SYNC'}
                      </button>
                      <button
                        onClick={async () => {
                          if (!extensionUuid) return
                          await fetchUserScores()
                          await fetchConnectionHealth(extensionUuid)
                        }}
                        disabled={!extensionUuid}
                        className="px-3 py-2.5 border border-white/10 text-gray-500 hover:text-gray-200 hover:border-white/25 rounded text-sm disabled:opacity-40 transition-all"
                        title="Refresh"
                      >
                        ↻
                      </button>
                    </div>
                    <button
                      onClick={handleDisconnect}
                      className="w-full py-2.5 border border-white/5 text-gray-600 hover:text-red-400 hover:border-red-500/20 rounded text-xs tracking-widest transition-all"
                    >
                      DISCONNECT
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* ─ Col 2 Row 2: Activity Grid ─ */}
            <div
              style={{
                gridColumn: '2',
                gridRow: '2',
                background: '#080808',
                border: '1px solid rgba(255,140,0,0.2)',
                borderRadius: 8,
                padding: '20px 24px',
                position: 'relative',
                minWidth: 0,
              }}
            >
              {/* top accent line */}
              <div style={{
                position: 'absolute', top: 0, left: '10%', right: '10%', height: '1px',
                background: 'linear-gradient(90deg, transparent, rgba(255,140,0,0.5), transparent)',
              }} />

              <div className="flex items-center justify-between mb-4">
                <span className="text-xs tracking-widest font-medium" style={{ color: 'rgba(255,140,0,0.6)' }}>
                  ACTIVITY — {new Date().getFullYear()}
                </span>
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'rgba(255,140,0,0.4)' }}>
                  <span>LESS</span>
                  {['rgba(255,120,0,0.10)', 'rgba(255,120,0,0.28)', 'rgba(255,130,0,0.50)', 'rgba(255,140,0,0.75)', '#ff8c00'].map((bg, i) => (
                    <div key={i} style={{ width: 11, height: 11, borderRadius: 3, background: bg, flexShrink: 0 }} />
                  ))}
                  <span>MORE</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <div style={{ display: 'inline-flex', flexDirection: 'column' }}>
                  {/* Month labels */}
                  <div style={{ display: 'flex', paddingLeft: 32 }}>
                    {calendarWeeks.map((_, wi) => (
                      <div key={wi} style={{ width: 16, flexShrink: 0, overflow: 'visible', whiteSpace: 'nowrap', fontSize: 10, color: 'rgba(255,140,0,0.35)' }}>
                        {monthLabels[wi] ?? ''}
                      </div>
                    ))}
                  </div>
                  {/* Grid */}
                  <div style={{ display: 'flex', marginTop: 4 }}>
                    {/* Day labels */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 28, marginRight: 4, flexShrink: 0 }}>
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
                        <div key={d} style={{ height: 14, fontSize: 10, lineHeight: '14px', color: 'rgba(255,140,0,0.28)', textAlign: 'right', visibility: i % 2 === 0 ? 'hidden' : 'visible' }}>
                          {d}
                        </div>
                      ))}
                    </div>
                    {/* Weeks */}
                    <div style={{ display: 'flex', gap: 3 }}>
                      {calendarWeeks.map((week, wi) => (
                        <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {week.map((day) => {
                            const { score, isToday, isFuture, date } = day
                            let bg = 'rgba(255,255,255,0.04)'
                            let glow = 'none'
                            if (!isFuture) {
                              if (score > 30000) { bg = '#ff8c00'; glow = '0 0 6px rgba(255,140,0,0.6)' }
                              else if (score > 15000) bg = 'rgba(255,140,0,0.75)'
                              else if (score > 5000)  bg = 'rgba(255,130,0,0.50)'
                              else if (score > 0)     bg = 'rgba(255,120,0,0.28)'
                            }
                            return (
                              <div
                                key={date}
                                title={isFuture ? '' : `${date}: ${score.toLocaleString()} pts`}
                                style={{
                                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                                  background: bg,
                                  boxShadow: glow,
                                  opacity: isFuture ? 0.2 : 1,
                                  outline: isToday ? '2px solid rgba(255,200,0,0.75)' : 'none',
                                  outlineOffset: isToday ? 1 : 0,
                                  cursor: 'default',
                                }}
                              />
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,140,0,0.08)' }}>
                <span className="text-[10px]" style={{ color: 'rgba(255,140,0,0.25)' }}>
                  {calendarWeeks[0]?.[0]?.date
                    ? new Date(calendarWeeks[0][0].date + 'T00:00:00').toLocaleString('default', { month: 'short', year: 'numeric' })
                    : ''} — {new Date().toLocaleString('default', { month: 'short', year: 'numeric' })}
                </span>
                <span className="text-[10px]" style={{ color: 'rgba(255,140,0,0.4)' }}>
                  {activityData.filter(d => d.score > 0).length} active days
                </span>
              </div>
            </div>

          </div>

          {/* ── Mobile fallback ── */}
          <div className="flex flex-col gap-3 md:hidden">
            <div className="db-panel flex items-center gap-4">
              <img
                src={user.twitter_profile_image || `https://unavatar.io/twitter/${user.twitter_username}`}
                alt={user.twitter_name}
                width={56}
                height={56}
                className="w-14 h-14 rounded-full object-cover border border-white/15 flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).src = `https://unavatar.io/twitter/${user.twitter_username}` }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">@{user.twitter_username}</div>
                <div className="text-[10px] text-gray-500">{user.twitter_name}</div>
                <div className="flex gap-1.5 mt-1.5">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${tierCls}`}>{tierLabel}</span>
                  <span className="text-[9px] text-[#02fe01] border border-[#02fe01]/20 px-1.5 py-0.5 rounded">{extensionStats.streak}d streak</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={handleLogout} className="px-3 py-1.5 border border-white/8 text-gray-600 rounded text-[9px]">EXIT</button>
              </div>
            </div>
            <div className="db-panel">
              <div className="text-[9px] text-gray-600 tracking-widest mb-1">TOTAL SCORE</div>
              <div className="text-3xl font-bold text-[#02fe01] cribble-score-glow tabular-nums">
                <AnimatedCounter value={extensionStats.totalScore} formatter={(v) => Math.round(v).toLocaleString()} duration={1200} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'VISITS', val: extensionStats.todayVisits, color: '#a78bfa' },
                { label: 'ACTIVE', val: null, display: formatTime(extensionStats.activeTime), color: '#fbbf24' },
                { label: 'EFFICIENCY', val: extensionStats.efficiency, color: '#f472b6', fmt: (v: number) => `${Math.round(v)}%` },
                { label: 'TOTAL TIME', val: null, display: formatTime(extensionStats.totalTime), color: '#02fe01' },
              ].map((s) => (
                <div key={s.label} className="db-panel-sm">
                  <div className="text-[9px] tracking-widest mb-1" style={{ color: `${s.color}80` }}>{s.label}</div>
                  <div className="text-base font-bold" style={{ color: s.color }}>
                    {'display' in s && s.display !== undefined ? s.display : (s.fmt && s.val !== null ? s.fmt(s.val as number) : String(s.val ?? 0))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile activity + connection fallback */}
          <div className="flex flex-col gap-3 md:hidden">
            <div className="db-panel flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-gray-600 tracking-widest">EXTENSION</span>
                <span className="text-[9px] font-bold" style={{ color: connState === 'connected' ? '#02fe01' : connState === 'inactive' ? '#fbbf24' : '#f87171' }}>
                  {connState === 'connected' ? '● ONLINE' : connState === 'inactive' ? '● IDLE' : '● OFFLINE'}
                </span>
              </div>
              {(connState === 'missing' || connState === 'unknown') ? (
                <button onClick={() => setShowSetupWizard(true)} className="w-full py-2 bg-[#02fe01] text-black rounded text-[10px] font-bold tracking-widest">SETUP EXTENSION</button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={handleForceSync} disabled={isForcingSync} className="flex-1 py-2 border border-white/8 text-gray-500 hover:text-[#02fe01] rounded text-[10px] tracking-widest disabled:opacity-40 transition-all">
                    {isForcingSync ? '…' : 'SYNC'}
                  </button>
                  <button onClick={handleDisconnect} className="flex-1 py-2 border border-white/5 text-gray-700 hover:text-red-400 rounded text-[10px] tracking-widest transition-all">DISCONNECT</button>
                </div>
              )}
            </div>
          </div>

        </main>
      </div>

      {/* ── Setup Wizard ── */}
      <SetupWizardModal
        isOpen={showSetupWizard}
        onClose={() => setShowSetupWizard(false)}
        userId={user.id}
        onSetupComplete={handleSetupComplete}
      />

      {/* ── Settings Modal ── */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div
            className="w-full max-w-sm bg-[#080808] border border-white/10 rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div>
                <div className="text-xs font-bold text-white tracking-widest">SETTINGS</div>
                <div className="text-[10px] text-gray-600 mt-0.5">@{user.twitter_username}</div>
              </div>
              <button onClick={() => setShowSettings(false)} className="text-gray-600 hover:text-white text-lg leading-none">×</button>
            </div>
            <div className="p-5 space-y-4">
              {/* Account info */}
              <div>
                <div className="text-[9px] text-gray-600 tracking-widest mb-2">ACCOUNT</div>
                <div className="space-y-1.5 text-[10px] text-gray-500">
                  <div className="flex justify-between">
                    <span>Username</span>
                    <span className="text-gray-300">@{user.twitter_username}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Plan</span>
                    <span className={`font-bold ${tierCls.split(' ')[0]}`}>{tierLabel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Member since</span>
                    <span className="text-gray-400">{new Date(user.created_at).toLocaleDateString('default', { month: 'short', year: 'numeric' })}</span>
                  </div>
                </div>
              </div>

              {/* Extension */}
              <div>
                <div className="text-[9px] text-gray-600 tracking-widest mb-2">EXTENSION</div>
                <div className="space-y-1.5 text-[10px] text-gray-500">
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span style={{ color: connState === 'connected' ? '#02fe01' : connState === 'inactive' ? '#fbbf24' : '#f87171' }}>
                      {connState === 'connected' ? 'Connected' : connState === 'inactive' ? 'Idle' : 'Not connected'}
                    </span>
                  </div>
                  {connectionStatus.deviceUuid && (
                    <div className="flex justify-between">
                      <span>Device ID</span>
                      <span className="text-gray-400 font-mono">{connectionStatus.deviceUuid.slice(0, 12)}…</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={() => { setShowSettings(false); setShowSetupWizard(true) }}
                  className="w-full py-2 border border-[#02fe01]/25 text-[#02fe01]/70 hover:text-[#02fe01] hover:border-[#02fe01]/50 rounded text-[10px] tracking-widest transition-all"
                >
                  RECONFIGURE EXTENSION
                </button>
                {enableReset && (
                  <button
                    onClick={() => { setShowSettings(false); setShowDeleteConfirm(true) }}
                    className="w-full py-2 border border-red-900/30 text-red-500/50 hover:text-red-400 hover:border-red-500/30 rounded text-[10px] tracking-widest transition-all"
                  >
                    RESET ALL DATA
                  </button>
                )}
                <button
                  onClick={() => { setShowSettings(false); setShowDeleteConfirm(true) }}
                  className="w-full py-2 border border-white/5 text-gray-700 hover:text-red-400 hover:border-red-500/20 rounded text-[10px] tracking-widest transition-all"
                >
                  DELETE ACCOUNT
                </button>
                <button
                  onClick={() => { setShowSettings(false); handleLogout() }}
                  className="w-full py-2 border border-white/5 text-gray-700 hover:text-red-400 hover:border-red-500/20 rounded text-[10px] tracking-widest transition-all"
                >
                  SIGN OUT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset/Delete Modal ── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#080808] border border-red-500/25 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-red-500/15">
              <div className="text-red-400 text-xs font-bold tracking-widest">DANGER ZONE</div>
              <p className="text-gray-600 text-[10px] mt-0.5">This action cannot be undone</p>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-gray-400 text-xs">Permanently deletes all devices, sessions, events, and scores.</p>
              <div>
                <p className="text-[10px] text-gray-600 mb-2">Type <span className="text-red-400">RESET_ALL_DATA</span> to confirm:</p>
                <input
                  type="text"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  placeholder="RESET_ALL_DATA"
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-xs text-white focus:border-red-500/40 focus:outline-none font-mono"
                  disabled={isResetting}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowDeleteConfirm(false); setResetConfirm('') }}
                  disabled={isResetting}
                  className="flex-1 border border-white/8 text-gray-500 py-2 rounded text-xs hover:bg-white/5 transition-all disabled:opacity-50"
                >CANCEL</button>
                <button
                  onClick={handleResetData}
                  disabled={resetConfirm !== 'RESET_ALL_DATA' || isResetting}
                  className="flex-1 bg-red-600/80 text-white py-2 rounded text-xs hover:bg-red-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >{isResetting ? 'RESETTING…' : 'RESET'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ── */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div key={toast.id} className="bg-[#080808] border border-white/10 rounded px-4 py-2.5 shadow-lg toast-slide-in">
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#02fe01] flex-shrink-0" />
              <div>
                <div className="text-[#02fe01] text-xs font-bold">{toast.points > 0 ? `+${toast.points.toLocaleString()} pts` : toast.domain}</div>
                {toast.points > 0 && <div className="text-gray-600 text-[9px]">{toast.domain}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {process.env.NODE_ENV === 'development' && (
        <button
          onClick={() => addToast(Math.floor(Math.random() * 500) + 100, ['ChatGPT', 'Claude', 'Gemini'][Math.floor(Math.random() * 3)])}
          className="fixed bottom-4 left-4 z-50 px-3 py-1.5 bg-[#080808] border border-white/8 rounded text-[9px] text-gray-600 hover:text-gray-400 font-mono"
        >
          + toast
        </button>
      )}
    </>
  )
}
