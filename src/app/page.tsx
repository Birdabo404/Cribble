'use client'

import { useEffect, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import dynamic from 'next/dynamic'

const HACKER_GREEN = '#02fe01'
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'Birdabo.dev@gmail.com'

const Globe = dynamic(() => import('@/components/Globe'), {
  ssr: false,
  loading: () => <div className="h-full w-full" />
})

const SIGNALS = [
  { label: 'PROMPT_MINUTES', value: 'live' },
  { label: 'TOOL_VISITS', value: 'synced' },
  { label: 'LEADERBOARD', value: 'private beta' }
]

const TOOL_LOGOS = [
  { name: 'OpenAI', src: '/ai-companies/openai.png', tone: 'text-emerald-300', boxed: true },
  { name: 'Claude', src: '/ai-companies/anthropic.png', tone: 'text-orange-300' },
  { name: 'DeepSeek', src: '/ai-companies/deepseek.png', tone: 'text-blue-300' },
  { name: 'Gemini', src: '/ai-companies/google-ai.png', tone: 'text-violet-300' },
  { name: 'Mistral', src: '/ai-companies/mistral.png', tone: 'text-red-300' },
  { name: 'Cohere', src: '/ai-companies/cohere.png', tone: 'text-yellow-300' },
  { name: 'Perplexity', src: '/ai-companies/perplexity.png', tone: 'text-cyan-300' },
  { name: 'Grok', src: '/ai-companies/xai.png', tone: 'text-zinc-300', boxed: true }
]

export default function Home() {
  const [email, setEmail] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [waitlistCount, setWaitlistCount] = useState(0)
  const [showVCContact, setShowVCContact] = useState(false)
  const [showEarlyAccess, setShowEarlyAccess] = useState(false)
  const [isClosingModal, setIsClosingModal] = useState(false)

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

    void fetchWaitlistCount()
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
    } catch {
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
    }, 300)
  }

  return (
    <div className="min-h-screen overflow-hidden bg-black text-zinc-100 selection:bg-[#02fe01]/20">
      <SpaceBackdrop />

      <main className="relative z-10 min-h-screen px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-7xl flex-col">
          <header className="flex items-center justify-between border-b border-zinc-900/90 pb-4 font-mono">
            <a href="/" className="text-sm font-semibold tracking-[0.35em] text-zinc-100">
              CRIBBLE<span style={{ color: HACKER_GREEN }}>.</span>
            </a>
            <nav className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowEarlyAccess(true)}
                className="rounded-md border border-zinc-800 px-3 py-2 text-[10px] tracking-[0.24em] text-zinc-400 transition-colors hover:border-[#02fe01]/60 hover:text-[#02fe01]"
              >
                BETA
              </button>
              <a
                href="/login"
                className="rounded-md border border-[#02fe01]/70 bg-[#02fe01]/10 px-3 py-2 text-[10px] tracking-[0.24em] text-[#02fe01] shadow-[0_0_18px_rgba(2,254,1,0.18)] transition-colors hover:bg-[#02fe01]/15"
              >
                LOGIN
              </a>
            </nav>
          </header>

          {isSubmitted ? (
            <SubmittedState waitlistCount={waitlistCount} />
          ) : (
            <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_430px] lg:gap-12 lg:py-10">
              <div className="max-w-3xl font-mono">
                <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-[#02fe01]/35 bg-[#02fe01]/5 px-3 py-2 text-[10px] tracking-[0.28em] text-[#02fe01] shadow-[0_0_22px_rgba(2,254,1,0.12)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#02fe01]" />
                  PRIVATE_BETA
                </div>

                <h1 className="max-w-3xl text-4xl font-semibold leading-[1.02] tracking-tight text-zinc-50 sm:text-5xl md:text-6xl lg:text-7xl">
                  The AI usage leaderboard for developers.
                </h1>

                <p className="mt-5 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
                  Cribble turns your Chrome extension telemetry into a private
                  score: minutes, visits, streaks, and rank across the tools you
                  already live in. We measure usage, not prompts.
                </p>

                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  {SIGNALS.map((signal) => (
                    <div
                      key={signal.label}
                      className="rounded-md border border-zinc-800/90 bg-zinc-950/70 p-3 backdrop-blur-sm"
                    >
                      <div className="text-[9px] tracking-[0.26em] text-zinc-600">
                        {signal.label}
                      </div>
                      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-zinc-200">
                        <span style={{ color: HACKER_GREEN }}>{'>'}</span> {signal.value}
                      </div>
                    </div>
                  ))}
                </div>

                <WaitlistForm
                  email={email}
                  error={error}
                  isLoading={isLoading}
                  waitlistCount={waitlistCount}
                  onEmailChange={setEmail}
                  onSubmit={handleSubmit}
                />

                <div className="mt-6 flex flex-col gap-3 text-[10px] tracking-[0.22em] text-zinc-500 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => setShowVCContact(true)}
                    className="w-fit rounded-md border border-zinc-800 px-3 py-2 text-left transition-colors hover:border-zinc-600 hover:text-zinc-200"
                  >
                    PARTNER_WITH_CRIBBLE
                  </button>
                  <a
                    href="https://github.com/Birdabo404/Cribble"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-fit rounded-md border border-zinc-800 px-3 py-2 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                  >
                    STAR_ON_GITHUB
                  </a>
                </div>
              </div>

              <HeroConsole waitlistCount={waitlistCount} />
            </section>
          )}

          <ToolRail />
        </div>
      </main>

      {showEarlyAccess && (
        <EarlyAccessModal
          isClosing={isClosingModal}
          onClose={handleCloseEarlyAccess}
        />
      )}

      {showVCContact && (
        <ContactModal onClose={() => setShowVCContact(false)} />
      )}

      <style jsx global>{`
        @keyframes cribble-scan {
          0% { transform: translateY(-100%); opacity: 0; }
          15% { opacity: 0.75; }
          85% { opacity: 0.75; }
          100% { transform: translateY(500%); opacity: 0; }
        }

        @keyframes cribble-console-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }

        @keyframes cribble-radar-sweep {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes cribble-logo-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }

        .cribble-logo-track {
          animation: cribble-logo-scroll 32s linear infinite;
        }

        .cribble-radar-sweep {
          animation: cribble-radar-sweep 8s linear infinite;
          transform-origin: center;
        }

        .cribble-scanline {
          animation: cribble-scan 5s ease-in-out infinite;
        }

        .cribble-console-pulse {
          animation: cribble-console-pulse 2s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .cribble-logo-track,
          .cribble-radar-sweep,
          .cribble-scanline,
          .cribble-console-pulse {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}

function WaitlistForm({
  email,
  error,
  isLoading,
  waitlistCount,
  onEmailChange,
  onSubmit
}: {
  email: string
  error: string
  isLoading: boolean
  waitlistCount: number
  onEmailChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <div className="mt-8 max-w-xl">
      <form onSubmit={onSubmit} className="rounded-md border border-[#02fe01]/45 bg-black/70 p-1.5 shadow-[0_0_30px_rgba(2,254,1,0.12)] backdrop-blur-md">
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <label className="sr-only" htmlFor="waitlist-email">Email address</label>
          <input
            id="waitlist-email"
            type="email"
            placeholder="pilot@terminal.dev"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            required
            disabled={isLoading}
            className="min-h-12 flex-1 rounded bg-zinc-950/80 px-4 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-[#02fe01]/60 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="min-h-12 rounded bg-[#02fe01] px-5 font-mono text-[11px] font-semibold tracking-[0.25em] text-black transition-colors hover:bg-[#75ff73] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? 'SYNCING' : 'JOIN'}
          </button>
        </div>
      </form>

      <div className="mt-3 flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono">
          <span style={{ color: HACKER_GREEN }}>
            <AnimatedCounter value={waitlistCount} duration={1800} formatter={(v) => Math.round(v).toLocaleString()} />
          </span>{' '}
          developers waiting
        </p>
        <p className="font-mono text-[10px] tracking-[0.22em] text-zinc-600">
          CHROME_EXTENSION_REQUIRED
        </p>
      </div>

      {error && (
        <p className="mt-2 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

function HeroConsole({ waitlistCount }: { waitlistCount: number }) {
  return (
    <div className="relative mx-auto w-full max-w-[430px] font-mono lg:mx-0">
      <div className="absolute -inset-px rounded-md bg-[#02fe01]/10 blur-xl" aria-hidden />
      <div className="relative overflow-hidden rounded-md border border-[#02fe01]/35 bg-black/80 shadow-[0_0_38px_rgba(2,254,1,0.12)] backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-[#02fe01]/20 px-4 py-3">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.28em] text-zinc-500">
            <span className="h-2 w-2 rounded-full bg-red-400/70" />
            <span className="h-2 w-2 rounded-full bg-yellow-300/70" />
            <span className="h-2 w-2 rounded-full bg-[#02fe01]" />
          </div>
          <div className="text-[10px] tracking-[0.26em] text-zinc-500">
            CRIBBLE_RADAR
          </div>
        </div>

        <div className="relative min-h-[460px] p-4 sm:p-5">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-20 cribble-scanline"
            style={{
              background: `linear-gradient(180deg, transparent, ${HACKER_GREEN}14, transparent)`
            }}
            aria-hidden
          />

          <div className="relative mx-auto flex aspect-square max-w-[300px] items-center justify-center">
            <Globe size={250} className="absolute inset-0 m-auto opacity-30" />
            <div className="absolute inset-7 rounded-full border border-[#02fe01]/15" />
            <div className="absolute inset-14 rounded-full border border-[#02fe01]/15" />
            <div className="absolute inset-0 rounded-full border border-[#02fe01]/35 shadow-[0_0_28px_rgba(2,254,1,0.12)_inset]" />
            <div
              className="cribble-radar-sweep absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(from 0deg, ${HACKER_GREEN}38, transparent 18%, transparent 100%)`
              }}
            />
            <div className="relative grid h-20 w-20 place-items-center rounded-full border border-[#02fe01]/60 bg-black/80 text-center shadow-[0_0_28px_rgba(2,254,1,0.22)]">
              <div>
                <div className="text-[10px] tracking-[0.24em] text-zinc-500">RANK</div>
                <div className="mt-1 text-lg font-semibold text-[#02fe01]">TBD</div>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-2 text-xs">
            <ConsoleLine label="BOOT" value="extension handshake ready" />
            <ConsoleLine label="PRIVACY" value="prompts ignored" />
            <ConsoleLine label="SCORE" value="active time + visits + streaks" />
            <ConsoleLine label="QUEUE" value={`${waitlistCount.toLocaleString()} pilots`} />
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {['ChatGPT', 'Claude', 'Cursor'].map((tool, index) => (
              <div key={tool} className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
                <div className="text-[9px] tracking-[0.2em] text-zinc-600">0{index + 1}</div>
                <div className="mt-2 truncate text-[11px] text-zinc-200">{tool}</div>
                <div className="mt-2 h-1 rounded bg-zinc-900">
                  <div
                    className="h-full rounded bg-[#02fe01]"
                    style={{ width: `${72 - index * 16}%`, boxShadow: `0 0 10px ${HACKER_GREEN}88` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ConsoleLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-900/90 pb-2">
      <span className="shrink-0 text-[10px] tracking-[0.22em] text-[#02fe01]">{label}</span>
      <span className="text-right text-zinc-400">{value}</span>
    </div>
  )
}

function ToolRail() {
  const doubled = [...TOOL_LOGOS, ...TOOL_LOGOS]

  return (
    <section className="border-t border-zinc-900/90 py-4">
      <div className="mb-3 flex items-center justify-between gap-3 font-mono text-[10px] tracking-[0.22em] text-zinc-600">
        <span>SUPPORTED_SIGNALS</span>
        <span className="hidden sm:block">NO_PROMPT_CAPTURE</span>
      </div>
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-black to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-black to-transparent" />
        <div className="cribble-logo-track flex w-max items-center gap-6 pr-6">
          {doubled.map((tool, index) => (
            <div key={`${tool.name}-${index}`} className={`flex items-center gap-2 ${tool.tone}`}>
              <img
                src={tool.src}
                alt={tool.name}
                className={`h-7 w-7 rounded-sm object-contain ${tool.boxed ? 'bg-white p-0.5' : ''}`}
              />
              <span className="font-mono text-xs text-zinc-300">{tool.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SubmittedState({ waitlistCount }: { waitlistCount: number }) {
  return (
    <section className="flex flex-1 items-center justify-center py-12 font-mono">
      <div className="w-full max-w-xl rounded-md border border-[#02fe01]/45 bg-black/75 p-6 text-center shadow-[0_0_34px_rgba(2,254,1,0.14)] backdrop-blur-md sm:p-8">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full border border-[#02fe01]/70 text-[#02fe01] shadow-[0_0_24px_rgba(2,254,1,0.2)]">
          ✓
        </div>
        <div className="text-[10px] tracking-[0.35em] text-[#02fe01]">QUEUE_CONFIRMED</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
          You are on the waitlist.
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          We will ping you when the private beta opens. Until then, starring the
          repo helps the signal travel.
        </p>
        <div className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/75 p-4">
          <p className="text-xs text-zinc-500">
            <span style={{ color: HACKER_GREEN }}>
              <AnimatedCounter value={waitlistCount} duration={1200} formatter={(v) => Math.round(v).toLocaleString()} />
            </span>{' '}
            developers in queue
          </p>
          <a
            href="https://github.com/Birdabo404/Cribble"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex rounded-md border border-zinc-700 px-4 py-2 text-[10px] tracking-[0.22em] text-zinc-200 transition-colors hover:border-[#02fe01]/70 hover:text-[#02fe01]"
          >
            STAR_ON_GITHUB
          </a>
        </div>
      </div>
    </section>
  )
}

function EarlyAccessModal({
  isClosing,
  onClose
}: {
  isClosing: boolean
  onClose: () => void
}) {
  return (
    <div className={`fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 font-mono backdrop-blur-sm transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100'}`}>
      <div className={`w-full max-w-md rounded-md border border-[#02fe01]/70 bg-black p-6 shadow-[0_0_34px_rgba(2,254,1,0.18)] transition-all duration-300 ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-[0.28em] text-[#02fe01]">EARLY_ACCESS</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            aria-label="Close early access modal"
          >
            X
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-sm leading-6 text-zinc-300">
            Cribble is moving through private beta. The first wave gets the
            extension link, dashboard access, and leaderboard slots before the
            floodgates open.
          </p>
          <div className="grid gap-2">
            <ModalRow label="FREE_TIER" value="$0" />
            <ModalRow label="EARLY_ACCESS" value="$6.66" active />
          </div>
          <a
            href="https://x.com/birdabo404"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded-md border border-zinc-700 px-4 py-2 text-[10px] tracking-[0.22em] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          >
            FOLLOW_PROGRESS
          </a>
        </div>
      </div>
    </div>
  )
}

function ContactModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 font-mono backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-md border border-[#02fe01]/70 bg-black p-6 shadow-[0_0_34px_rgba(2,254,1,0.18)]">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-[0.28em] text-zinc-100">CONTACT</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            aria-label="Close contact modal"
          >
            X
          </button>
        </div>

        <div className="rounded-md border border-zinc-800 bg-zinc-950/80 p-4">
          <p className="text-[10px] tracking-[0.24em] text-zinc-500">EMAIL</p>
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=Investment Inquiry - Cribble.dev`}
            className="mt-2 block break-all text-sm text-[#02fe01] transition-colors hover:text-[#75ff73]"
          >
            {CONTACT_EMAIL}
          </a>
        </div>

        <p className="mt-4 text-xs leading-5 text-zinc-500">
          Open to discussing investment, distribution, and beta partner paths.
        </p>
      </div>
    </div>
  )
}

function ModalRow({
  label,
  value,
  active
}: {
  label: string
  value: string
  active?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border p-4 ${
        active
          ? 'border-[#02fe01]/40 bg-[#02fe01]/10 text-[#02fe01]'
          : 'border-zinc-800 bg-zinc-950/70 text-zinc-300'
      }`}
    >
      <span className="text-xs tracking-[0.22em]">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}
