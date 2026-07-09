'use client'

import { useEffect } from 'react'

import { accentA } from '@/lib/theme'
// Amber CRT tone for the "not ready / standby" state — deliberately distinct
// from the green "live" signal used everywhere else on the site.
const STANDBY_AMBER = '#f5a524'

type ProviderState = 'standby' | 'offline'

const PROVIDERS: { label: string; state: ProviderState }[] = [
  { label: 'GITHUB_OAUTH', state: 'standby' },
  { label: 'X / TWITTER', state: 'offline' },
  { label: 'GOOGLE', state: 'offline' }
]

/* ============================================================
   STATUS BOARD — the terminal readout. Reused inline (/login)
   and inside the popup. Lines reveal on a stagger like a real
   service health check printing to stdout.
   ============================================================ */

export function AuthStatusBoard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="auth-board rounded-md border bg-black/60 font-mono"
      style={{ borderColor: `${STANDBY_AMBER}33` }}
    >
      {/* fake window chrome / command line */}
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: `${STANDBY_AMBER}22` }}
      >
        <span className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span
            className="auth-diode h-2 w-2 rounded-full"
            style={{ background: STANDBY_AMBER }}
          />
        </span>
        <span className="text-[10px] tracking-[0.3em] text-zinc-500">
          cribble@auth-gateway
        </span>
      </div>

      <div className={`space-y-1.5 px-4 ${compact ? 'py-3' : 'py-4'}`}>
        <div className="text-[11px] text-zinc-500">
          <span style={{ color: STANDBY_AMBER }}>$</span> cribble auth
          --status
        </div>

        <AuthLine delay={0.15}>
          <span className="text-zinc-500">resolving identity service</span>
          <Dots />
          <span className="text-zinc-300">ok</span>
        </AuthLine>

        <AuthLine delay={0.5}>
          <span className="text-zinc-500">requesting public handshake</span>
          <Dots />
          <span style={{ color: '#fb7185' }}>refused</span>
        </AuthLine>

        {!compact &&
          PROVIDERS.map((p, i) => (
            <AuthLine key={p.label} delay={0.85 + i * 0.18}>
              <span className="text-zinc-400">{p.label}</span>
              <Dots />
              <ProviderTag state={p.state} />
            </AuthLine>
          ))}

        <AuthLine delay={compact ? 0.85 : 1.5}>
          <span
            className="auth-blink"
            style={{ color: STANDBY_AMBER }}
          >
            ◌
          </span>
          <span
            className="ml-2 tracking-[0.18em]"
            style={{ color: STANDBY_AMBER }}
          >
            LOGIN IS NOT LIVE YET
          </span>
        </AuthLine>
      </div>

      <style jsx>{`
        .auth-board {
          box-shadow: 0 0 0 1px rgba(245, 165, 36, 0.04),
            0 20px 60px rgba(0, 0, 0, 0.5);
        }
        .auth-diode {
          animation: auth-diode 1.6s ease-in-out infinite;
        }
        @keyframes auth-diode {
          0%,
          100% {
            opacity: 0.35;
            box-shadow: 0 0 0 ${STANDBY_AMBER};
          }
          50% {
            opacity: 1;
            box-shadow: 0 0 8px ${STANDBY_AMBER}cc;
          }
        }
        .auth-blink {
          animation: auth-blink 1.1s steps(2) infinite;
        }
        @keyframes auth-blink {
          0%,
          50% {
            opacity: 1;
          }
          51%,
          100% {
            opacity: 0.2;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .auth-diode,
          .auth-blink {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}

function AuthLine({
  delay,
  children
}: {
  delay: number
  children: React.ReactNode
}) {
  return (
    <div
      className="auth-line flex items-center text-[11px] leading-relaxed"
      style={{ animationDelay: `${delay}s` }}
    >
      <span className="mr-2 select-none" style={{ color: `${STANDBY_AMBER}aa` }}>
        {'>'}
      </span>
      {children}
      <style jsx>{`
        .auth-line {
          opacity: 0;
          animation: auth-line-in 0.4s ease-out forwards;
        }
        @keyframes auth-line-in {
          from {
            opacity: 0;
            transform: translateX(-6px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .auth-line {
            opacity: 1;
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}

function Dots() {
  return (
    <span className="mx-2 flex-1 select-none overflow-hidden text-zinc-700">
      ......................................
    </span>
  )
}

function ProviderTag({ state }: { state: ProviderState }) {
  const isStandby = state === 'standby'
  const color = isStandby ? STANDBY_AMBER : 'rgb(var(--z500))'
  return (
    <span
      className="whitespace-nowrap rounded-sm border px-1.5 py-px text-[9px] tracking-[0.2em]"
      style={{ color, borderColor: `${color}55` }}
    >
      {isStandby ? 'STANDBY' : 'OFFLINE'}
    </span>
  )
}

/* ============================================================
   STATUS PILL — small clickable inline indicator
   ============================================================ */

export function AuthStatusPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] tracking-[0.25em] transition-colors"
      style={{ borderColor: `${STANDBY_AMBER}40`, color: `${STANDBY_AMBER}cc` }}
    >
      <span
        className="auth-pill-dot h-1.5 w-1.5 rounded-full"
        style={{ background: STANDBY_AMBER }}
      />
      AUTH · OFFLINE
      <span className="text-zinc-600 group-hover:text-zinc-400">ⓘ</span>
      <style jsx>{`
        .auth-pill-dot {
          animation: auth-pill-dot 1.6s ease-in-out infinite;
        }
        @keyframes auth-pill-dot {
          0%,
          100% {
            opacity: 0.4;
          }
          50% {
            opacity: 1;
            box-shadow: 0 0 8px ${STANDBY_AMBER}cc;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .auth-pill-dot {
            animation: none !important;
          }
        }
      `}</style>
    </button>
  )
}

/* ============================================================
   STATUS MODAL — popup shown when a visitor tries to sign in
   ============================================================ */

export function AuthStatusModal({
  onClose,
  onJoinWaitlist
}: {
  onClose: () => void
  onJoinWaitlist?: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-status-title"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="auth-fade absolute inset-0 bg-black/75 backdrop-blur-sm"
      />

      <div
        className="auth-pop relative w-full max-w-md rounded-xl border border-white/10 p-6"
        style={{
          background: 'linear-gradient(180deg, var(--panel) 0%, var(--background) 100%)',
          boxShadow:
            '0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.02), 0 0 60px rgba(245,165,36,0.05)'
        }}
      >
        <div className="flex items-center justify-between">
          <span
            className="inline-flex items-center gap-2 rounded-full border bg-zinc-950 px-2.5 py-1 text-[10px] tracking-[0.3em]"
            style={{
              borderColor: `${STANDBY_AMBER}40`,
              color: `${STANDBY_AMBER}cc`
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: STANDBY_AMBER,
                boxShadow: `0 0 8px ${STANDBY_AMBER}b0`
              }}
            />
            SYSTEM NOTICE
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-lg leading-none text-zinc-500 transition-colors hover:text-zinc-200"
          >
            ×
          </button>
        </div>

        <h2
          id="auth-status-title"
          className="mt-5 text-2xl font-semibold tracking-tight text-zinc-50"
        >
          Sign-in isn&apos;t open yet.
        </h2>
        <p className="mt-1.5 text-sm text-zinc-400">
          cribble is in private beta. Accounts are sealed until we open the
          gates — here&apos;s the live status.
        </p>

        <div className="mt-5">
          <AuthStatusBoard />
        </div>

        {onJoinWaitlist && (
          <button
            onClick={onJoinWaitlist}
            className="group mt-5 flex w-full items-center justify-center gap-2.5 rounded-md bg-white px-4 py-3 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
          >
            <span>Get notified when it opens</span>
            <span className="text-zinc-500 transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </button>
        )}

        <p
          className="mt-4 text-center text-[10px] tracking-[0.25em]"
          style={{ color: `${accentA(0.53)}` }}
        >
          {'// see you on the board soon'}
        </p>

        <style jsx>{`
          .auth-fade {
            animation: auth-fade-in 200ms ease-out both;
          }
          .auth-pop {
            animation: auth-pop-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          @keyframes auth-fade-in {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
          @keyframes auth-pop-in {
            from {
              opacity: 0;
              transform: translateY(6px) scale(0.985);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .auth-fade,
            .auth-pop {
              animation: none;
            }
          }
        `}</style>
      </div>
    </div>
  )
}
