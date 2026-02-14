'use client'

import { useState, useEffect, useRef } from 'react'
import WorldwideText from '@/components/WorldwideText'
import dynamic from 'next/dynamic'

// Globe component with no SSR
const Globe = dynamic(() => import('@/components/Globe'), {
  ssr: false,
  loading: () => <div className="w-full h-full" />
})

function AnimatedCounter({ target, duration = 2000 }: { target: number; duration?: number }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (target === 0) {
      setCount(0)
      return
    }

    let currentCount = 0
    const increment = target > 50 ? Math.ceil(target / 50) : 1 // Speed up for large numbers
    const stepDuration = duration / (target / increment)

    const timer = setInterval(() => {
      currentCount += increment
      if (currentCount >= target) {
        setCount(target)
        clearInterval(timer)
      } else {
      setCount(currentCount)
      }
    }, stepDuration)
    
    return () => clearInterval(timer)
  }, [target, duration])

  return <span>{count}</span>
}

export default function Home() {
  const [email, setEmail] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [waitlistCount, setWaitlistCount] = useState(0)
  const [showVCContact, setShowVCContact] = useState(false)
  const [showEarlyAccess, setShowEarlyAccess] = useState(false)
  const [isClosingModal, setIsClosingModal] = useState(false)
  const [scrollY, setScrollY] = useState(0)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({
        x: e.clientX,
        y: e.clientY
      })
    }

    const handleScroll = () => {
      // Update mouse position on scroll to maintain glow effect
      setMousePosition(prev => ({ ...prev }))
      setScrollY(window.scrollY)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  useEffect(() => {
    const fetchWaitlistCount = async () => {
      try {
        const response = await fetch('/api/waitlist')
        const data = await response.json()
        if (response.ok) {
          setWaitlistCount(data.count || 0)
        }
      } catch (err) {
        console.error('Failed to fetch waitlist count:', err)
      }
    }

    fetchWaitlistCount()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (response.ok) {
        setIsSubmitted(true)
        setWaitlistCount(prev => prev + 1)
      } else {
        setError(data.error || 'Failed to join waitlist')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCloseEarlyAccess = () => {
    setIsClosingModal(true)
    setTimeout(() => {
      setShowEarlyAccess(false)
      setIsClosingModal(false)
    }, 300) // Match the transition duration
  }

  const backgroundStyle = {
    backgroundImage: `
      radial-gradient(circle at ${mousePosition.x}px ${mousePosition.y + scrollY}px, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 200px, transparent 300px),
      radial-gradient(circle at ${mousePosition.x}px ${mousePosition.y + scrollY}px, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 150px, transparent 250px)
    `,
    backgroundSize: '100% 100%, 100% 100%',
    backgroundAttachment: 'local'
  }





  if (isSubmitted) {
    return (
      <main className="min-h-screen bg-black flex flex-col items-center justify-center px-4 relative">
        <div className="relative z-10">
        <div className="max-w-lg w-full text-center">
          <h1 className="text-3xl md:text-4xl font-normal text-white mb-4">
            You&apos;re on the waitlist! 🎉
          </h1>
          <p className="text-gray-400 text-base mb-6">
            We&apos;ll let you know when we&apos;re ready to launch.
          </p>
          
          <div className="relative overflow-hidden rounded-lg border border-gray-800 bg-gradient-to-br from-gray-900/50 to-black/50 backdrop-blur-sm p-6 mb-6">
            <div className="absolute inset-0 opacity-10" style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)',
              backgroundSize: '16px 16px'
            }}></div>
            
            <div className="relative z-10">
              <p className="text-gray-300 text-sm mb-4 leading-relaxed">
                Help us get this platform to everyone,<br />
                <span className="text-white font-medium">star the GitHub repo.</span>
              </p>
              
              <a 
                href="https://github.com/Birdabo404/Cribble" 
                target="_blank" 
                rel="noopener noreferrer"
                className="star-button group inline-flex items-center gap-3 bg-gray-800/80 hover:bg-gray-700/80 border border-gray-600 hover:border-gray-500 text-white px-5 py-3 rounded-md font-medium transition-all duration-300 text-sm backdrop-blur-sm"
              >
                <div className="relative">
                  <svg className="w-4 h-4 transition-transform group-hover:scale-110" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.237 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  <div className="absolute inset-0 w-4 h-4 bg-white/20 rounded-full blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </div>
                <span className="group-hover:text-gray-100 transition-colors">Star on GitHub</span>
                <svg className="w-3 h-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>
        
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 text-center">
          <p className="text-gray-600 text-xs mb-2">backed by no one.</p>
          <div className="flex items-center justify-center space-x-4 text-gray-500">
            <a 
              href="https://x.com/birdabo404" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            <a 
              href="https://github.com/birdabo404" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.237 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
          </div>
        </div>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="min-h-screen bg-black px-4 flex flex-col pb-20 relative overflow-hidden">
        
        {/* Globe Background */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 50 }}>
          <div className="hidden md:block">
            <Globe size={380} className="opacity-50" />
          </div>
          <div className="block md:hidden">
            <Globe size={280} className="opacity-8" />
          </div>
        </div>
        
        {/* Top section with centered waitlist */}
        <div className="flex-1 flex flex-col items-center justify-center relative" style={{ zIndex: 100 }}>
          <div className="max-w-2xl w-full text-center">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-normal text-white mb-4 leading-tight">
              {/* First line: a + worldwide */}
              <div className="flex items-baseline justify-center mb-2">
                <span className="mr-3">a</span>
                <WorldwideText />
              </div>
              {/* Second line: leaderboard for developers */}
              <div>
                leaderboard for developers.
              </div>
            </h1>
            
            <div className="text-sm mb-6 max-w-lg mx-auto">
              <p className="text-gray-400 inline">
                Join developers worldwide. Track your AI usage across platforms and climb the global leaderboard.
              </p>
              <span className="text-white font-bold font-mono ml-2 text-xs">
                COMING SOON
              </span>
            </div>

            <div className="max-w-sm mx-auto mb-4 space-y-4">
              <form onSubmit={handleSubmit}>
              <div className="flex items-center bg-gray-900 border border-gray-700 rounded-md overflow-hidden">
                <input
                  type="email"
                  placeholder="hello@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="flex-1 px-4 py-3 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="bg-white text-black px-4 py-3 font-medium hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
                >
                  {isLoading ? '...' : 'Join'}
                </button>
              </div>
              {error && (
                <p className="text-red-400 text-xs mt-2">{error}</p>
              )}
            </form>
            </div>

            <div className="text-gray-600 text-xs mb-4 flex items-center justify-center">
              <AnimatedCounter target={waitlistCount} />&nbsp;developers waiting
              <div className="w-2 h-2 bg-green-500 rounded-full ml-2 animate-pulse"></div>
            </div>
          </div>
        </div>

        {/* Bottom section with logos and options - always visible */}
        <div className="pb-1">
          <div className="max-w-2xl mx-auto text-center">
            {/* LLM Brands Floating Section */}
            <div className="mb-2">
              <p className="text-gray-500 text-xs font-mono mb-2 text-center">
                Track your AI usage across platforms
              </p>
              
              <div className="relative overflow-hidden h-24 mask-gradient">
                <div className="flex items-center gap-8 animate-scroll-infinite whitespace-nowrap">
                  {/* OpenAI */}
                  <div className="flex items-center gap-2 text-green-400">
                    <img src="/ai-companies/openai.png" alt="OpenAI" className="w-8 h-8 object-contain" style={{
                      background: 'white',
                      borderRadius: '4px',
                      padding: '1px'
                    }} />
                    <span className="font-mono text-sm">OpenAI</span>
                  </div>

                  {/* Anthropic */}
                  <div className="flex items-center gap-2 text-orange-400">
                    <img src="/ai-companies/anthropic.png" alt="Anthropic" className="w-8 h-8 object-contain rounded-sm" />
                    <span className="font-mono text-sm">Anthropic</span>
                  </div>

                  {/* DeepSeek */}
                  <div className="flex items-center gap-2 text-blue-400">
                    <img src="/ai-companies/deepseek.png" alt="DeepSeek" className="w-8 h-8 object-contain rounded-sm" />
                    <span className="font-mono text-sm">DeepSeek</span>
                  </div>

                  {/* Google AI */}
                  <div className="flex items-center gap-2 text-purple-400">
                    <img src="/ai-companies/google-ai.png" alt="Google AI" className="w-8 h-8 object-contain" />
                    <span className="font-mono text-sm">Google AI</span>
                  </div>

                  {/* Mistral - Fixed filename and larger size */}
                  <div className="flex items-center gap-2 text-red-400">
                    <img src="/ai-companies/mistral.png" alt="Mistral" className="w-8 h-8 object-contain" />
                    <span className="font-mono text-sm">Mistral</span>
                  </div>

                  {/* Cohere */}
                  <div className="flex items-center gap-2 text-yellow-400">
                    <img src="/ai-companies/cohere.png" alt="Cohere" className="w-8 h-8 object-contain" />
                    <span className="font-mono text-sm">Cohere</span>
                  </div>

                  {/* Perplexity - Fixed path and larger size */}
                  <div className="flex items-center gap-2 text-cyan-400">
                    <img src="/ai-companies/perplexity.png" alt="Perplexity" className="w-8 h-8 object-contain" />
                    <span className="font-mono text-sm">Perplexity</span>
                  </div>

                  {/* xAI (Grok) - Normal size */}
                  <div className="flex items-center gap-2 text-gray-400">
                    <img src="/ai-companies/xai.png" alt="xAI (Grok)" className="w-8 h-8 object-contain rounded-sm" style={{
                      background: 'white',
                      borderRadius: '4px',
                      padding: '1px'
                    }} />
                    <span className="font-mono text-sm">Grok</span>
                  </div>

                  {/* Repeat for seamless loop */}
                  <div className="flex items-center gap-2 text-green-400">
                    <img src="/ai-companies/openai.png" alt="OpenAI" className="w-8 h-8 object-contain" style={{
                      background: 'white',
                      borderRadius: '4px',
                      padding: '1px'
                    }} />
                    <span className="font-mono text-sm">OpenAI</span>
                  </div>

                  <div className="flex items-center gap-2 text-orange-400">
                    <img src="/ai-companies/anthropic.png" alt="Anthropic" className="w-8 h-8 object-contain rounded-sm" />
                    <span className="font-mono text-sm">Anthropic</span>
                  </div>

                  <div className="flex items-center gap-2 text-blue-400">
                    <img src="/ai-companies/deepseek.png" alt="DeepSeek" className="w-8 h-8 object-contain rounded-sm" />
                    <span className="font-mono text-sm">DeepSeek</span>
                  </div>

                  <div className="flex items-center gap-2 text-purple-400">
                    <img src="/ai-companies/google-ai.png" alt="Google AI" className="w-8 h-8 object-contain" />
                    <span className="font-mono text-sm">Google AI</span>
                  </div>

                  {/* Mistral - Repeated for seamless loop */}
                  <div className="flex items-center gap-2 text-red-400">
                    <img src="/ai-companies/mistral.png" alt="Mistral" className="w-8 h-8 object-contain" />
                    <span className="font-mono text-sm">Mistral</span>
                  </div>

                  <div className="flex items-center gap-2 text-yellow-400">
                    <img src="/ai-companies/cohere.png" alt="Cohere" className="w-8 h-8 object-contain" />
                    <span className="font-mono text-sm">Cohere</span>
                  </div>

                  {/* Perplexity - Repeated for seamless loop */}
                  <div className="flex items-center gap-2 text-cyan-400">
                    <img src="/ai-companies/perplexity.png" alt="Perplexity" className="w-8 h-8 object-contain" />
                    <span className="font-mono text-sm">Perplexity</span>
                  </div>

                  {/* xAI - Repeated for seamless loop - Normal size */}
                  <div className="flex items-center gap-2 text-gray-400">
                    <img src="/ai-companies/xai.png" alt="xAI (Grok)" className="w-8 h-8 object-contain rounded-sm" style={{
                      background: 'white',
                      borderRadius: '4px',
                      padding: '1px'
                    }} />
                    <span className="font-mono text-sm">Grok</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-center mb-1">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={() => setShowEarlyAccess(true)}
                  className="group relative inline-flex items-center gap-2 bg-transparent hover:bg-[#02fe01]/10 border border-[#02fe01] hover:border-[#02fe01]/80 text-[#F8F1D4] hover:text-[#F8F1D4]/90 px-6 py-2 rounded-md font-light transition-all duration-300 text-sm backdrop-blur-sm"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  <span>Early Access</span>
                </button>

                <button
                  onClick={() => setShowVCContact(true)}
                  className="group inline-flex items-center gap-2 bg-transparent hover:bg-gray-600/20 border border-gray-400 hover:border-gray-300 text-gray-300 hover:text-white px-6 py-2 rounded-md font-light transition-all duration-300 text-sm backdrop-blur-sm"
                >
                  <svg className="w-4 h-4 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Partner With Cribble</span>
                </button>


              </div>
            </div>
          </div>
        </div>
      </main>



      {showEarlyAccess && (
        <div className={`fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 transition-all duration-300 ${isClosingModal ? 'opacity-0' : 'opacity-100'}`}>
          <div className={`bg-black border border-[#02fe01] rounded-lg p-6 max-w-md w-full backdrop-blur-sm transition-all duration-300 ${isClosingModal ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-[#F8F1D4]">Early Access</h2>
              <button 
                onClick={handleCloseEarlyAccess}
                className="text-gray-400 hover:text-white hover:rotate-90 transition-all duration-200 text-lg"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-gray-300 text-sm leading-relaxed mb-2">
                  Cribble is coming soon! Get ready for the Global leaderboard that nobody asked for!
                </p>
                <p className="text-gray-400 text-xs mb-4">
                  The flood gates shall open soon.
                </p>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/30 rounded-full">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                  <span className="text-yellow-500 text-xs font-medium">IN DEVELOPMENT</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-4 bg-gray-800/40 border border-gray-600/60 rounded-lg hover:bg-gray-800/60 hover:border-gray-500/80 transition-all duration-300 cursor-pointer hover:scale-[1.02] hover:shadow-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-gray-300 font-medium text-sm hover:text-white transition-colors duration-300">FREE TIER</h3>
                    <span className="text-gray-400 text-xs">$0</span>
                  </div>
                </div>

                <div className="p-4 bg-gray-800/40 border border-[#F8F1D4]/20 rounded-lg hover:bg-gray-800/60 hover:border-[#F8F1D4]/40 transition-all duration-300 cursor-pointer hover:scale-[1.02] hover:shadow-lg hover:shadow-[#F8F1D4]/10">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[#F8F1D4]/60 font-medium text-sm hover:text-[#F8F1D4]/80 transition-colors duration-300">EARLY ACCESS</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-xs line-through">$20</span>
                      <span className="text-[#F8F1D4]/70 text-sm font-semibold hover:text-[#F8F1D4]/90 transition-colors duration-300">$6.66</span>
                    </div>
                  </div>
                  <p className="text-gray-400 text-xs">Premium features at launch price</p>
                </div>
              </div>

              <div className="text-center">
                <p className="text-gray-500 text-xs mb-3">Stay updated on my progress</p>
                <a
                  href="https://x.com/birdabo404"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 text-white rounded-md text-sm transition-all duration-200"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  Follow @birdabo404
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {showVCContact && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-black border border-[#02fe01] rounded-xl p-6 max-w-sm w-full backdrop-blur-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">Get in Touch</h3>
              <button 
                onClick={() => setShowVCContact(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                </svg>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Email</p>
                  <a 
                    href="mailto:Birdabo.dev@gmail.com?subject=Investment Inquiry - Cribble.dev"
                    className="text-white hover:text-blue-400 transition-colors font-medium"
                  >
                    Birdabo.dev@gmail.com
                  </a>
                </div>
              </div>
            </div>
            
            <p className="text-xs text-gray-500 mt-4 text-center">
              Open to discussing investment opportunities
            </p>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 w-full text-center py-2 bg-black/40 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-1">
          <p className="text-gray-500 text-xs font-mono">backed by no one.</p>
          <div className="flex items-center gap-4">
            <a 
              href="https://x.com/birdabo404" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            <a 
              href="https://github.com/birdabo404" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.237 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </>
  )
}