'use client'

import {
  ClipboardEvent,
  FormEvent,
  Fragment,
  KeyboardEvent,
  ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LiquidMark } from '@/components/brand/LiquidMark'

type Mode = 'signin' | 'register'
type Phase = 'idle' | 'checking' | 'granted'
type Provider = 'github' | 'twitter'

const PROVIDER_LABEL: Record<Provider, string> = {
  github: 'GitHub',
  twitter: 'X'
}

const ERROR_MESSAGES: Record<string, string> = {
  invite_required: 'No cribble account found for that login. Redeem an invite key below.',
  invite_invalid: 'That key is invalid, expired, or already used.',
  invite_check_failed: 'We could not verify your key. Please try again.',
  github_oauth_denied: 'GitHub sign-in was cancelled. Try again when you are ready.',
  twitter_oauth_denied: 'X sign-in was cancelled. Try again when you are ready.',
  twitter_not_configured: 'X sign-in is not available right now. Use GitHub instead.',
  session_creation_failed: 'Something went wrong creating your session. Please try again.',
  github_rate_limited: 'Too many sign-in attempts. Wait a few minutes and try again.',
  twitter_rate_limited: 'Too many sign-in attempts. Wait a few minutes and try again.',
  account_banned: 'This account has been banned. Contact support if you believe this is a mistake.'
}

const GENERIC_GITHUB_ERROR = 'GitHub sign-in failed. Please try again in a moment.'
const GENERIC_TWITTER_ERROR = 'X sign-in failed. Please try again in a moment.'
const INVITE_ERRORS = new Set(['invite_required', 'invite_invalid', 'invite_check_failed'])

/** Invite keys are always CRIB-XXXX-XXXX; the UI collects the 8 payload chars. */
const KEY_LENGTH = 8
const KEY_PREFIX = 'CRIB'

function resolveErrorMessage(errorKey: string | null): string | null {
  if (!errorKey) return null
  if (ERROR_MESSAGES[errorKey]) return ERROR_MESSAGES[errorKey]
  if (errorKey.startsWith('github_') || errorKey.startsWith('session_')) {
    return GENERIC_GITHUB_ERROR
  }
  if (errorKey.startsWith('twitter_')) {
    return GENERIC_TWITTER_ERROR
  }
  return null
}

