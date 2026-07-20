'use client'

// Referral plate + modal — the profile's recruit CTA, owner-only.
//
// The plate is deliberately the loudest element on the page: a
// slot-machine marquee where the two stars ("INVITE A FRIEND" and the
// +500 numeral) breathe on offset phases, ringed by a slow conic
// highlight and a periodic sheen glint (keyframes live in globals.css,
// all gated on prefers-reduced-motion). The palette is an electric-lime
// duotone scoped to .referral-scope (--ref-lime) — deliberately not the
// site accent, so the plate reads as its own machine; the light theme
// swaps in a darkened chartreuse ink that holds on cream.
//
// The modal fetches /api/user/referral lazily on first open; the
// plate never blocks on the network. Reward mechanics for the copy:
// +500 PTS per activated friend, first 10 count, and the grant fires
// when the friend's extension syncs its first real activity.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SocialIcon } from '@/components/leaderboard/icons'

const REFERRAL_POINTS = 500
const REFERRAL_CAP = 10

interface ReferralData {
  code: string
  link: string
  stats: {
    joined: number
    rewarded: number
    pointsEarned: number
    capRemaining: number
  }
}

const inviteText = (link: string) =>
  `cribble puts your AI coding hours on a live leaderboard. Mine are already on the board — join through my invite and try to outrank me:\n\n${link}`

