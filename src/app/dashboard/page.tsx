'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SetupWizardModal from '@/components/SetupWizardModal'
import AnimatedCounter from '@/components/AnimatedCounter'
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
  const [showDeviceSessions, setShowDeviceSessions] = useState(false)
  const [pointsNotification, setPointsNotification] = useState<{
    points: number
    domain: string
    isVisible: boolean
  } | null>(null)
  const [extensionStats, setExtensionStats] = useState({
    totalScore: 0,
    todayScore: 0,
    totalVisits: 0,
    todayVisits: 0,
    totalTime: 0,
    todayTime: 0,
    activeTime: 0,
    efficiency: 0,
    streak: 1,
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
  
  // New features state
  const [leaderboardRank, setLeaderboardRank] = useState<{ position: number; total: number } | null>(null)
  const [activityData, setActivityData] = useState<{ date: string; score: number }[]>([])
  const [toasts, setToasts] = useState<{ id: string; points: number; domain: string }[]>([])
  const [isLiveSyncing, setIsLiveSyncing] = useState(false)

  useEffect(() => {
    fetchUserData()
    initializeExtensionConnection()
  }, [])

  // Poll user scores every 30s when user is loaded
  useEffect(() => {
    if (user) {
      // Initial fetch
      fetchUserScores()

      // Set up polling every 30 seconds for responsive updates
      const interval = setInterval(() => {
        console.log('[Dashboard] Auto-refresh triggered')
        setIsLiveSyncing(true) // Show sync indicator
        fetchUserScores().finally(() => {
          setTimeout(() => setIsLiveSyncing(false), 1000) // Hide after 1s
        })
      }, 30_000)
      return () => clearInterval(interval)
    }
  }, [user])

  // Fetch connection health when extensionUuid is available
  useEffect(() => {
    if (extensionUuid) {
      console.log('[Dashboard] Extension UUID detected, fetching connection health:', extensionUuid)
      fetchConnectionHealth(extensionUuid)
    } else {
      // No extension UUID means not connected
      setConnectionStatus({ state: 'missing', message: 'No device registered' })
    }
  }, [extensionUuid])

  const fetchUserData = async () => {
    try {
      const response = await fetch('/api/user/me', {
        credentials: 'include' // This ensures cookies are sent automatically
      })

      if (response.ok) {
        const userData = await response.json()
        setUser(userData.user)
      } else {
        const errorData = await response.json().catch(() => ({}))
        console.error('Auth error:', errorData)
        setError('Please log in to view your dashboard')
      }
    } catch (err) {
      console.error('Network error:', err)
      setError('Failed to load user data')
    } finally {
      setLoading(false)
    }
  }

  const initializeExtensionConnection = () => {
    console.log('[Dashboard] Initializing extension connection...')
    
    // Listen for extension messages (for points notifications only)
    const handleExtensionMessage = (event: MessageEvent) => {
      console.log('[Dashboard] Received message:', event.data)
      if (event.origin !== window.location.origin) return;
      
      if (event.data.type === 'CRIBBLE_POINTS_EARNED') {
        // Show points notification
        setPointsNotification({
          points: event.data.points,
          domain: event.data.domain,
          isVisible: true
        })
      }
    }

    window.addEventListener('message', handleExtensionMessage)
    
    // Cleanup listener on unmount
    return () => {
      window.removeEventListener('message', handleExtensionMessage)
    }
  }

  const checkActiveDevice = async () => {
    if (!user) {
      console.log('[Dashboard] checkActiveDevice: No user, returning early')
      return
    }
    
    console.log('[Dashboard] checkActiveDevice: Checking for user ID:', user.id)
    
    try {
      const response = await fetch('/api/extension/devices', {
        headers: {
          'X-User-ID': user.id.toString()
        }
      })
      
      console.log('[Dashboard] checkActiveDevice: Response status:', response.status)
      
      if (response.ok) {
        const data = await response.json()
        console.log('[Dashboard] checkActiveDevice: Response data:', data)
        
        if (data.success && data.devices) {
          const activeDevice = data.devices.find((d: any) => d.isActive)
          
          if (activeDevice) {
            console.log('[Dashboard] checkActiveDevice: Found active device:', activeDevice.deviceUuid)
            setExtensionUuid(activeDevice.deviceUuid)
            setExtensionDetected(true)
            // Device is active, stats will be fetched via fetchUserScores
          } else {
            console.log('[Dashboard] checkActiveDevice: No active device found')
            console.log('[Dashboard] checkActiveDevice: Available devices:', data.devices.length)
            setExtensionDetected(false)
          }
        } else {
          console.error('[Dashboard] checkActiveDevice: API returned error:', data.error)
          setExtensionDetected(false)
        }
      } else {
        const errorText = await response.text()
        console.error('[Dashboard] checkActiveDevice: Request failed:', response.status, errorText)
        setExtensionDetected(false)
      }
    } catch (error) {
      console.error('[Dashboard] Error checking active device:', error)
      setExtensionDetected(false)
    }
  }

  const fetchUserScores = async () => {
    if (!user) {
      console.log('[Dashboard] fetchUserScores: No user')
      return
    }

    console.log('[Dashboard] fetchUserScores: Fetching scores for user:', user.id)

    try {
      const response = await fetch('/api/user/me', {
        credentials: 'include'
      })
      console.log('[Dashboard] fetchUserScores: Response status:', response.status)

      if (response.ok) {
        const result = await response.json()
        console.log('[Dashboard] fetchUserScores: Response data:', result)

        // API returns { user, scores, stats, activeDevice }
        const scores = result.scores || {}
        const stats = result.stats || {}
        
        // Map the API response to extensionStats format
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
        console.log('[Dashboard] fetchUserScores: Updated -', { 
          scores: { total: scores.total_score, today: scores.today_score },
          stats: { visits: stats.total_visits, activeTime: stats.today_active_time }
        })

        // Check if user has an active device (separate from scores)
        if (result.activeDevice) {
          setExtensionUuid(result.activeDevice.device_uuid)
          setExtensionDetected(true)
          console.log('[Dashboard] Active device found:', result.activeDevice.device_uuid)
        } else {
          console.log('[Dashboard] No active device found')
          setExtensionDetected(false)
        }
      } else {
        const errorText = await response.text()
        console.error('[Dashboard] User scores request failed:', response.status, errorText)
        setExtensionDetected(false)
      }
    } catch (error) {
      console.error('[Dashboard] User scores network error:', error)
      setExtensionDetected(false)
    }
  }

  const handleSetupComplete = (deviceUuid: string) => {
    console.log('[Dashboard] Setup completed for device:', deviceUuid)
    setExtensionUuid(deviceUuid)
    setExtensionDetected(true)
    // Refresh user scores after setup
    fetchUserScores()
  }

  const handleHidePointsNotification = () => {
    setPointsNotification(prev => prev ? { ...prev, isVisible: false } : null)
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
    } catch (err) {
      console.error('Connection health error:', err)
      setConnectionStatus({ state: 'unknown', deviceUuid: deviceId, message: 'Network error' })
    }
  }

  const handleForceSync = async () => {
    if (!user || !extensionUuid) return
    setIsForcingSync(true)
    try {
      const payload = {
        deviceUuid: extensionUuid,
        userId: user.id,
        events: [],
        batchId: crypto.randomUUID()
      }
      const res = await fetch('/api/extension/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        await fetchUserScores()
        await fetchConnectionHealth(extensionUuid)
      }
    } catch (err) {
      console.error('Force sync error:', err)
    } finally {
      setIsForcingSync(false)
    }
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
        setShowDeleteConfirm(false) // Close the modal
        setExtensionDetected(false)
        setExtensionUuid(null)
        await fetchUserScores()
        setConnectionStatus({ state: 'unknown' })
        // Show success toast
        addToast(0, 'Data reset successfully')
      }
    } catch (err) {
      console.error('Reset data error:', err)
    } finally {
      setIsResetting(false)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      window.location.href = '/'
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      return
    }
    
    setIsDeleting(true)
    try {
      const response = await fetch('/api/user/delete', { method: 'DELETE' })
      
      if (response.ok) {
        alert('Account deleted successfully. You will be redirected to the homepage.')
        window.location.href = '/'
      } else {
        const data = await response.json()
        alert(`Failed to delete account: ${data.error}`)
      }
    } catch (error) {
      console.error('Delete account error:', error)
      alert('Network error. Please try again.')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
      setDeleteConfirmText('')
    }
  }

  // Check for active device when user data loads
  useEffect(() => {
    if (user) {
      console.log('[Dashboard] User loaded, checking for active device...')
      checkActiveDevice()
    }
  }, [user])

  // Fetch connection health when device UUID updates
  // Fetch leaderboard rank
  useEffect(() => {
    if (user) {
      fetchLeaderboardRank()
    }
  }, [user, extensionStats.totalScore])

  // Fetch real activity data (last 12 weeks like GitHub)
  useEffect(() => {
    if (user) {
      fetchActivityData()
    }
  }, [user, extensionStats.todayScore])

  const fetchLeaderboardRank = async () => {
    try {
      const res = await fetch('/api/leaderboard')
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.leaderboard) {
          const userIndex = data.leaderboard.findIndex((u: any) => u.id === user?.id)
          if (userIndex !== -1) {
            setLeaderboardRank({ position: userIndex + 1, total: data.leaderboard.length })
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard rank:', err)
    }
  }

  const fetchActivityData = async () => {
    try {
      const res = await fetch('/api/user/activity?days=84', {
        credentials: 'include'
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.activity) {
          const activity = data.activity
          setActivityData(activity)
          setExtensionStats((prev) => ({
            ...prev,
            streak: calculateStreak(activity)
          }))
          console.log('[Dashboard] Activity data loaded:', data.stats)
        }
      }
    } catch (err) {
      console.error('[Dashboard] Failed to fetch activity data:', err)
      // Fall back to empty data on error
      setActivityData([])
    }
  }

  const addToast = (points: number, domain: string) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, points, domain }])
    // Auto-remove after 3 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }

  // Simulate live sync indicator during force sync
  useEffect(() => {
    if (isForcingSync) {
      setIsLiveSyncing(true)
    } else {
      // Keep it on for a bit after sync completes
      const timeout = setTimeout(() => setIsLiveSyncing(false), 1500)
      return () => clearTimeout(timeout)
    }
  }, [isForcingSync])

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="text-green-400 text-xl glitch-text animate-pulse">LOADING...</div>
        <style jsx>{`
          .glitch-text {
            text-shadow: 0.05em 0 0 #f0f, -0.05em -0.025em 0 #0ff;
            animation: glitch 0.5s infinite;
          }
          @keyframes glitch {
            0%, 100% { text-shadow: 0.05em 0 0 #f0f, -0.05em -0.025em 0 #0ff; }
            50% { text-shadow: 0.075em 0 0 #f0f, -0.075em -0.025em 0 #0ff; }
          }
        `}</style>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4 font-mono">
        <div className="text-center border border-red-500/50 bg-red-500/10 p-8 rounded animate-fade-in">
          <h1 className="text-xl text-red-400 mb-4">ACCESS DENIED</h1>
          <p className="text-gray-400 mb-6">{error}</p>
          <a 
            href="/"
            className="bg-red-500/20 text-red-400 px-6 py-2 rounded border border-red-500/50 hover:bg-red-500/30 transition-colors"
          >
            RETURN TO HOME
          </a>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="min-h-screen bg-black text-white relative overflow-hidden font-mono">
      {/* Enhanced CRT Scanlines with Glow */}
      <div className="absolute inset-0 pointer-events-none opacity-40 sm:opacity-60">
        <div className="h-full w-full" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,255,255,0.15) 0px, transparent 1px, transparent 3px)',
        }}></div>
      </div>
      
      {/* Additional scanline texture for depth */}
      <div className="absolute inset-0 pointer-events-none opacity-10 sm:opacity-20">
        <div className="h-full w-full" style={{
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0px, transparent 1px, transparent 4px)',
        }}></div>
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-[#02fe01]/30 bg-black/90 px-3 sm:px-4 py-2 sm:py-3 animate-slide-down">
        <div className="max-w-6xl mx-auto">
          {/* Mobile Layout */}
          <div className="sm:hidden flex items-center justify-between">
            <h1 className="text-base font-bold text-[#02fe01] tracking-widest glitch-text">CRIBBLE.DEV</h1>
            <div className="flex items-center gap-2">
              <img 
                src={user.twitter_profile_image || `https://unavatar.io/twitter/${user.twitter_username}?size=64`} 
                alt={user.twitter_name}
                className="w-5 h-5 rounded-full"
              />
              <span className="text-[#02fe01] text-xs font-bold">@{user.twitter_username}</span>
              <button
                onClick={handleLogout}
                className="px-2 py-1 text-[10px] bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30 transition-all rounded"
              >
                EXIT
              </button>
            </div>
          </div>

          {/* Desktop Layout */}
          <div className="hidden sm:flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl lg:text-2xl font-bold text-[#02fe01] tracking-widest glitch-text">CRIBBLE.DEV</h1>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 bg-gray-900/50 px-3 py-2 rounded border border-[#02fe01]/30">
                <img 
                  src={user.twitter_profile_image || `https://unavatar.io/twitter/${user.twitter_username}?size=64`} 
                  alt={user.twitter_name}
                  className="w-6 h-6 rounded-full"
                />
                <div className="text-xs flex items-center gap-2">
                  <div className="text-[#02fe01]">@{user.twitter_username}</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push('/leaderboard')}
                      className="px-3 py-1 rounded-md border border-[#02fe01]/60 text-[#02fe01] hover:bg-[#02fe01]/10"
                    >
                      LEADERBOARD
                    </button>
                    <button
                      onClick={handleLogout}
                      className="px-3 py-1 rounded-md border border-red-400/60 text-red-400 hover:bg-red-500/10"
                    >
                      EXIT
                    </button>
                  </div>
                </div>
              </div>
              {/* Removed external EXIT and delete; keep controls inside the pill */}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Centered Dashboard Layout */}
      <main className="relative z-10 flex items-center justify-center min-h-[calc(100vh-60px)] px-4 sm:px-6 py-6">
        <div className="w-full max-w-5xl">
          
          {/* Top Row: Player Card + Total Score */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-4">
            {/* Player Card - Left */}
            <div className="md:col-span-5 relative animate-slide-in-left" style={{ animationDelay: '0.1s' }}>
              <div className={`absolute -inset-0.5 rounded-lg blur-sm ${
                (user.subscription_tier === 'PREMIUM' || user.subscription_tier === 'PREMIUM+') ? 'bg-yellow-400/10' : (user.subscription_tier === 'PRO' ? 'bg-[#fb3b1e]/10' : 'bg-cyan-400/10')
              }`}></div>
              <div className={`relative rounded-lg p-3 backdrop-blur-sm border h-full ${
                (user.subscription_tier === 'PREMIUM' || user.subscription_tier === 'PREMIUM+')
                  ? 'bg-gray-900/95 border-yellow-400/40'
                  : (user.subscription_tier === 'PRO' ? 'bg-gray-900/95 border-[#fb3b1e]/40' : 'bg-gray-900/95 border-cyan-400/40')
              }`}>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img 
                      src={user.twitter_profile_image || `https://unavatar.io/twitter/${user.twitter_username}`}
                      alt={user.twitter_name}
                      className={`w-12 h-12 rounded-lg border-2 object-cover ${
                        (user.subscription_tier === 'PREMIUM' || user.subscription_tier === 'PREMIUM+')
                          ? 'border-yellow-400/80'
                          : user.subscription_tier === 'PRO'
                          ? 'border-[#fb3b1e]'
                          : user.subscription_tier === 'BASIC'
                          ? 'border-blue-400/80'
                          : 'border-gray-500/60'
                      }`}
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.src = `https://unavatar.io/twitter/${user.twitter_username}`
                      }}
                    />
                    {/* Live Sync Indicator */}
                    {isLiveSyncing && (
                      <div className="absolute -top-1 -right-1 w-3 h-3">
                        <div className="absolute inset-0 bg-green-400 rounded-full animate-ping opacity-75"></div>
                        <div className="relative w-3 h-3 bg-green-500 rounded-full border border-green-300"></div>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="text-cyan-400 font-mono text-[10px] tracking-wider">PLAYER</div>
                      {/* Rank Badge */}
                      {leaderboardRank && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-400/40">
                          <span className="text-[9px] text-amber-200 font-mono font-bold">RANK #{leaderboardRank.position}</span>
                        </div>
                      )}
                    </div>
                    <div className={`font-mono text-sm font-medium flex items-center gap-1.5 truncate text-gray-200`}>
                      <span className="truncate">@{user.twitter_username}</span>
                      {(user.subscription_tier === 'PREMIUM' || user.subscription_tier === 'PREMIUM+') && (
                        <img src="/badges/GOLDEN_BADGE.svg.png" alt="Premium+" className="w-4 h-4" />
                      )}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5">
                      <span>TIER:</span>
                      <span className={`font-semibold ${
                        (user.subscription_tier === 'PREMIUM' || user.subscription_tier === 'PREMIUM+') ? 'text-yellow-300' : user.subscription_tier === 'PRO' ? 'text-[#fb3b1e]' : user.subscription_tier === 'BASIC' ? 'text-blue-300' : 'text-cyan-300'
                      }`}>
                        {user.subscription_tier === 'PREMIUM' ? 'PREMIUM+' : (user.subscription_tier || 'FREE')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Total Score - Right */}
            <div className="md:col-span-7 relative animate-slide-in-right" style={{ animationDelay: '0.2s' }}>
              <div className="absolute -inset-1 bg-cyan-400/15 rounded-lg blur-md"></div>
              <div className="relative bg-black border border-cyan-400/40 rounded-lg p-4 backdrop-blur-sm h-full flex flex-col justify-center">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-cyan-400 font-mono text-xs mb-1 tracking-widest">TOTAL SCORE</div>
                    <div className="text-3xl sm:text-4xl font-mono font-bold text-cyan-300 glitch-number">
                      <AnimatedCounter 
                        value={extensionStats.totalScore} 
                        formatter={(val: number) => Math.round(val).toLocaleString()}
                        duration={1200}
                      />
                    </div>
                  </div>
                  <div className="hidden sm:block text-right">
                    <div className="text-gray-500 font-mono text-[10px]">AI INTERACTION</div>
                    <div className="text-gray-400 font-mono text-[10px]">POINTS</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Second Row: Stats Grid */}
          <div className="grid grid-cols-4 gap-3 mb-4 animate-slide-in-left" style={{ animationDelay: '0.3s' }}>
            <div className="relative">
              <div className="absolute -inset-0.5 bg-cyan-400/8 rounded-lg blur-sm"></div>
              <div className="relative bg-gray-900/95 border border-cyan-400/40 rounded-lg p-2.5 text-center backdrop-blur-sm">
                <div className="text-cyan-400 font-mono text-[10px] mb-1 tracking-wider">VISITS</div>
                <div className="text-white font-mono text-lg font-bold">
                  <AnimatedCounter 
                    value={extensionStats.todayVisits} 
                    duration={800}
                    className="text-white font-mono text-lg font-bold"
                  />
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute -inset-0.5 bg-purple-400/8 rounded-lg blur-sm"></div>
              <div className="relative bg-gray-900/95 border border-purple-400/40 rounded-lg p-2.5 text-center backdrop-blur-sm">
                <div className="text-purple-400 font-mono text-[10px] mb-1 tracking-wider">ACTIVE TIME</div>
                <div className="text-purple-300 font-mono text-lg font-bold">
                  <AnimatedCounter 
                    value={extensionStats.activeTime / 1000} 
                    formatter={(val: number) => {
                      const seconds = Math.round(val)
                      if (seconds < 60) return `${seconds}s`
                      const minutes = Math.floor(seconds / 60)
                      const remainingSeconds = seconds % 60
                      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
                    }}
                    duration={800}
                    className="text-purple-300 font-mono text-lg font-bold"
                  />
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute -inset-0.5 bg-yellow-400/8 rounded-lg blur-sm"></div>
              <div className="relative bg-gray-900/95 border border-yellow-400/40 rounded-lg p-2.5 text-center backdrop-blur-sm">
                <div className="text-yellow-400 font-mono text-[10px] mb-1 tracking-wider">TOTAL TIME</div>
                <div className="text-yellow-300 font-mono text-lg font-bold">
                  <AnimatedCounter 
                    value={extensionStats.totalTime / 1000} 
                    formatter={(val: number) => {
                      const seconds = Math.round(val)
                      if (seconds < 3600) {
                        const minutes = Math.floor(seconds / 60)
                        return `${minutes}m`
                      }
                      const hours = Math.floor(seconds / 3600)
                      const remainingMinutes = Math.floor((seconds % 3600) / 60)
                      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
                    }}
                    duration={800}
                    className="text-yellow-300 font-mono text-lg font-bold"
                  />
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute -inset-0.5 bg-pink-400/8 rounded-lg blur-sm"></div>
              <div className="relative bg-gray-900/95 border border-pink-400/40 rounded-lg p-2.5 text-center backdrop-blur-sm">
                <div className="text-pink-400 font-mono text-[10px] mb-1 tracking-wider">EFFICIENCY</div>
                <div className="text-pink-300 font-mono text-lg font-bold">
                  <AnimatedCounter 
                    value={extensionStats.efficiency} 
                    formatter={(val: number) => `${Math.round(val)}%`}
                    duration={1000}
                    className="text-pink-300 font-mono text-lg font-bold"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Today's Score - Full Width */}
          <div className="relative mb-4 animate-slide-in-left" style={{ animationDelay: '0.35s' }}>
            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-cyan-500/10 rounded-xl blur-md"></div>
            <div className="relative bg-gradient-to-br from-gray-900/95 via-gray-900 to-gray-900/95 border border-cyan-400/30 rounded-xl p-5 backdrop-blur-sm">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                {/* Left: Score Info */}
                <div className="flex-shrink-0">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="text-cyan-300 font-mono text-[11px] tracking-widest font-bold uppercase">Today's Score</div>
                    <div className="px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-300 text-[10px] font-mono">
                      {Math.max(0, Math.round((Math.max(0, extensionStats.todayScore) / 150000) * 100))}%
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-white font-mono font-bold text-3xl">
                      <AnimatedCounter 
                        value={Math.max(0, extensionStats.todayScore)} 
                        formatter={(val: number) => Math.round(val).toLocaleString()}
                        duration={1000}
                      />
                    </div>
                    <span className="text-gray-600 text-lg font-mono">/</span>
                    <span className="text-lg font-mono font-bold rainbow-text">150k</span>
                  </div>
                </div>
                
                {/* Right: Progress Bar */}
                <div className="flex-1 min-w-0 lg:max-w-sm">
                  <div className="grid grid-cols-10 gap-1">
                    {Array.from({ length: 20 }).map((_, idx) => {
                      const safeToday = Math.max(0, extensionStats.todayScore)
                      const pct = Math.min(1, safeToday / 150000)
                      const filled = idx < Math.round(20 * pct)
                      return (
                        <div 
                          key={idx} 
                          className={`h-3 rounded-sm transition-all ${
                            filled 
                              ? 'bg-gradient-to-r from-cyan-500 to-purple-500 border border-cyan-400/50 shadow-[0_0_6px_rgba(34,211,238,0.3)]' 
                              : 'bg-gray-800/80 border border-gray-700/50'
                          }`}
                        ></div>
                      )
                    })}
                  </div>
                  <div className="flex justify-between mt-1.5 text-[9px] font-mono text-gray-500">
                    <span>0</span>
                    <span>75k</span>
                    <span>150k</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Activity Grid + Connection Health Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4">
            {/* Activity Grid - Left */}
            <div className="lg:col-span-8 relative animate-slide-in-left" style={{ animationDelay: '0.4s' }}>
              <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-purple-500/10 rounded-xl blur-md"></div>
              <div className="relative bg-gradient-to-br from-gray-900/95 via-purple-950/20 to-gray-900/95 border border-purple-400/30 rounded-xl p-5 backdrop-blur-sm h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-purple-300 font-mono text-xs tracking-widest font-bold uppercase">Activity</div>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-gray-400">
                    <span>Less</span>
                    <div className="flex gap-0.5">
                      <div className="w-3 h-3 rounded bg-gray-800/80 border border-gray-700/50"></div>
                      <div className="w-3 h-3 rounded bg-purple-900/60 border border-purple-800/50"></div>
                      <div className="w-3 h-3 rounded bg-purple-600/70 border border-purple-500/60"></div>
                      <div className="w-3 h-3 rounded bg-fuchsia-500/80 border border-fuchsia-400/70"></div>
                      <div className="w-3 h-3 rounded bg-gradient-to-br from-pink-500 to-purple-500 border border-pink-400/80"></div>
                    </div>
                    <span>More</span>
                  </div>
                </div>
                
                {/* Grid container */}
                <div className="w-full overflow-x-auto pb-2">
                  <div className="flex gap-1 min-w-max">
                    {/* Day labels */}
                    <div className="flex flex-col gap-1 pr-2">
                      {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((day, i) => (
                        <div key={i} className="h-3.5 text-[9px] font-mono text-gray-500 flex items-center justify-end w-7">
                          {day}
                        </div>
                      ))}
                    </div>
                    
                    {/* 12 weeks of data */}
                    {Array.from({ length: 12 }).map((_, weekIdx) => (
                      <div key={weekIdx} className="flex flex-col gap-1">
                        {Array.from({ length: 7 }).map((_, dayIdx) => {
                          const dataIndex = weekIdx * 7 + dayIdx
                          const dayData = activityData[dataIndex]
                          const score = dayData?.score || 0
                          
                          let level = 0
                          if (score > 0) level = 1
                          if (score > 5000) level = 2
                          if (score > 15000) level = 3
                          if (score > 30000) level = 4
                          
                          const levelClasses = [
                            'bg-gray-800/80 border-gray-700/50',
                            'bg-purple-900/60 border-purple-800/50',
                            'bg-purple-600/70 border-purple-500/60',
                            'bg-fuchsia-500/80 border-fuchsia-400/70',
                            'bg-gradient-to-br from-pink-500 to-purple-500 border-pink-400/80 shadow-[0_0_6px_rgba(236,72,153,0.5)]'
                          ]
                          
                          return (
                            <div
                              key={dayIdx}
                              className={`w-3.5 h-3.5 rounded border ${levelClasses[level]} transition-all duration-200 hover:scale-125 cursor-pointer`}
                              title={dayData ? `${dayData.date}: ${score.toLocaleString()} pts` : 'No data'}
                            />
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-purple-500/20">
                  <div className="text-[10px] text-gray-500 font-mono">Last 12 weeks</div>
                  <div className="text-[10px] text-purple-400 font-mono">
                    {activityData.filter(d => d.score > 0).length} active days
                  </div>
                </div>
              </div>
            </div>

            {/* Connection Health - Right */}
            <div className="lg:col-span-4 relative animate-slide-in-right" style={{ animationDelay: '0.5s' }}>
              <div className={`absolute -inset-0.5 rounded-xl blur-sm ${
                connectionStatus.state === 'connected' ? 'bg-green-400/12' 
                  : connectionStatus.state === 'inactive' ? 'bg-yellow-400/12'
                  : 'bg-red-400/12'
              }`}></div>
              <div className={`relative border rounded-xl p-5 backdrop-blur-sm h-full flex flex-col ${
                connectionStatus.state === 'connected' 
                  ? 'bg-green-900/20 border-green-400/40' 
                  : connectionStatus.state === 'inactive'
                    ? 'bg-yellow-900/20 border-yellow-400/40'
                    : 'bg-red-900/20 border-red-400/40'
              }`}>
                {/* Header with status badge */}
                <div className="flex items-center justify-between mb-4">
                  <div className={`font-mono text-xs font-bold tracking-widest uppercase ${
                    connectionStatus.state === 'connected' ? 'text-green-300' 
                      : connectionStatus.state === 'inactive' ? 'text-yellow-200'
                      : 'text-red-300'
                  }`}>
                    Connection
                  </div>
                  <div className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    connectionStatus.state === 'connected'
                      ? 'bg-green-500/30 text-green-300 border border-green-400/60'
                      : connectionStatus.state === 'inactive'
                        ? 'bg-yellow-500/30 text-yellow-200 border border-yellow-400/60'
                        : connectionStatus.state === 'missing'
                          ? 'bg-red-500/30 text-red-300 border border-red-400/60'
                          : 'bg-gray-700/50 text-gray-300 border border-gray-600/50'
                  }`}>
                    {connectionStatus.state === 'connected' ? 'ONLINE' 
                      : connectionStatus.state === 'inactive' ? 'INACTIVE'
                      : connectionStatus.state === 'missing' ? 'OFFLINE'
                      : 'CHECKING'}
                  </div>
                </div>

                {/* Status indicator */}
                <div className="flex-1 flex items-center justify-center">
                  <div className={`w-16 h-16 rounded-full border-2 flex items-center justify-center ${
                    connectionStatus.state === 'connected' 
                      ? 'border-green-400/60 bg-green-500/10' 
                      : connectionStatus.state === 'inactive'
                        ? 'border-yellow-400/60 bg-yellow-500/10'
                        : 'border-red-400/60 bg-red-500/10'
                  }`}>
                    <div className={`w-4 h-4 rounded-full ${
                      connectionStatus.state === 'connected' 
                        ? 'bg-green-500 shadow-[0_0_16px_rgba(34,197,94,0.6)] animate-pulse' 
                        : connectionStatus.state === 'inactive'
                          ? 'bg-yellow-500 shadow-[0_0_16px_rgba(234,179,8,0.6)] animate-pulse'
                          : 'bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.6)]'
                    }`}></div>
                  </div>
                </div>

                {/* Device info */}
                <div className="mt-auto pt-4 border-t border-gray-700/30">
                  {(connectionStatus.state === 'connected' || connectionStatus.state === 'inactive') ? (
                    <div className="text-[10px] text-gray-400 font-mono space-y-1 mb-3">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Device</span>
                        <span>{connectionStatus.deviceUuid ? `${connectionStatus.deviceUuid.slice(0, 8)}…` : '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Last Sync</span>
                        <span>{connectionStatus.lastSync ? new Date(connectionStatus.lastSync).toLocaleTimeString() : '—'}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-[10px] text-gray-500 font-mono mb-3">
                      Extension not connected
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {connectionStatus.state === 'missing' || connectionStatus.state === 'unknown' ? (
                      <button
                        onClick={() => setShowSetupWizard(true)}
                        className="flex-1 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-300 px-3 py-2 rounded-lg font-mono text-xs font-bold tracking-wider transition-all"
                      >
                        SETUP
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleForceSync}
                          disabled={!extensionUuid || isForcingSync}
                          className="flex-1 px-3 py-2 rounded-lg border border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50 font-mono text-xs transition-all"
                        >
                          {isForcingSync ? 'SYNCING' : 'SYNC'}
                        </button>
                        <button
                          onClick={() => extensionUuid && fetchConnectionHealth(extensionUuid)}
                          disabled={!extensionUuid}
                          className="px-3 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50 font-mono text-xs transition-all"
                        >
                          ↻
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Row: Danger Zone Button (if enabled) */}
          {enableReset && (
            <div className="flex justify-end animate-slide-in-right" style={{ animationDelay: '0.7s' }}>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 rounded-lg border border-red-500/30 text-red-400/70 hover:text-red-300 hover:border-red-400/50 hover:bg-red-500/5 font-mono text-xs transition-all"
              >
                RESET DATA
              </button>
            </div>
          )}
        </div>
      </main>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        
        .glitch-text {
          font-family: 'JetBrains Mono', 'Courier New', monospace;
          text-shadow: 
            0.05em 0 0 #00ffff,
            -0.05em -0.025em 0 #ff00ff,
            0.025em 0.05em 0 #ffffff;
          animation: glitch 1.2s infinite;
        }
        
        .glitch-number {
          font-family: 'JetBrains Mono', 'Courier New', monospace;
          text-shadow: 
            0.02em 0 0 #00ffff,
            -0.02em -0.01em 0 #ff00ff;
          animation: glitch-number 4s infinite;
          letter-spacing: 0.1em;
        }
        
        .rainbow-text {
          background: linear-gradient(
            90deg,
            #ff6b6b,
            #feca57,
            #48dbfb,
            #ff9ff3,
            #54a0ff,
            #5f27cd,
            #ff6b6b
          );
          background-size: 200% auto;
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: rainbow-shift 3s linear infinite;
        }
        
        @keyframes rainbow-shift {
          0% { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
        
        @keyframes glitch {
          0%, 100% { 
            text-shadow: 0.05em 0 0 #00ffff, -0.05em -0.025em 0 #ff00ff, 0.025em 0.05em 0 #ffffff; 
            transform: translate(0);
          }
          15% { 
            text-shadow: 0.025em 0 0 #00ffff, -0.025em -0.05em 0 #ff00ff, 0.05em 0.025em 0 #ffffff; 
            transform: translate(-0.5px, 0.5px);
          }
          30% { 
            text-shadow: 0.075em 0 0 #00ffff, -0.075em -0.025em 0 #ff00ff, 0.025em 0.075em 0 #ffffff; 
            transform: translate(0.5px, -0.5px);
          }
          45% { 
            text-shadow: 0.025em 0 0 #00ffff, -0.025em -0.05em 0 #ff00ff, 0.05em 0.025em 0 #ffffff; 
            transform: translate(-0.5px, 0.5px);
          }
          60% { 
            text-shadow: 0.05em 0 0 #00ffff, -0.05em -0.025em 0 #ff00ff, 0.025em 0.05em 0 #ffffff; 
            transform: translate(0);
          }
        }
        
        @keyframes glitch-number {
          0%, 90%, 100% { 
            text-shadow: 0.02em 0 0 #00ffff, -0.02em -0.01em 0 #ff00ff; 
            transform: translate(0);
          }
          2%, 4% { 
            text-shadow: 0.01em 0 0 #00ffff, -0.01em -0.02em 0 #ff00ff; 
            transform: translate(-1px, 1px);
          }
          6%, 8% { 
            text-shadow: 0.03em 0 0 #00ffff, -0.03em -0.01em 0 #ff00ff; 
            transform: translate(1px, -1px);
          }
        }
        
        .animate-slide-down {
          animation: slideDown 0.8s ease-out;
        }
        
        .animate-slide-in-left {
          animation: slideInLeft 0.6s ease-out forwards;
          opacity: 0;
          transform: translateX(-20px);
        }
        
        .animate-slide-in-right {
          animation: slideInRight 0.6s ease-out forwards;
          opacity: 0;
          transform: translateX(20px);
        }
        
        .animate-fade-in {
          animation: fadeIn 0.8s ease-out;
        }
        
        @keyframes slideDown {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        
        @keyframes slideInLeft {
          to { opacity: 1; transform: translateX(0); }
        }
        
        @keyframes slideInRight {
          to { opacity: 1; transform: translateX(0); }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        .animate-toast-in {
          animation: toastIn 0.4s ease-out forwards;
        }
        
        @keyframes toastIn {
          0% { 
            opacity: 0; 
            transform: translateX(100px) scale(0.8);
          }
          100% { 
            opacity: 1; 
            transform: translateX(0) scale(1);
          }
        }
      `}</style>
    </div>

    {/* Modals */}
    <SetupWizardModal
      isOpen={showSetupWizard}
      onClose={() => setShowSetupWizard(false)}
      userId={user.id}
      onSetupComplete={handleSetupComplete}
    />
    
    {/* Reset Data / Danger Zone Modal */}
    {showDeleteConfirm && (
      <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
        <div className="relative w-full max-w-md">
          <div className="absolute -inset-1 bg-red-500/20 rounded-2xl blur-xl"></div>
          <div className="relative bg-black border border-red-500/40 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="border-b border-red-500/30 bg-red-500/5 px-6 py-4">
              <h3 className="text-lg font-mono font-bold text-red-400 tracking-wider">
                DANGER ZONE
              </h3>
              <p className="text-xs font-mono text-gray-500 mt-1">Reset all tracking data</p>
            </div>
            
            {/* Content */}
            <div className="p-6">
              <p className="text-gray-300 font-mono text-sm mb-4">
                This will permanently delete all devices, sessions, events, and scores. 
                Your account will remain but all tracking data will be wiped.
              </p>
              
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 mb-6">
                <p className="text-[11px] font-mono text-gray-400 mb-3">
                  Type <span className="text-red-400 font-bold">RESET_ALL_DATA</span> to confirm:
                </p>
                <input
                  type="text"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  placeholder="RESET_ALL_DATA"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm text-white focus:border-red-500 focus:outline-none font-mono"
                  disabled={isResetting}
                />
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setResetConfirm('')
                  }}
                  disabled={isResetting}
                  className="flex-1 bg-gray-800 text-gray-300 px-4 py-3 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 font-mono text-sm"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleResetData}
                  disabled={resetConfirm !== 'RESET_ALL_DATA' || isResetting}
                  className="flex-1 bg-red-600/80 text-white px-4 py-3 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm"
                >
                  {isResetting ? 'RESETTING...' : 'RESET DATA'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
    
    {/* Toast Notifications */}
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-toast-in bg-gradient-to-r from-green-900/90 to-emerald-900/90 border border-green-400/50 rounded-lg px-4 py-3 backdrop-blur-sm shadow-lg shadow-green-500/20"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-400/40 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-green-400"></div>
            </div>
            <div>
              <div className="text-green-300 font-mono text-sm font-bold">
                +{toast.points.toLocaleString()} pts
              </div>
              <div className="text-green-400/70 font-mono text-[10px]">
                {toast.domain}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>

    {/* Demo toast trigger - remove in production */}
    {process.env.NODE_ENV === 'development' && (
      <button
        onClick={() => addToast(Math.floor(Math.random() * 500) + 100, ['ChatGPT', 'Claude', 'Gemini', 'Perplexity'][Math.floor(Math.random() * 4)])}
        className="fixed bottom-4 left-4 z-50 px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-400 hover:bg-gray-700 font-mono"
      >
        Test Toast
      </button>
    )}
    </>
  )
}