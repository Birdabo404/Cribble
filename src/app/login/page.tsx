'use client'

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import { ThemeToggle } from '@/components/ThemeToggle'

type Tab = 'signin' | 'register'

const ERROR_MESSAGES: Record<string, string> = {
  invite_required: 'No cribble account found for that GitHub user. Register with an invite code below.',
  invite_invalid: 'That invite code is invalid, expired, or already used.',
  invite_check_failed: 'We could not verify your invite code. Please try again.',
  github_oauth_denied: 'GitHub sign-in was cancelled. Try again when you are ready.',
  session_creation_failed: 'Something went wrong creating your session. Please try again.'
}

const GENERIC_AUTH_ERROR = 'GitHub sign-in failed. Please try again in a moment.'
const INVITE_ERRORS = new Set(['invite_required', 'invite_invalid', 'invite_check_failed'])

function resolveErrorMessage(errorKey: string | null): string | null {
  if (!errorKey) return null
  if (ERROR_MESSAGES[errorKey]) return ERROR_MESSAGES[errorKey]
  if (errorKey.startsWith('github_') || errorKey.startsWith('session_')) {
    return GENERIC_AUTH_ERROR
  }
  return null
}

/** Uppercase and strip anything that can't appear in a code (paste-friendly). */
function sanitizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32)
}