export function ReferralPlate() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<ReferralData | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    fetch('/api/user/referral', { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('referral fetch failed'))))
      .then((d) => {
        if (typeof d?.link !== 'string' || !d?.stats) throw new Error('referral fetch failed')
        setData(d as ReferralData)
      })
      .catch(() => setFailed(true))
  }, [])

  // Lazy fetch: the link is only needed once the modal opens, and the
  // result is kept so reopening is instant.
  useEffect(() => {
    if (open && !data && !failed) load()
  }, [open, data, failed, load])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="referral-scope referral-plate group relative block w-full overflow-hidden rounded-2xl p-px text-left transition-transform duration-300 hover:-translate-y-0.5"
        aria-haspopup="dialog"
      >
        {/* orbiting conic comet — geometry lives in .referral-ring (a centered
            square sized to cover the plate's diagonal at every angle) */}
        <span aria-hidden className="referral-ring" />

        {/* opaque glass surface so the ring reads as a 1px border */}
        <span className="referral-surface relative block overflow-hidden rounded-[calc(1rem-1px)]">
          <span className="relative flex items-center justify-between gap-3 px-5 py-4 sm:gap-4 sm:px-6">
            <span className="min-w-0">
              <span className="flex items-center gap-2.5">
                <span className="ref-dot h-1.5 w-1.5 rounded-full" />
                <span className="text-[10px] tracking-[0.4em] text-zinc-400">
                  RECRUIT A PILOT
                </span>
              </span>
              {/* marquee star A */}
              <span className="ref-star ref-star-a mt-2.5 block truncate whitespace-nowrap text-[clamp(11px,3.6vw,17px)] leading-none [font-family:var(--font-pixel)] sm:text-[17px]">
                INVITE A FRIEND
              </span>
              <span className="mt-2 block truncate whitespace-nowrap text-[9px] tracking-[0.18em] text-zinc-500 transition-colors group-hover:text-[rgb(var(--ref-lime))] sm:tracking-[0.25em]">
                TAP FOR YOUR INVITE LINK →
              </span>
            </span>
            <span className="shrink-0 text-right">
              {/* marquee star B — breathes a half-cycle after star A */}
              <span className="ref-star ref-star-b block whitespace-nowrap text-[21px] leading-none [font-family:var(--font-pixel)] sm:text-[30px]">
                +{REFERRAL_POINTS}
              </span>
              <span className="mt-2 block whitespace-nowrap text-[9px] tracking-[0.2em] text-zinc-500 sm:tracking-[0.3em]">
                PTS PER RECRUIT
              </span>
            </span>
          </span>

          {/* periodic diagonal sheen sweep */}
          <span aria-hidden className="referral-sheen" />
        </span>
      </button>

      {open && (
        <ReferralModal data={data} failed={failed} onRetry={load} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

/* ================= modal ================= */

function ReferralModal({
  data,
  failed,
  onRetry,
  onClose
}: {
  data: ReferralData | null
  failed: boolean
  onRetry: () => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const copy = useCallback(() => {
    if (!data) return
    void navigator.clipboard?.writeText(data.link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }, [data])

  const postOnX = useCallback(() => {
    if (!data) return
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(inviteText(data.link))}`,
      '_blank',
      'noopener,noreferrer'
    )
  }, [data])

  const rewarded = data?.stats.rewarded ?? 0
  const capPct = Math.min(100, (rewarded / REFERRAL_CAP) * 100)

  return createPortal(
    <div
      className="referral-scope fixed inset-0 z-[80] flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label="Recruit a pilot"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl glass-pop"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        {/* ---------- header ---------- */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="ref-dot h-1.5 w-1.5 rounded-full" />
            <span className="text-[10px] tracking-[0.4em] text-zinc-200">RECRUIT A PILOT</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path
                fill="currentColor"
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>

        {/* ---------- body ---------- */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="text-[11px] leading-relaxed text-zinc-400">
            Hand a friend your personal link. They skip the gate — you bank{' '}
            <span className="text-[rgb(var(--ref-lime))]">+{REFERRAL_POINTS} PTS</span> once
            they&apos;re flying.
          </p>

          {/* link + copy */}
          <div className="mt-4">
            <span className="text-[9px] tracking-[0.3em] text-zinc-500">YOUR INVITE LINK</span>
            {failed ? (
              <div className="mt-1.5 flex h-11 items-center justify-between gap-2 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-3.5">
                <span className="text-[10px] tracking-[0.25em] text-zinc-600">LINK UNAVAILABLE</span>
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-[9px] tracking-[0.25em] text-zinc-400 transition-colors hover:text-[rgb(var(--ref-lime))]"
                >
                  RETRY
                </button>
              </div>
            ) : data ? (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-[rgb(var(--ref-lime)/0.18)] bg-[rgb(var(--ref-lime)/0.04)] px-3.5">
                  <span className="truncate text-[13px] text-zinc-100">
                    {data.link.replace(/^https?:\/\//i, '')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={copy}
                  className={`h-11 min-w-[5.5rem] shrink-0 rounded-xl border px-3 text-[10px] tracking-[0.25em] transition-[color,border-color,background-color,transform] active:scale-[0.97] ${
                    copied
                      ? 'referral-copied border-[rgb(var(--ref-lime)/0.6)] bg-[rgb(var(--ref-lime)/0.15)] text-[rgb(var(--ref-lime))]'
                      : 'border-white/[0.1] bg-white/[0.04] text-zinc-300 hover:border-[rgb(var(--ref-lime)/0.5)] hover:text-[rgb(var(--ref-lime))]'
                  }`}
                >
                  {copied ? 'COPIED' : 'COPY'}
                </button>
              </div>
            ) : (
              <div className="mt-1.5 flex h-11 animate-pulse items-center rounded-xl liquid-glass-inset px-3.5">
                <span className="h-3 w-44 rounded bg-white/[0.05]" />
              </div>
            )}
          </div>

          {/* primary action — solid lime, text stamped in the page bg */}
          <button
            type="button"
            onClick={postOnX}
            disabled={!data}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[rgb(var(--ref-lime))] text-[10px] font-bold tracking-[0.3em] text-[color:var(--background)] shadow-[0_0_24px_-8px_rgb(var(--ref-lime)/0.6)] transition-[transform,box-shadow,filter] hover:shadow-[0_0_32px_-6px_rgb(var(--ref-lime)/0.8)] hover:brightness-105 active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
          >
            <SocialIcon kind="x" size={11} />
            POST ON X
          </button>

          {/* stats */}
          <div className="mt-5 grid grid-cols-3 divide-x divide-white/[0.06] overflow-hidden rounded-xl liquid-glass-inset">
            <ModalStat label="JOINED" value={data ? data.stats.joined : null} failed={failed} />
            <ModalStat label="REWARDED" value={data ? data.stats.rewarded : null} failed={failed} />
            <ModalStat
              label="PTS EARNED"
              value={data ? data.stats.pointsEarned : null}
              failed={failed}
            />
          </div>

          {/* cap progress */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] tracking-[0.3em] text-zinc-500">REWARD CAP</span>
              <span className="text-[9px] tabular-nums tracking-[0.2em] text-zinc-500">
                {failed && !data ? '-' : rewarded}/{REFERRAL_CAP}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="referral-cap-fill h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${capPct}%`,
                  background:
                    'linear-gradient(90deg, rgb(var(--ref-lime) / 0.5), rgb(var(--ref-lime)))'
                }}
              />
            </div>
          </div>

          <p className="mt-4 border-t border-white/[0.06] pt-3 text-[10px] leading-relaxed text-zinc-600">
            The reward lands when your friend&apos;s extension syncs its first real activity —{' '}
            +{REFERRAL_POINTS} PTS each, first {REFERRAL_CAP} recruits count.
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Pixel-numeral stat cell; null value = loading (skeleton) or, when the
 *  fetch failed, a static placeholder so the shimmer doesn't loop forever. */
function ModalStat({
  label,
  value,
  failed
}: {
  label: string
  value: number | null
  failed: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-2 py-3">
      {value !== null ? (
        <span className="text-[14px] leading-none tabular-nums text-[rgb(var(--ref-lime))] [font-family:var(--font-pixel)]">
          {value.toLocaleString('en-US')}
        </span>
      ) : failed ? (
        <span className="text-[14px] leading-none text-zinc-600 [font-family:var(--font-pixel)]">-</span>
      ) : (
        <span className="h-[14px] w-8 animate-pulse rounded bg-white/[0.05]" />
      )}
      <span className="text-[8px] tracking-[0.25em] text-zinc-500">{label}</span>
    </div>
  )
}
