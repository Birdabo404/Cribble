'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface LeaderboardUser {
  rank: number
  username: string
  display_name?: string
  profile_image: string
  score: number
  isActive: boolean
  lastSeen: string
  tier: 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'AFFILIATE'
  isCurrentUser?: boolean
  topTools?: { name: string; visits: number; active_ms: number; percent: number }[]
}

export default function Leaderboard() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [timeLeft, setTimeLeft] = useState('')
  const [navHidden, setNavHidden] = useState(false)
  // Removed visibleItems and observerRef for performance

  // Season info
  const currentSeason = "01.2025"
  const resetDate = new Date('2024-12-31T23:59:59')
  const asciiHeader = `
 ██████╗ ██╗      ██████╗ ██████╗  █████╗ ██╗         ██╗     ███████╗ █████╗ ██████╗ ███████╗██████╗ ██████╗  ██████╗  █████╗ ██████╗ ██████╗ 
██╔════╝ ██║     ██╔═══██╗██╔══██╗██╔══██╗██║         ██║     ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗
██║  ███╗██║     ██║   ██║██████╔╝███████║██║         ██║     █████╗  ███████║██║  ██║█████╗  ██████╔╝██████╔╝██║   ██║███████║██████╔╝██║  ██║
██║   ██║██║     ██║   ██║██╔══██╗██╔══██║██║         ██║     ██╔══╝  ██╔══██║██║  ██║██╔══╝  ██╔══██╗██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║
╚██████╔╝███████╗╚██████╔╝██████╔╝██║  ██║███████╗    ███████╗███████╗██║  ██║██████╔╝███████╗██║  ██║██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝
 ╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝    ╚══════╝╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ 
`

  const TitleSVG = () => (
    <svg viewBox="0 0 1600 220" className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="greenGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="transparent" />
      <text x="50%" y="62%" textAnchor="middle" filter="url(#greenGlow)"
        fontFamily="'JetBrains Mono','Courier New',monospace" fontWeight="900" fontSize="110"
        stroke="#1aff1a" strokeWidth="1.5" fill="#02fe01">
        GLOBAL LEADERBOARD
      </text>
    </svg>
  )

  // Hide navbar on scroll down, show on scroll up
  useEffect(() => {
    let lastY = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (Math.abs(y - lastY) < 8) return
      setNavHidden(y > lastY && y > 32)
      lastY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    fetchCurrentUser()
    fetchLeaderboardData()
    const interval = setInterval(() => {
      fetchLeaderboardData()
    }, 30000)
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        fetchLeaderboardData()
        fetchCurrentUser()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const fetchLeaderboardData = async () => {
    try {
      const response = await fetch('/api/leaderboard?mock=1', { cache: 'no-store' })
      if (response.ok) {
        const { data } = await response.json()
        setLeaderboard(data || [])
      }
    } catch (err) {
      console.error('Error fetching leaderboard data:', err)
    }
  }

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date().getTime()
      const distance = resetDate.getTime() - now

      if (distance > 0) {
        const days = Math.floor(distance / (1000 * 60 * 60 * 24))
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((distance % (1000 * 60)) / 1000)

        setTimeLeft(`${days}d ${hours}h ${minutes}m ${seconds}s`)
      } else {
        setTimeLeft('SEASON ENDED')
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const fetchCurrentUser = async () => {
    try {
      const response = await fetch('/api/user/me', {
        credentials: 'include'
      })
      if (response.ok) {
        const userData = await response.json()
        setCurrentUser(userData)
      }
    } catch (error) {
      console.error('Error fetching user data:', error)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      router.push('/')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const formatScore = (score: number) => {
    return score.toLocaleString()
  }

  const hexToRgba = (hex: string, alpha: number) => {
    const h = hex.replace('#','')
    const bigint = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  const getHighResAvatarUrl = (url?: string | null): string | null => {
    if (!url) return url as any
    try {
      const u = new URL(url)
      if (u.hostname.includes('pbs.twimg.com')) {
        // Prefer 400x400
        if (u.searchParams.has('name')) {
          u.searchParams.set('name', '400x400')
          return u.toString()
        }
        u.pathname = u.pathname.replace(/_(normal|bigger|mini)\./, '_400x400.')
        return u.toString()
      }
      if (u.hostname.includes('unavatar.io')) {
        u.searchParams.set('size', '256')
        return u.toString()
      }
      return url
    } catch {
      return url
    }
  }

  const getProfileAvatar = (user: LeaderboardUser, size: 'small' | 'large' = 'small') => {
    const sizeClasses = size === 'large' ? 'w-9 h-9 sm:w-10 sm:h-10' : 'w-7 h-7 sm:w-8 sm:h-8'
    const textSize = size === 'large' ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'
    
    const getLetterAvatar = () => {
      const shapeClass = user.tier === 'PREMIUM' ? 'rounded-md' : user.tier === 'AFFILIATE' ? 'rounded-[6px]' : 'rounded-full'
      const borderClass = user.tier === 'PREMIUM' 
        ? 'border border-yellow-400/60' 
        : user.tier === 'PRO' 
        ? 'border border-blue-400 shadow-[0_0_12px_2px_rgba(29,78,216,0.30)]' 
        : user.tier === 'BASIC' ? 'border border-gray-500' 
        : user.tier === 'AFFILIATE' ? 'border border-[#02fe01] shadow-[0_0_12px_2px_rgba(2,254,1,0.25)]' : 'border border-gray-500'
      const bgClass = 'bg-gray-900'
      const textClass = 'text-gray-300'
      
      return (
        <div className={`${sizeClasses} ${bgClass} ${shapeClass} ${borderClass} flex items-center justify-center flex-shrink-0`}>
          <span className={`${textClass} font-mono ${textSize} font-bold`}>
            {user.username.charAt(0).toUpperCase()}
          </span>
        </div>
      )
    }
    
    const hasRealImage = user.profile_image && 
                        !user.profile_image.includes('/api/placeholder') && 
                        user.profile_image.startsWith('http')
    
    if (hasRealImage) {
      const shapeClass = user.tier === 'PREMIUM' ? 'rounded-md' : user.tier === 'AFFILIATE' ? 'rounded-[6px]' : 'rounded-full'
      const borderClass = user.tier === 'PREMIUM'
        ? 'border border-yellow-400/70'
        : user.tier === 'PRO'
        ? 'border-2 border-blue-400 shadow-[0_0_14px_3px_rgba(29,78,216,0.35)]'
        : user.tier === 'BASIC'
        ? 'border border-gray-500'
        : user.tier === 'AFFILIATE' ? 'border-2 border-[#02fe01] shadow-[0_0_14px_3px_rgba(2,254,1,0.25)]' : 'border-2 border-gray-500'
      
      return (
        <div className="relative flex-shrink-0">
          <img 
            src={getHighResAvatarUrl(user.profile_image) || user.profile_image} 
            alt={user.username}
            data-stage="primary"
            className={`${sizeClasses} ${borderClass} ${shapeClass} object-cover bg-gray-900 block`}
            onError={(e) => {
              const target = e.target as HTMLImageElement
              const stage = target.getAttribute('data-stage')
              if (stage === 'primary') {
                // try unavatar as secondary
                target.src = `https://unavatar.io/twitter/${encodeURIComponent(user.username)}?size=256&fallback=false`
                target.setAttribute('data-stage','unavatar')
                return
              }
              // final fallback to letter avatar
              target.style.display = 'none'
              const fallback = target.nextElementSibling as HTMLElement
              if (fallback) fallback.classList.remove('hidden')
            }}
          />
          <div className="hidden absolute inset-0">
            {getLetterAvatar()}
          </div>
          {/* Badge by tier next to username is handled outside; this leaves avatar clean */}
        </div>
      )
    }
    
    return getLetterAvatar()
  }

  const getVerificationBadge = (tier: string) => {
    // Badge images are in public/badges
    const size = 14
    const className = 'ml-2 sm:ml-3 inline-block align-middle'
    if (tier === 'PREMIUM') {
      return <img src="/badges/GOLDEN_BADGE.svg.png" alt="premium" width={size} height={size} className={className} />
    }
    if (tier === 'PRO') {
      return <img src="/badges/BLUE-BADGE.svg.png" alt="pro" width={size} height={size} className={className} />
    }
    if (tier === 'BASIC') {
      return <img src="/badges/BASIC.svg.png" alt="basic" width={size} height={size} className={className} />
    }
    if (tier === 'AFFILIATE') {
      return (
        <span className="inline-flex items-center gap-[2px] ml-2 sm:ml-3">
          <img src="/badges/affiliate.png" alt="affiliate" width={size} height={size} />
          <span className="inline-flex items-center justify-center w-[14px] h-[14px] border border-gray-600/60 rounded-[3px] bg-black">
            <img src="/affiliate-badge/affiliate-badge.jpg" alt="affiliate-extra" width={12} height={12} />
          </span>
        </span>
      )
    }
    return null
  }

  const filteredLeaderboard = leaderboard.filter(user =>
    user.username.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
        <div className="text-green-400 font-mono text-lg animate-pulse">LOADING...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden font-mono">
      {/* Enhanced CRT Scanlines with Green Theme */}
      <div className="absolute inset-0 pointer-events-none opacity-20 sm:opacity-30">
        <div className="h-full w-full" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,255,0,0.05) 0px, transparent 1px, transparent 3px)',
        }}></div>
      </div>
      
      {/* Additional scanline texture for depth */}
      <div className="absolute inset-0 pointer-events-none opacity-5 sm:opacity-10">
        <div className="h-full w-full" style={{
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,255,0,0.02) 0px, transparent 1px, transparent 4px)',
        }}></div>
      </div>

      {/* Sticky Navbar (auto-hide on scroll) */}
      <header className={`sticky top-0 z-30 border-b border-[#02fe01]/30 bg-black/80 backdrop-blur-sm px-3 sm:px-4 py-2 sm:py-3 transition-transform duration-300 ${navHidden ? '-translate-y-full' : 'translate-y-0'}`}>
        <div className="max-w-3xl sm:max-w-5xl mx-auto">
          {/* Mobile Layout */}
          <div className="sm:hidden flex items-center justify-between">
            <button 
              onClick={() => router.push('/dashboard')}
              className="text-base font-bold text-[#f2ff00] tracking-widest hover:text-yellow-200 transition-colors"
            >
              CRIBBLE.DEV
            </button>
            <div className="flex items-center gap-2">
              <img 
                src={(currentUser?.user?.twitter_profile_image || currentUser?.twitter_profile_image) || (currentUser?.user?.twitter_username || currentUser?.twitter_username ? `https://unavatar.io/twitter/${(currentUser?.user?.twitter_username || currentUser?.twitter_username)}?size=64` : '/favicon.png')} 
                alt={(currentUser?.user?.twitter_name || currentUser?.twitter_name) || 'user'}
                className="w-5 h-5 rounded-full"
              />
              <span className="text-[#f2ff00] text-xs font-bold">@{(currentUser?.user?.twitter_username || currentUser?.twitter_username) || 'user'}</span>
            </div>
          </div>

          {/* Desktop Layout */}
          <div className="hidden sm:flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => router.push('/dashboard')}
                className="text-xl lg:text-2xl font-bold text-[#02fe01] tracking-widest hover:text-yellow-200 transition-colors"
              >
                CRIBBLE.DEV
              </button>
              {/* Removed redundant LEADERBOARD label on leaderboard page */}
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 bg-gray-900/30 px-3 py-2 rounded-md border border-[#02fe01]/30">
                <img 
                  src={(currentUser?.user?.twitter_profile_image || currentUser?.twitter_profile_image) || (currentUser?.user?.twitter_username || currentUser?.twitter_username ? `https://unavatar.io/twitter/${(currentUser?.user?.twitter_username || currentUser?.twitter_username)}?size=64` : '/favicon.png')} 
                  alt={(currentUser?.user?.twitter_name || currentUser?.twitter_name) || 'user'}
                  className="w-7 h-7 rounded-full"
                />
                <div className="text-xs flex items-center gap-2">
                   <div className="text-[#02fe01]">@{(currentUser?.user?.twitter_username || currentUser?.twitter_username) || 'user'}</div>
                   <div className="flex items-center gap-2">
                     <button onClick={() => router.push('/dashboard')} className="px-3 py-1 rounded-md border border-[#02fe01]/60 text-[#02fe01] hover:bg-[#02fe01]/10">DASHBOARD</button>
                     <button onClick={handleLogout} className="px-3 py-1 rounded-md border border-red-400/60 text-red-400 hover:bg-red-500/10">EXIT</button>
                   </div>
                </div>
              </div>
              
              {/* Removed external EXIT per design; we keep the pill inside user card */}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-3xl sm:max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        
        {/* Header card */}
        <div className="relative mb-6">
          <div className="bg-black border border-[#02fe01] rounded-md overflow-hidden">
            <div className="border-b border-[#02fe01] px-4 py-4">
              <div className="flex flex-col items-center gap-2.5">
                {/* ASCII title on all sizes; ultra-compact on mobile */}
                <pre className="whitespace-pre overflow-x-auto text-[#02fe01] font-mono leading-[0.9] text-[4px] sm:text-[5px] md:text-[6px] lg:text-[7px] xl:text-[8px] text-center">
{asciiHeader}
                </pre>

                {/* Season/Reset centered */}
                <div className="flex items-center justify-center gap-3">
                  <div className="text-yellow-200 font-mono text-xs sm:text-sm">SEASON: {currentSeason}</div>
                  <div className="text-[#02fe01]">■</div>
                  <div className="text-red-400 font-mono text-xs sm:text-sm">RESET IN: {timeLeft || 'SEASON ENDED'}</div>
                </div>

                {/* Updated + Search (inline) */}
                <div className="flex items-center justify-center gap-2.5 flex-wrap">
                  <div className="text-[#FF5C00] drop-shadow-[0_0_6px_rgba(255,92,0,0.5)] font-mono text-xs sm:text-sm">UPDATED REAL-TIME 🌏 {leaderboard.length} TOTAL USERS</div>
                  <div className="hidden sm:block w-px h-4 bg-[#02fe01]/30" />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowSearch(!showSearch)}
                      className="px-3 py-1 border border-[#02fe01] rounded-md text-[#02fe01] font-mono text-xs sm:text-sm font-semibold hover:text-yellow-200 hover:border-yellow-200 transition-all"
                    >
                      SEARCH
                    </button>
                    {showSearch && (
                      <>
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search users..."
                          className="retro-input w-40 sm:w-56 px-2 py-1.5 rounded-md text-xs sm:text-sm placeholder-gray-500 focus:outline-none"
                        />
                        <div className="text-[#02fe01] font-mono text-sm px-3 py-1.5 border border-[#02fe01] rounded-md min-w-[3rem] text-center bg-transparent">
                          {filteredLeaderboard.length}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* divider removed per design cleanup */}

                {/* (moved) */}

                {/* Maximum Score Info */}
                <div className="mt-2 pt-1 border-t border-[#02fe01]/20 text-[#02fe01] text-[11px] sm:text-xs text-center w-full">
                  DAILY MAX: <span className="font-semibold">150,000+</span> • SEASON (90 DAYS): <span className="font-semibold">100,000,000+</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Unified Leaderboard - All Users */}
        {filteredLeaderboard.length > 0 && (
            <div className="relative">
              <div className="bg-black border border-[#02fe01] rounded-md overflow-hidden">
              
              {/* Table Header - Desktop Only */}
               <div className="hidden sm:block bg-black border-b border-[#02fe01] px-3 py-2">
                 <div className="grid grid-cols-12 gap-2 text-[#02fe01] font-mono text-[11px] font-semibold tracking-wider">
                  <div className="col-span-1">RANK</div>
                   <div className="col-span-6">PLAYER</div>
                   <div className="col-span-3">SCORE</div>
                      <div className="col-span-2 hidden md:block">TOP 3</div>
                </div>
              </div>

              {/* Leaderboard Entries */}
               <div className="divide-y divide-[#02fe01]/25">
                {filteredLeaderboard.map((user, index) => (
                 <div 
                    key={user.rank} 
                     className={`px-4 py-2.5 hover:bg-[#02fe01]/5 transition-all duration-300 ${
                      user.isCurrentUser ? 'bg-[#02fe01]/10 border-l-2 border-[#02fe01]' : ''
                    }`}
                    data-rank={user.rank}
                  >
                    {/* Mobile Layout */}
                    <div className="flex items-center gap-4 sm:hidden">
                       <div className={`font-mono font-semibold text-base min-w-[3rem] flex items-center gap-1 ${
                        user.rank === 1 ? 'text-yellow-300' : user.rank === 2 ? 'text-gray-300' : user.rank === 3 ? 'text-amber-600' : 'text-white'
                      }`}>
                        <span>{user.rank === 1 ? '🏆' : user.rank === 2 ? '🥈' : user.rank === 3 ? '🥉' : '#'}</span>
                        <span>{user.rank > 3 ? user.rank : ''}</span>
                      </div>
                      {getProfileAvatar(user, 'large')}
                        <div className="flex-1 min-w-0">
                        <div className="text-white font-mono text-sm font-normal flex items-center">
                          <span className="truncate">{user.display_name || user.username}</span>
                          {getVerificationBadge(user.tier)}
                        </div>
                        <div className="text-gray-500 font-mono text-[11px]">@{user.username.toLowerCase()}</div>
                        <div className="text-[#02fe01] font-mono text-sm font-semibold mt-1">
                          {formatScore(user.score)}
                        </div>
                      </div>
                      <div className="flex items-center justify-center">
                        <div className={`w-2 h-2 rounded-sm ${
                          user.isActive 
                            ? 'bg-green-400 retro-status-active' 
                            : 'bg-gray-600'
                        }`}></div>
                      </div>
                    </div>

                    {/* Desktop Layout */}
                     <div className={`hidden sm:grid sm:grid-cols-12 gap-2 items-center ${user.rank <= 3 ? 'relative group' : ''}`}>
                       {user.rank <= 3 && (
                         <div className="absolute inset-0 rounded-md pointer-events-none transition-opacity duration-200 group-hover:opacity-100" style={{
                           opacity: 0.9,
                           background: user.rank === 1
                             ? 'radial-gradient(120% 80% at 10% 50%, rgba(242,255,0,0.10), rgba(0,0,0,0))'
                             : user.rank === 2
                             ? 'radial-gradient(120% 80% at 10% 50%, rgba(200,200,200,0.08), rgba(0,0,0,0))'
                             : 'radial-gradient(120% 80% at 10% 50%, rgba(205,127,50,0.10), rgba(0,0,0,0))'
                         }} />
                       )}
                      
                      {/* Rank */}
                      <div className="col-span-1 pl-1">
                        <div className={`font-mono font-medium text-base flex items-center gap-2 text-[#02fe01]`}>
                          <span>{user.rank === 1 ? '🏆' : user.rank === 2 ? '🥈' : user.rank === 3 ? '🥉' : '#'}</span>
                          <span>{user.rank > 3 ? user.rank : ''}</span>
                        </div>
                      </div>

                      {/* Player */}
                       <div className="col-span-6 flex items-center gap-2">
                        {getProfileAvatar(user, 'large')}
                        <div className="min-w-0">
                          <div className="text-white font-mono text-sm font-normal flex items-center">
                            <span className="truncate max-w-[200px] sm:max-w-[260px]">{user.display_name || user.username}</span>
                            {getVerificationBadge(user.tier)}
                          </div>
                          <div className="text-gray-500 font-mono text-[11px] truncate">@{user.username.toLowerCase()}</div>
                          {false && user.topTools}
                        </div>
                      </div>

                      {/* Score */}
                       <div className="col-span-3">
                        <div className="font-mono text-sm sm:text-base font-medium text-[#FF5C00] drop-shadow-[0_0_6px_rgba(255,92,0,0.4)]">
                          {formatScore(user.score)}
                         </div>
                      </div>

                      {/* Top 3 icons/percent (desktop only) */}
                      <div className="col-span-2 hidden md:flex items-center justify-end pr-3">
                        <div className="flex gap-2 items-center">
                          {(user.topTools && user.topTools.length > 0 ? user.topTools : [
                            { name: 'ChatGPT' },
                            { name: 'Claude' },
                            { name: 'Perplexity' }
                          ]).slice(0,3).map((t, i) => {
                            // Render public images from /public/ai-badges/*.png to avoid Next/Image import issues
                            const name = t.name?.toLowerCase() || ''
                            // prefer public path under /ai-companies, fallback to /ai-badges
                            const fileBase = name.includes('openai') || name.includes('chatgpt') ? 'openai.png'
                              : name.includes('claude') ? 'anthropic.png'
                              : name.includes('perplexity') ? 'perplexity.png'
                              : name.includes('google') || name.includes('gemini') ? 'google-ai.png'
                              : name.includes('deepseek') ? 'deepseek.png'
                              : name.includes('cohere') ? 'cohere.png'
                              : name.includes('grok') ? 'GROK.png'
                              : name.includes('mistral') ? 'mistal.png'
                              : 'openai.png'
                            const srcPrimary = `/ai-companies/${fileBase}`
                            const srcFallback = `/ai-badges/${fileBase}`
                            const handleError = (e: any) => {
                              const img = e.currentTarget as HTMLImageElement
                              const tried = img.dataset.fallback
                              if (!tried) {
                                img.src = srcFallback
                                img.dataset.fallback = '1'
                              } else if (tried === '1') {
                                // last resort: unavatar for known brands
                                const brand = (t.name || 'openai').toLowerCase().replace(/\s+/g,'')
                                img.src = `https://unavatar.io/${encodeURIComponent(brand)}`
                                img.dataset.fallback = '2'
                              }
                            }
                            // pill tint by brand
                            const brandTint = name.includes('openai') || name.includes('chatgpt') ? 'rgba(25, 195, 125, 0.18)'
                              : name.includes('claude') || name.includes('anthropic') ? 'rgba(82, 109, 255, 0.18)'
                              : name.includes('perplexity') ? 'rgba(0, 130, 255, 0.18)'
                              : name.includes('google') || name.includes('gemini') ? 'rgba(66, 133, 244, 0.18)'
                              : name.includes('deepseek') ? 'rgba(255, 140, 0, 0.18)'
                              : name.includes('cohere') ? 'rgba(255, 204, 0, 0.18)'
                              : name.includes('grok') ? 'rgba(255, 0, 0, 0.18)'
                              : name.includes('mistral') ? 'rgba(255, 102, 0, 0.18)'
                              : 'rgba(255,255,255,0.12)'
                            const tierTint = user.tier === 'PREMIUM' ? 'rgba(255,215,0,0.12)'
                              : user.tier === 'PRO' ? 'rgba(251,59,30,0.12)'
                              : user.tier === 'BASIC' ? 'rgba(0,120,255,0.12)'
                              : user.tier === 'AFFILIATE' ? 'rgba(2,254,1,0.12)'
                              : 'rgba(255,255,255,0.06)'
                            const borderTint = user.tier === 'PREMIUM' ? 'rgba(255,215,0,0.25)'
                              : user.tier === 'PRO' ? 'rgba(251,59,30,0.25)'
                              : user.tier === 'BASIC' ? 'rgba(0,120,255,0.25)'
                              : user.tier === 'AFFILIATE' ? 'rgba(2,254,1,0.35)'
                              : 'rgba(255,255,255,0.15)'
                            return (
                              <div key={i} className="flex items-center" title={t.name}>
                                <div className="px-2 py-1 rounded-[8px]" style={{ backgroundColor: brandTint, border: `1px solid ${borderTint}` }}>
                                  <div className="w-[28px] h-[28px] rounded-[6px] bg-black/80 flex items-center justify-center">
                                    <img src={srcPrimary} alt={t.name || 'tool'} width={22} height={22} className="object-contain" onError={handleError} />
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {filteredLeaderboard.length === 0 && (
          <div className="relative">
            <div className="bg-black border border-green-400 rounded-md p-8 text-center backdrop-blur-sm">
              <div className="text-green-300 font-mono text-lg font-bold mb-2">NO USERS FOUND</div>
              <div className="text-gray-400 font-mono text-sm">Try a different search term</div>
            </div>
          </div>
        )}

      </main>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        
        .glitch-text {
          font-family: 'JetBrains Mono', 'Courier New', monospace;
          text-shadow: 
            0.05em 0 0 #00ff00,
            -0.05em -0.025em 0 #00aa00,
            0.025em 0.05em 0 #ffffff;
          animation: glitch 1.5s infinite;
        }
        
        @keyframes glitch {
          0%, 100% { 
            text-shadow: 0.05em 0 0 #00ff00, -0.05em -0.025em 0 #00aa00, 0.025em 0.05em 0 #ffffff; 
            transform: translate(0);
          }
          15% { 
            text-shadow: 0.025em 0 0 #00ff00, -0.025em -0.05em 0 #00aa00, 0.05em 0.025em 0 #ffffff; 
            transform: translate(-0.5px, 0.5px);
          }
          30% { 
            text-shadow: 0.075em 0 0 #00ff00, -0.075em -0.025em 0 #00aa00, 0.025em 0.075em 0 #ffffff; 
            transform: translate(0.5px, -0.5px);
          }
          85% { 
            text-shadow: 0.025em 0 0 #00ff00, -0.025em -0.05em 0 #00aa00, 0.05em 0.025em 0 #ffffff; 
            transform: translate(-0.5px, 0);
          }
        }

        /* Optimized animations with hardware acceleration */
        @keyframes fade-in {
          0% {
            opacity: 0;
            transform: translate3d(0, 20px, 0);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        @keyframes slide-up {
          0% {
            opacity: 0;
            transform: translate3d(0, 30px, 0) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }

        @keyframes slide-in-left {
          0% {
            opacity: 0;
            transform: translate3d(-20px, 0, 0);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        /* Smooth animation classes with better easing */
        .animate-fade-in {
          opacity: 0;
          animation: fade-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
          will-change: opacity, transform;
        }

        .animate-slide-up {
          opacity: 0;
          animation: slide-up 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
          will-change: opacity, transform;
        }

        .animate-slide-in-left {
          opacity: 0;
          animation: slide-in-left 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
          will-change: opacity, transform;
        }
        
        * {
          font-family: 'JetBrains Mono', 'Courier New', monospace !important;
        }

        /* Performance optimizations */
        * {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }

        /* Mobile scroll optimization */
        @media (max-width: 640px) {
          body {
            -webkit-overflow-scrolling: touch;
          }
          
          /* Reduce motion for better mobile performance */
          @media (prefers-reduced-motion: reduce) {
            .animate-fade-in,
            .animate-slide-up,
            .animate-slide-in-left {
              animation: none;
              opacity: 1;
              transform: none;
            }
          }
        }

        /* Smooth scrolling for the entire page */
        html {
          scroll-behavior: smooth;
        }
      `}</style>
    </div>
  )
}