function LoginSplit() {
  const searchParams = useSearchParams()
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  const isLight = mounted && resolvedTheme === 'light'

  const errorKey = searchParams.get('error')
  const urlError = useMemo(() => resolveErrorMessage(errorKey), [errorKey])
  const isInviteError = errorKey !== null && INVITE_ERRORS.has(errorKey)

  const [tab, setTab] = useState<Tab>(isInviteError ? 'register' : 'signin')
  const [inviteCode, setInviteCode] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The URL error belongs to the tab the failure came from.
  const activeError =
    localError ??
    (urlError && (isInviteError ? tab === 'register' : tab === 'signin') ? urlError : null)

  const switchTab = (next: Tab) => {
    setTab(next)
    setLocalError(null)
  }

  const signIn = () => {
    setBusy(true)
    window.location.href = '/api/auth/github'
  }

  const register = async (e: FormEvent) => {
    e.preventDefault()
    const code = inviteCode.trim()
    if (!code || busy) return
    setBusy(true)
    setLocalError(null)
    try {
      // UX pre-check only; the OAuth callback re-validates and atomically
      // consumes the code server-side.
      const res = await fetch('/api/auth/invite/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      if (res.status === 429) {
        setLocalError('Too many attempts. Wait a minute and try again.')
        setBusy(false)
        return
      }
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setLocalError('Could not verify the code right now. Please try again.')
        setBusy(false)
        return
      }
      if (!data?.valid) {
        setLocalError(ERROR_MESSAGES.invite_invalid)
        setBusy(false)
        return
      }
      window.location.href = `/api/auth/github?invite=${encodeURIComponent(code)}`
    } catch {
      setLocalError('Network error. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="login-shell grid w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-800/70 bg-zinc-950 font-mono shadow-[0_40px_120px_rgba(0,0,0,0.45)] transition-colors duration-500 lg:min-h-[640px] lg:grid-cols-2">
      {/* ── LEFT · login controls ─────────────────────────────── */}
      <div className="flex flex-col p-7 sm:p-10 lg:p-12">
        {/* top bar */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm font-semibold tracking-[0.35em] text-zinc-100 transition-colors duration-500"
          >
            CRIBBLE<span className="text-accent">.</span>
          </Link>
          <ThemeToggle />
        </div>

        {/* centered form block */}
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <div className="space-y-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 px-3 py-1 text-[9px] tracking-[0.28em] text-zinc-500">
              <span className="login-diode h-1.5 w-1.5 rounded-full bg-accent" />
              PRIVATE BETA · INVITE-ONLY
            </span>
            <h1 className="pt-2 text-3xl font-semibold tracking-tight text-zinc-50 transition-colors duration-500">
              {tab === 'signin' ? 'Welcome back' : 'Claim your spot'}
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400">
              {tab === 'signin'
                ? 'Continue with the GitHub account linked to your cribble profile.'
                : 'Enter your invite code, then link your GitHub account.'}
            </p>
          </div>

          {/* tabs */}
          <div
            role="tablist"
            aria-label="Sign in or register"
            className="mt-7 grid grid-cols-2 rounded-md border border-zinc-800 bg-black/40 p-1 transition-colors duration-500"
          >
            {(
              [
                { id: 'signin', label: 'SIGN IN' },
                { id: 'register', label: 'REGISTER' }
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => switchTab(id)}
                className={`rounded px-3 py-2 text-[10px] tracking-[0.25em] transition-colors ${
                  tab === id
                    ? 'bg-accent/10 text-accent shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.3)]'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeError && (
            <div
              role="alert"
              className="mt-5 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs leading-relaxed text-rose-400"
            >
              {activeError}
            </div>
          )}

          {/* panels */}
          {tab === 'signin' ? (
            <div role="tabpanel" className="mt-6 space-y-4">
              <button
                onClick={signIn}
                disabled={busy}
                className="flex w-full items-center justify-center gap-3 rounded-md bg-white px-6 py-3.5 text-sm font-medium text-black transition-all duration-300 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? <Spinner /> : <GithubIcon />}
                {busy ? 'Connecting…' : 'Continue with GitHub'}
              </button>
              <p className="text-center text-[11px] text-zinc-500">
                First time here?{' '}
                <button
                  onClick={() => switchTab('register')}
                  className="text-accent/80 underline-offset-2 transition-colors hover:text-accent hover:underline"
                >
                  Register with an invite code
                </button>
              </p>
            </div>
          ) : (
            <form role="tabpanel" onSubmit={register} className="mt-6 space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="invite-code"
                  className="block text-[10px] tracking-[0.25em] text-zinc-500"
                >
                  INVITE_CODE
                </label>
                <input
                  id="invite-code"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => {
                    setInviteCode(sanitizeInviteCode(e.target.value))
                    if (localError) setLocalError(null)
                  }}
                  placeholder="CRIB-XXXX-XXXX"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  required
                  aria-invalid={!!activeError}
                  className={`w-full rounded-md border bg-black/40 px-4 py-3 text-center text-sm tracking-[0.25em] text-zinc-100 caret-accent transition-colors duration-300 placeholder:text-zinc-600 focus:outline-none focus:ring-1 ${
                    activeError
                      ? 'border-rose-500/50 focus:border-rose-400/70 focus:ring-rose-400/30'
                      : 'border-zinc-800 focus:border-accent/50 focus:ring-accent/30'
                  }`}
                />
              </div>
              <button
                type="submit"
                disabled={busy || !inviteCode.trim()}
                className="flex w-full items-center justify-center gap-3 rounded-md bg-white px-6 py-3.5 text-sm font-medium text-black transition-all duration-300 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? <Spinner /> : <GithubIcon />}
                {busy ? 'Verifying…' : 'Redeem & continue with GitHub'}
              </button>
              <p className="text-center text-[11px] text-zinc-500">
                Already a member?{' '}
                <button
                  type="button"
                  onClick={() => switchTab('signin')}
                  className="text-accent/80 underline-offset-2 transition-colors hover:text-accent hover:underline"
                >
                  Sign in instead
                </button>
              </p>
            </form>
          )}
        </div>

        {/* bottom bar */}
        <p className="text-center text-xs text-zinc-500 transition-colors duration-500 lg:text-left">
          No invite yet?{' '}
          <Link
            href="/"
            className="text-accent/80 underline-offset-2 transition-colors hover:text-accent hover:underline"
          >
            join the waitlist
          </Link>
        </p>
      </div>

      {/* ── RIGHT · aesthetic artwork (crossfades with theme) ─── */}
      <div className="relative order-first h-48 sm:h-64 lg:order-last lg:h-auto">
        <Image
          src="/login/aesthetic-dark.jpeg"
          alt="Pixel-art Golden Gate Bridge at dusk"
          fill
          priority
          sizes="(min-width: 1024px) 44rem, 100vw"
          className={`object-cover transition-opacity duration-700 ease-in-out ${
            isLight ? 'opacity-0' : 'opacity-100'
          }`}
        />
        <Image
          src="/login/aesthetic-light.jpeg"
          alt="Pixel-art classical palace under a blue sky"
          fill
          priority
          sizes="(min-width: 1024px) 44rem, 100vw"
          className={`object-cover transition-opacity duration-700 ease-in-out ${
            isLight ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {/* soft blend into the card on large screens */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 hidden w-16 bg-gradient-to-r from-zinc-950 to-transparent transition-colors duration-500 lg:block"
        />
      </div>

      <style jsx>{`
        .login-shell {
          animation: login-shell-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .login-diode {
          animation: login-diode 1.8s ease-in-out infinite;
        }
        @keyframes login-shell-in {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.995);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes login-diode {
          0%,
          100% {
            opacity: 0.4;
          }
          50% {
            opacity: 1;
            box-shadow: 0 0 8px rgb(var(--accent-rgb) / 0.8);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .login-shell,
          .login-diode {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}

function GithubIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function Spinner() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black"
      aria-hidden
    />
  )
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 transition-colors duration-500 sm:p-6 lg:p-10">
      <Suspense fallback={null}>
        <LoginSplit />
      </Suspense>
    </main>
  )
}