/** Uppercase and keep only characters that can appear in a key payload. */
function cleanKeyChars(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Prepare pasted text for the cells: strip the CRIB prefix when the paste
 * looks like a full code (12+ chars), so "CRIB-ABCD-EFGH" fills perfectly.
 */
function preparePaste(raw: string): string {
  let s = cleanKeyChars(raw)
  if (s.startsWith(KEY_PREFIX) && s.length >= KEY_PREFIX.length + KEY_LENGTH) {
    s = s.slice(KEY_PREFIX.length)
  }
  return s.slice(0, KEY_LENGTH)
}

function LoginExperience() {
  const searchParams = useSearchParams()

  const errorKey = searchParams.get('error')
  const urlError = useMemo(() => resolveErrorMessage(errorKey), [errorKey])
  const isInviteError = errorKey !== null && INVITE_ERRORS.has(errorKey)

  const [mode, setMode] = useState<Mode>(isInviteError ? 'register' : 'signin')
  const [chars, setChars] = useState<string[]>(Array(KEY_LENGTH).fill(''))
  const [phase, setPhase] = useState<Phase>('idle')
  // Which provider button kicked off a redirect (signin or claim), if any.
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)

  const cellRefs = useRef<Array<HTMLInputElement | null>>([])
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({
    signin: null,
    register: null
  })
  const lastAutoTriedRef = useRef('')
  const pendingCellFocusRef = useRef(false)

  const signinBusy = busyProvider !== null
  const busy = phase !== 'idle' || signinBusy
  const complete = chars.every(Boolean)
  const filledCount = chars.filter(Boolean).length

  // A URL error belongs to the flow the failure came from.
  const activeError =
    localError ??
    (urlError && (isInviteError ? mode === 'register' : mode === 'signin') ? urlError : null)

  // Granted keys aren't consumed until an OAuth callback succeeds, so it's
  // safe to let the user back out of the provider choice via the tabs.
  const tabsLocked = signinBusy || phase === 'checking'

  const switchMode = (next: Mode, focusTab = false) => {
    if (tabsLocked || next === mode) return
    if (phase === 'granted') setPhase('idle')
    setMode(next)
    setLocalError(null)
    setShaking(false)
    if (next === 'register') pendingCellFocusRef.current = true
    if (focusTab) tabRefs.current[next]?.focus()
  }

  // Focus the first empty cell after a user-initiated switch to register —
  // never on initial load, so mobile keyboards don't pop uninvited.
  useEffect(() => {
    if (mode !== 'register' || !pendingCellFocusRef.current) return
    pendingCellFocusRef.current = false
    const first = chars.findIndex((c) => !c)
    focusCell(first === -1 ? KEY_LENGTH - 1 : first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const focusCell = (i: number) => {
    const el = cellRefs.current[Math.max(0, Math.min(KEY_LENGTH - 1, i))]
    el?.focus()
    el?.select()
  }

  const fillFrom = (start: number, payload: string) => {
    if (!payload) return
    setChars((prev) => {
      const next = [...prev]
      for (let k = 0; k < payload.length && start + k < KEY_LENGTH; k++) {
        next[start + k] = payload[k]
      }
      return next
    })
    setLocalError(null)
    focusCell(Math.min(start + payload.length, KEY_LENGTH - 1))
  }

  const handleCellChange = (i: number, value: string) => {
    const cleaned = cleanKeyChars(value)
    if (cleaned.length === 0) {
      setChars((prev) => {
        const next = [...prev]
        next[i] = ''
        return next
      })
      return
    }
    if (cleaned.length > 1) {
      // Multi-char input (IME / autofill paste path without a clipboard event).
      const payload = preparePaste(value)
      fillFrom(payload.length >= KEY_LENGTH ? 0 : i, payload)
      return
    }
    setChars((prev) => {
      const next = [...prev]
      next[i] = cleaned
      return next
    })
    setLocalError(null)
    if (i < KEY_LENGTH - 1) focusCell(i + 1)
  }

  const handleCellKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      e.preventDefault()
      setChars((prev) => {
        const next = [...prev]
        next[i - 1] = ''
        return next
      })
      focusCell(i - 1)
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      focusCell(i - 1)
    } else if (e.key === 'ArrowRight' && i < KEY_LENGTH - 1) {
      e.preventDefault()
      focusCell(i + 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusCell(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusCell(KEY_LENGTH - 1)
    }
  }

  const handleCellPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const payload = preparePaste(e.clipboardData.getData('text'))
    fillFrom(payload.length >= KEY_LENGTH ? 0 : i, payload)
  }

  const signIn = (provider: Provider) => {
    if (busy) return
    setBusyProvider(provider)
    window.location.href = `/api/auth/${provider}`
  }

  // After a key is granted: claim the seat with the chosen provider. The
  // callback re-validates and atomically consumes the key server-side.
  const claimSeat = (provider: Provider) => {
    if (signinBusy || phase !== 'granted') return
    setBusyProvider(provider)
    const payload = chars.join('')
    const code = `${KEY_PREFIX}-${payload.slice(0, 4)}-${payload.slice(4)}`
    window.location.href = `/api/auth/${provider}?invite=${encodeURIComponent(code)}`
  }

  const fail = (message: string) => {
    setLocalError(message)
    setPhase('idle')
    setShaking(true)
  }

  const redeem = async (e?: FormEvent) => {
    e?.preventDefault()
    if (phase !== 'idle' || signinBusy || !complete) return
    const payload = chars.join('')
    const code = `${KEY_PREFIX}-${payload.slice(0, 4)}-${payload.slice(4)}`
    lastAutoTriedRef.current = payload
    setPhase('checking')
    setLocalError(null)
    try {
      // UX pre-check only; the OAuth callback re-validates and atomically
      // consumes the key server-side.
      const res = await fetch('/api/auth/invite/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      if (res.status === 429) {
        fail('Too many attempts. Wait a minute and try again.')
        return
      }
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        fail('Could not verify the key right now. Please try again.')
        return
      }
      if (!data?.valid) {
        fail(ERROR_MESSAGES.invite_invalid)
        return
      }
      setPhase('granted')
    } catch {
      fail('Network error. Please try again.')
    }
  }

  // The magic moment: typing or pasting the final character verifies the key
  // on its own. Failed keys only re-verify after the user edits them.
  useEffect(() => {
    if (mode !== 'register' || phase !== 'idle' || signinBusy) return
    if (!complete) return
    const payload = chars.join('')
    if (payload === lastAutoTriedRef.current) return
    redeem()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars, mode, phase, signinBusy, complete])

  const handleTablistKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      switchMode(mode === 'signin' ? 'register' : 'signin', true)
    }
  }

  const statusText =
    phase === 'checking'
      ? 'Verifying invite key'
      : phase === 'granted'
        ? 'Key accepted. Choose GitHub or X to continue.'
        : ''

  return (
    <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[28.5rem] flex-col justify-center px-5 pb-24 pt-28 sm:px-6">
      <span className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>

      {/* eyebrow */}
      <p
        className="lg-rise flex items-center gap-2.5 font-mono text-[10px] tracking-[0.32em] text-zinc-500"
        style={{ ['--d' as string]: '0ms' }}
      >
        <span className="lg-diode h-1.5 w-1.5 rounded-full bg-accent" />
        PRIVATE BETA · INVITE ONLY
      </p>

      {/* headline — editorial serif, swaps with the mode */}
      <h1
        className="lg-rise mt-5 font-serif text-[2.7rem] leading-[1.05] text-zinc-300 sm:text-5xl"
        style={{ ['--d' as string]: '80ms' }}
      >
        <span key={mode} className="lg-swap block">
          {mode === 'signin' ? (
            <>
              back to the <Emph>grind</Emph>.
            </>
          ) : (
            <>
              you were <Emph>invited</Emph>.
            </>
          )}
        </span>
      </h1>

      <p
        className="lg-rise mt-4 max-w-sm text-sm leading-relaxed text-zinc-500"
        style={{ ['--d' as string]: '150ms' }}
      >
        <span key={mode} className="lg-swap block">
          {mode === 'signin'
            ? 'Pick up where you left off — sign in with the GitHub or X account tied to your cribble profile.'
            : 'Every seat is claimed with a key. Enter yours, link GitHub or X once, and you\u2019re on the board.'}
        </span>
      </p>

      {/* auth panel */}
      <section
        className="lg-rise glass-pop mt-9 rounded-2xl"
        style={{ ['--d' as string]: '230ms' }}
      >
        {/* mode switch — sliding pill */}
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          <div
            role="tablist"
            aria-label="Sign in or redeem an invite key"
            onKeyDown={handleTablistKeyDown}
            className="relative grid grid-cols-2 rounded-full border border-zinc-800/80 bg-black/30 p-1"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                transform: mode === 'register' ? 'translateX(100%)' : 'translateX(0)'
              }}
            />
            {(
              [
                { id: 'signin', label: 'SIGN IN' },
                { id: 'register', label: 'REDEEM KEY' }
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el
                }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={mode === id}
                aria-controls={`panel-${id}`}
                tabIndex={mode === id ? 0 : -1}
                disabled={tabsLocked}
                onClick={() => switchMode(id)}
                className={`relative z-10 rounded-full px-3 py-2 font-mono text-[10px] tracking-[0.22em] transition-colors duration-300 disabled:cursor-not-allowed ${
                  mode === id ? 'text-black' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* panel body — height animates between modes */}
        <PanelHeightAnimator>
          <div key={mode} className="lg-swap p-5 sm:p-6">
            {activeError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-rose-400"
              >
                {activeError}
              </div>
            )}

            {mode === 'signin' ? (
              <div role="tabpanel" id="panel-signin" aria-labelledby="tab-signin">
                <ProviderButtons
                  onSelect={signIn}
                  busyProvider={busyProvider}
                  disabled={busy}
                />
                <p className="mt-4 text-center text-xs text-zinc-500">
                  First time here?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="text-zinc-300 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent/60"
                  >
                    Redeem an invite key
                  </button>
                </p>
              </div>
            ) : (
              <form
                role="tabpanel"
                id="panel-register"
                aria-labelledby="tab-register"
                onSubmit={redeem}
              >
                <div className="flex items-baseline justify-between">
                  <label
                    htmlFor="key-cell-0"
                    className="font-mono text-[10px] tracking-[0.28em] text-zinc-500"
                  >
                    INVITE KEY
                  </label>
                  <span className="font-mono text-[10px] tabular-nums tracking-[0.2em] text-zinc-600">
                    {filledCount}/{KEY_LENGTH}
                  </span>
                </div>

                {/* CRIB-····-···· segmented key */}
                <div
                  onAnimationEnd={() => setShaking(false)}
                  className={`mt-2.5 flex items-center gap-1 sm:gap-1.5 ${
                    shaking ? 'lg-shake' : ''
                  }`}
                >
                  <span className="flex h-11 shrink-0 select-none items-center rounded-lg border border-zinc-800 bg-black/30 px-1.5 font-mono text-xs tracking-[0.08em] text-zinc-500 sm:h-12 sm:px-2 sm:text-sm">
                    {KEY_PREFIX}
                  </span>
                  {chars.map((char, i) => (
                    <Fragment key={i}>
                      {i === 4 && <span className="h-px w-2 shrink-0 bg-zinc-700" />}
                      <input
                        ref={(el) => {
                          cellRefs.current[i] = el
                        }}
                        id={`key-cell-${i}`}
                        value={char}
                        onChange={(e) => handleCellChange(i, e.target.value)}
                        onKeyDown={(e) => handleCellKeyDown(i, e)}
                        onPaste={(e) => handleCellPaste(i, e)}
                        onFocus={(e) => e.target.select()}
                        readOnly={busy}
                        maxLength={KEY_LENGTH}
                        inputMode="text"
                        autoCapitalize="characters"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`Invite key character ${i + 1} of ${KEY_LENGTH}`}
                        aria-invalid={!!activeError}
                        className={`h-11 min-w-0 flex-1 rounded-lg border bg-black/30 text-center font-mono text-base uppercase text-zinc-50 outline-none transition-[border-color,box-shadow,color] duration-200 focus:ring-1 sm:h-12 sm:text-lg ${
                          activeError
                            ? 'caret-rose-400 focus:border-rose-400/70 focus:shadow-[0_0_14px_rgb(244,63,94,0.14)] focus:ring-rose-400/30'
                            : 'caret-accent focus:border-accent/60 focus:shadow-[0_0_14px_rgb(var(--accent-rgb)/0.14)] focus:ring-accent/30'
                        } ${
                          phase === 'granted'
                            ? 'lg-cell-granted'
                            : activeError
                              ? 'border-rose-500/50'
                              : char
                                ? 'border-zinc-600'
                                : 'border-zinc-800'
                        }`}
                        style={
                          phase === 'granted'
                            ? { animationDelay: `${i * 45}ms` }
                            : undefined
                        }
                      />
                    </Fragment>
                  ))}
                </div>

                {phase === 'granted' ? (
                  // Key accepted — beta access unlocked. The seat is claimed by
                  // linking either provider; the callback consumes the key.
                  <div className="lg-swap mt-4">
                    <p className="flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.24em] text-accent">
                      <CheckIcon className="h-3.5 w-3.5" />
                      KEY ACCEPTED — CLAIM YOUR SEAT
                    </p>
                    <ProviderButtons
                      onSelect={claimSeat}
                      busyProvider={busyProvider}
                      disabled={signinBusy}
                      className="mt-3"
                    />
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={busy || !complete}
                    className={`lg-sheen mt-4 flex w-full items-center justify-center gap-2.5 rounded-xl px-6 py-3.5 text-sm font-semibold transition-all duration-300 disabled:cursor-not-allowed ${
                      phase === 'checking'
                        ? 'bg-white text-black opacity-80'
                        : complete
                          ? 'bg-white text-black hover:enabled:-translate-y-px active:enabled:translate-y-0'
                          : 'border border-zinc-800 bg-transparent text-zinc-500'
                    }`}
                  >
                    {phase === 'checking' ? <Spinner /> : <KeyIcon />}
                    {phase === 'checking' ? 'Verifying key…' : 'Redeem invite key'}
                  </button>
                )}

                <p className="mt-4 text-center text-xs text-zinc-500">
                  Already on the board?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="text-zinc-300 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent/60"
                  >
                    Sign in
                  </button>
                </p>
              </form>
            )}
          </div>
        </PanelHeightAnimator>
      </section>

      <p
        className="lg-rise mt-6 text-xs text-zinc-500"
        style={{ ['--d' as string]: '320ms' }}
      >
        No key yet?{' '}
        <Link
          href="/"
          className="text-zinc-300 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent/60"
        >
          Join the waitlist
        </Link>
        <span className="text-zinc-600"> — seats open in waves.</span>
      </p>
    </div>
  )
}

/** Emphasized serif word with the landing page's accent underline motif. */
function Emph({ children }: { children: ReactNode }) {
  return <em className="lg-emph relative text-zinc-50">{children}</em>
}

/**
 * The two OAuth entry points, stacked. GitHub keeps top billing; X sits
 * below in a quieter shell. Both flows are invite-gated server-side, so
 * this is purely a "which account do you want to link" choice.
 */
function ProviderButtons({
  onSelect,
  busyProvider,
  disabled,
  className = ''
}: {
  onSelect: (provider: Provider) => void
  busyProvider: Provider | null
  disabled: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => onSelect('github')}
        disabled={disabled}
        className="lg-sheen flex w-full items-center justify-center gap-2.5 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-black transition-[transform,opacity] duration-300 hover:enabled:-translate-y-px active:enabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busyProvider === 'github' ? <Spinner /> : <GithubIcon />}
        {busyProvider === 'github'
          ? `Opening ${PROVIDER_LABEL.github}…`
          : `Continue with ${PROVIDER_LABEL.github}`}
      </button>
      <button
        type="button"
        onClick={() => onSelect('twitter')}
        disabled={disabled}
        className="lg-sheen mt-2.5 flex w-full items-center justify-center gap-2.5 rounded-xl border border-zinc-700 bg-black/30 px-6 py-3.5 text-sm font-semibold text-zinc-100 transition-[transform,opacity,border-color] duration-300 hover:enabled:-translate-y-px hover:enabled:border-zinc-500 active:enabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busyProvider === 'twitter' ? <SpinnerLight /> : <XIcon />}
        {busyProvider === 'twitter'
          ? `Opening ${PROVIDER_LABEL.twitter}…`
          : `Continue with ${PROVIDER_LABEL.twitter}`}
      </button>
    </div>
  )
}

/**
 * Animates its height to follow the active child (mode panels differ in
 * height, and error strips come and go). Content overflow is clipped, so the
 * inner wrapper owns the panel padding to give focus glows breathing room.
 */
function PanelHeightAnimator({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const update = () => setHeight(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      className="overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ height: height !== undefined ? `${height}px` : 'auto' }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  )
}

function GithubIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.8l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  )
}

function CheckIcon({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
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

/** Spinner variant for dark buttons where the black track is invisible. */
function SpinnerLight() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-100/20 border-t-zinc-100"
      aria-hidden
    />
  )
}

export default function LoginPage() {
  return (
    <main className="dossier-canvas relative min-h-screen bg-background text-foreground selection:bg-accent/20">
      <SpaceBackdrop />

      {/* ── atmosphere: orbit ring + planet limb on the horizon ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
        {/* slowly rotating dashed orbit behind the panel */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className="lg-orbit relative rounded-full"
            style={{
              width: 'min(1060px, 150vw)',
              aspectRatio: '1',
              border: '1px dashed rgb(var(--star-rgb) / 0.07)'
            }}
          >
            <span
              className="absolute left-1/2 top-0 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background: 'rgb(var(--star-rgb) / 0.8)',
                boxShadow: '0 0 6px rgb(var(--star-rgb) / 0.6)'
              }}
            />
          </div>
        </div>

        {/* dawn glow rising from below the fold */}
        <div
          className="absolute inset-x-0 bottom-0 h-[46vh]"
          style={{
            background:
              'radial-gradient(88% 100% at 50% 118%, rgb(var(--accent-rgb) / 0.09), rgb(var(--accent-rgb) / 0.028) 46%, transparent 72%)'
          }}
        />
        {/* planet limb — a vast circle whose top edge peeks over the bottom */}
        <div
          className="absolute left-1/2 aspect-square w-[300vw] max-w-none -translate-x-1/2 rounded-full"
          style={{
            top: '93vh',
            border: '1px solid rgb(var(--star-rgb) / 0.10)',
            boxShadow:
              '0 -30px 90px rgb(var(--accent-rgb) / 0.05), inset 0 30px 60px rgb(var(--star-rgb) / 0.03)'
          }}
        />
      </div>

      {/* ── chrome ── */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-5 sm:px-8 sm:py-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-mono text-sm font-semibold tracking-[0.4em] text-zinc-100"
        >
          <LiquidMark size={22} />
          <span>
            CRIBBLE<span className="text-accent">.</span>
          </span>
        </Link>
        <ThemeToggle />
      </header>

      <Suspense fallback={null}>
        <LoginExperience />
      </Suspense>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 hidden items-center justify-between px-8 pb-6 font-mono text-[10px] tracking-[0.3em] text-zinc-600 sm:flex">
        <span className="lg-rise" style={{ ['--d' as string]: '420ms' }}>
          CRIBBLE · {new Date().getFullYear()}
        </span>
        <span className="lg-rise text-zinc-700" style={{ ['--d' as string]: '480ms' }}>
          {'// no bots beyond this point'}
        </span>
      </div>

      <style jsx global>{`
        /* entrance cascade — rise + unblur, staggered via --d */
        @keyframes lg-rise-in {
          from {
            opacity: 0;
            transform: translateY(14px);
            filter: blur(6px);
          }
        }
        .lg-rise {
          animation: lg-rise-in 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
          animation-delay: var(--d, 0ms);
        }

        /* mode swap — content crossfades in while the panel height eases */
        @keyframes lg-swap-in {
          from {
            opacity: 0;
            transform: translateY(9px);
            filter: blur(5px);
          }
        }
        .lg-swap {
          animation: lg-swap-in 340ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        /* accent underline under the emphasized serif word */
        .lg-emph::after {
          content: '';
          position: absolute;
          left: 0;
          right: 2px;
          bottom: -4px;
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            rgb(var(--accent-rgb) / 0.8),
            rgb(var(--accent-rgb) / 0.08)
          );
          box-shadow: 0 0 14px rgb(var(--accent-rgb) / 0.35);
          pointer-events: none;
        }

        .lg-diode {
          animation: lg-diode 2.2s ease-in-out infinite;
        }
        @keyframes lg-diode {
          0%,
          100% {
            opacity: 0.35;
          }
          50% {
            opacity: 1;
            box-shadow: 0 0 10px rgb(var(--accent-rgb) / 0.8);
          }
        }

        .lg-orbit {
          animation: lg-orbit-spin 90s linear infinite;
        }
        @keyframes lg-orbit-spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* rejected key — quick lateral shake on the cell row */
        @keyframes lg-shake-kf {
          10%,
          90% {
            transform: translateX(-1px);
          }
          20%,
          80% {
            transform: translateX(2px);
          }
          30%,
          50%,
          70% {
            transform: translateX(-3px);
          }
          40%,
          60% {
            transform: translateX(3px);
          }
        }
        .lg-shake {
          animation: lg-shake-kf 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
        }

        /* accepted key — cells ignite one by one (delay set inline) */
        @keyframes lg-cell-grant-kf {
          0% {
            border-color: rgb(var(--accent-rgb) / 0.2);
          }
          45% {
            border-color: rgb(var(--accent-rgb) / 0.9);
            color: var(--accent);
            box-shadow: 0 0 18px rgb(var(--accent-rgb) / 0.35);
            transform: translateY(-2px);
          }
          100% {
            border-color: rgb(var(--accent-rgb) / 0.55);
            color: var(--accent);
            box-shadow: 0 0 10px rgb(var(--accent-rgb) / 0.18);
            transform: none;
          }
        }
        .lg-cell-granted {
          animation: lg-cell-grant-kf 620ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        /* light sweep across the primary buttons on hover */
        .lg-sheen {
          position: relative;
          overflow: hidden;
        }
        .lg-sheen::after {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: -45%;
          width: 40%;
          transform: skewX(-18deg);
          background: linear-gradient(
            90deg,
            transparent,
            rgb(var(--c-black) / 0.07),
            transparent
          );
          transition: left 0.5s ease;
          pointer-events: none;
        }
        .lg-sheen:hover::after {
          left: 120%;
        }

        @media (prefers-reduced-motion: reduce) {
          .lg-rise,
          .lg-swap,
          .lg-diode,
          .lg-orbit,
          .lg-shake,
          .lg-cell-granted {
            animation: none;
          }
          .lg-cell-granted {
            border-color: rgb(var(--accent-rgb) / 0.55);
            color: var(--accent);
          }
          .lg-sheen::after {
            display: none;
          }
        }
      `}</style>
    </main>
  )
}
