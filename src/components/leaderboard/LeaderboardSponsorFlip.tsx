'use client'

// The leaderboard's stats-to-sponsor flip (migration 055's public face):
// one panel footprint that alternates between the live board's stat
// strip (the arena StatBar on SEASON / ALL-TIME, each other tab's own
// strip on TOKENS / AI / TEAMS) and the current #1 of the rolling 24h
// sponsor ranking. Cadence comes from lib/leaderboardSponsor so it
// can't drift from the product spec — stats hold 8s, a ~450ms flip,
// the sponsor holds 6s, flip back.
//
// Geometry: the stats face (children) renders IN FLOW and is the only
// thing that sizes the panel — 2-col mobile, 3-col teams desktop, and
// 4-col desktop alike. The sponsor face is an absolute inset-0 overlay
// carrying its own .lb-panel chrome, so the two faces sit back-to-back
// in exactly one footprint and neither face can ever resize the panel
// (zero layout shift, no JS measuring). The 3D flip is a classic
// rotateX card: preserve-3d wrapper, backface-visibility on each face,
// the sponsor face pre-rotated 180deg. prefers-reduced-motion swaps the
// whole mechanism for an opacity crossfade in CSS — the state machine
// never knows the difference.
//
// Data: GET /api/billboard/leaderboard, polled on the shared 15s
// constant with the codebase's visibility pattern (BillboardTicker,
// the arena's own poll): hidden tabs skip the interval entirely and
// becoming visible refetches immediately. A failed fetch keeps the
// last good payload; until a payload EVER lands the sponsor face isn't
// mounted and the panel never flips — API down means stats only. An
// empty board still flips, to the restrained "Claim #1" acquisition
// face (openingCents), because an unsold slot should sell itself.
//
// Rotation pauses on hover, on keyboard focus anywhere within, and on
// hidden tabs — the unspent hold is banked and resumed on unpause
// (BillboardTicker's banked-hold stance), so a graze doesn't restart
// the whole cycle. The hidden face is aria-hidden + inert +
// pointer-events:none, so keyboard and AT users can never land on
// invisible controls. No aria-live anywhere: a decorative rotation
// must not narrate itself to screen readers every 14 seconds.
//
// Sponsorship integrity (lib/billboard's stance): the paid creative is
// labeled SPONSOR and its click goes through GET
// /api/billboard/[adId]/click — never link_url directly. The OUTBID
// CTA and the empty-slot face link to /sponsorship, where the buy flow
// lives. The empty face is house copy, not a paid ad, so it wears
// SPONSOR SLOT rather than dressing itself as sponsorship.

import type { FocusEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  LEADERBOARD_FLIP_SPONSOR_HOLD_MS,
  LEADERBOARD_FLIP_STATS_HOLD_MS,
  LEADERBOARD_FLIP_TRANSITION_MS,
  LEADERBOARD_SPONSOR_POLL_MS,
  type LeaderboardSponsorBoard,
  type LeaderboardSponsorEntry
} from '@/lib/leaderboardSponsor'
import { formatCompact } from '@/components/dashboard-v2/format'

// `inert` is a boolean attribute. An empty string used to emit `inert=""`
// (which browsers treat as on); current React treats "" as false and warns.
// The typed prop still isn't on our React 18 HTMLAttributes, so we cast.
const INERT = { inert: true } as unknown as React.HTMLAttributes<HTMLDivElement>

/** Integer cents -> '$6.66' / '$12' — whole-dollar amounts drop the
 *  cents so the CTA reads like a price tag, not an invoice line. */
function formatUsd(cents: number): string {
  const dollars = Math.floor(cents / 100)
  const rest = cents % 100
  const base = `$${dollars.toLocaleString('en-US')}`
  return rest === 0 ? base : `${base}.${String(rest).padStart(2, '0')}`
}

export function LeaderboardSponsorFlip({ children }: { children: ReactNode }) {
  /** Last good payload; null until the first successful fetch — and
   *  while null the sponsor face doesn't exist and nothing flips. */
  const [board, setBoard] = useState<LeaderboardSponsorBoard | null>(null)
  /** false = stats face up, true = sponsor face up. */
  const [flipped, setFlipped] = useState(false)
  const [hoverPause, setHoverPause] = useState(false)
  const [focusPause, setFocusPause] = useState(false)
  const [docHidden, setDocHidden] = useState(false)

  // Monotonic guard — a slow poll response must never overwrite a
  // newer one (the arena poll's stance).
  const fetchSeq = useRef(0)

  const fetchBoard = useCallback(async () => {
    const seq = ++fetchSeq.current
    try {
      const res = await fetch('/api/billboard/leaderboard', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as LeaderboardSponsorBoard
      if (seq !== fetchSeq.current) return
      if (!Array.isArray(data.board)) return
      setBoard(data)
    } catch {
      // Network hiccup — keep the last good board (a stale #1 beats a
      // yanked face); a still-null board just means no flip yet.
    }
  }, [])

  // Poll on the shared cadence. Hidden tabs skip the interval entirely;
  // becoming visible refetches immediately so the pause never shows.
  useEffect(() => {
    void fetchBoard()
    const interval = window.setInterval(() => {
      if (!document.hidden) void fetchBoard()
    }, LEADERBOARD_SPONSOR_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchBoard()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchBoard])

  // Hidden-tab rotation pause — separate from the poll listener because
  // it drives state (the rotation clock), not a fetch.
  useEffect(() => {
    const onVisibility = () => setDocHidden(document.hidden)
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const paused = hoverPause || focusPause || docHidden
  const hasBoard = board !== null

  /** Unspent hold for the current face — banked by the effect cleanup
   *  on every pause/re-render, spent on resume, reset when the face
   *  actually changes (BillboardTicker's banked-hold pattern). */
  const holdRemainingRef = useRef(LEADERBOARD_FLIP_STATS_HOLD_MS)
  /** Which face the bank belongs to; null = never armed, so the very
   *  first stats cycle doesn't pay for a flip that never happened. */
  const lastArmedFaceRef = useRef<boolean | null>(null)

  // The rotation clock. Each cycle is the face's hold PLUS one flip
  // transition (the spec's "visible 8000ms" starts when the face is
  // fully up, and the transition eats the front of the timer) — except
  // the mount cycle, where stats is already up. Pausing tears the
  // timer down and the cleanup banks what's left; resuming re-arms
  // with the banked remainder, so grazing the panel can't restart an
  // 8-second cycle from zero.
  useEffect(() => {
    if (!hasBoard || paused) return
    if (lastArmedFaceRef.current !== flipped) {
      holdRemainingRef.current =
        (lastArmedFaceRef.current === null ? 0 : LEADERBOARD_FLIP_TRANSITION_MS) +
        (flipped ? LEADERBOARD_FLIP_SPONSOR_HOLD_MS : LEADERBOARD_FLIP_STATS_HOLD_MS)
      lastArmedFaceRef.current = flipped
    }
    const startedAt = Date.now()
    const timer = window.setTimeout(() => setFlipped((f) => !f), holdRemainingRef.current)
    return () => {
      window.clearTimeout(timer)
      holdRemainingRef.current = Math.max(
        0,
        holdRemainingRef.current - (Date.now() - startedAt)
      )
    }
  }, [hasBoard, paused, flipped])

  // Focus-within pause: React's onFocus/onBlur bubble (focusin/out
  // semantics). Blur only unpauses when focus actually left the whole
  // scene — tabbing between the two sponsor links stays paused.
  const onSceneBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setFocusPause(false)
    }
  }, [])

  return (
    <div
      className="lsf-scene"
      onMouseEnter={() => setHoverPause(true)}
      onMouseLeave={() => setHoverPause(false)}
      onFocus={() => setFocusPause(true)}
      onBlur={onSceneBlur}
    >
      <div className={`lsf-card ${flipped ? 'lsf-flipped' : ''}`}>
        {/* Stats face — IN FLOW: the one thing that sizes the panel.
            When flipped away it stays in layout (the reservation) but
            leaves the a11y tree and can't be interacted with. */}
        <div
          className="lsf-face lsf-face-stats"
          aria-hidden={flipped || undefined}
          {...(flipped ? INERT : undefined)}
        >
          {children}
        </div>

        {/* Sponsor face — absolute overlay in the exact same footprint,
            mounted only once a payload has ever landed (API down =
            stats forever, no flip, no shift). */}
        {board !== null && (
          <div
            className="lb-panel lsf-face lsf-face-sponsor overflow-hidden"
            aria-hidden={!flipped || undefined}
            {...(!flipped ? INERT : undefined)}
          >
            {board.top ? (
              <SponsorCreativeFace entry={board.top} minTargetCents={board.minTargetCents} />
            ) : (
              <ClaimSlotFace openingCents={board.openingCents} />
            )}
          </div>
        )}
      </div>

      <style jsx global>{`
        .lsf-scene {
          perspective: 1400px;
        }
        .lsf-card {
          position: relative;
          transform-style: preserve-3d;
          transition: transform ${LEADERBOARD_FLIP_TRANSITION_MS}ms
            cubic-bezier(0.22, 1, 0.36, 1);
        }
        .lsf-card.lsf-flipped {
          transform: rotateX(180deg);
        }
        .lsf-face {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .lsf-face-sponsor {
          position: absolute;
          inset: 0;
          transform: rotateX(180deg);
        }
        /* inert covers the resting states; these cover the 450ms of
           transition in between, so a mid-flip click can't land on the
           face that's leaving. */
        .lsf-flipped .lsf-face-stats,
        .lsf-card:not(.lsf-flipped) .lsf-face-sponsor {
          pointer-events: none;
        }
        /* Reduced motion: the same state machine drives an opacity
           crossfade instead of the 3D rotation — no rotating panel,
           same cadence, same footprint. */
        @media (prefers-reduced-motion: reduce) {
          .lsf-card {
            transform-style: flat;
            transition: none;
          }
          .lsf-card.lsf-flipped {
            transform: none;
          }
          .lsf-face {
            backface-visibility: visible;
            -webkit-backface-visibility: visible;
            transition: opacity ${LEADERBOARD_FLIP_TRANSITION_MS}ms ease;
          }
          .lsf-face-sponsor {
            transform: none;
            opacity: 0;
          }
          .lsf-flipped .lsf-face-stats {
            opacity: 0;
          }
          .lsf-flipped .lsf-face-sponsor {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}

/* ================= sponsor face: the ranked #1 ================= */

/** The paid creative in the Outbid hierarchy: rank chip + logo +
 *  company + one-line copy on the left (the click, through the
 *  redirect route), clicks / active bid / OUTBID CTA on the right.
 *  Stacks into two rows inside the taller 2-col mobile footprint. */
function SponsorCreativeFace({
  entry,
  minTargetCents
}: {
  entry: LeaderboardSponsorEntry
  minTargetCents: number
}) {
  // Stale twimg logos are common — drop the <img> on error instead of
  // painting the broken-image glyph (BillboardCard / Avatar's stance).
  const [logoDead, setLogoDead] = useState(false)
  useEffect(() => setLogoDead(false), [entry.logoUrl])

  const title = entry.companyName ?? entry.linkHost

  return (
    <div className="relative flex h-full min-w-0 flex-col justify-center gap-3 px-4 py-3 md:flex-row md:items-center md:gap-6 md:px-5">
      {/* whisper of the creative's extracted accent across the face —
          runtime #rrggbb, so a hex-alpha inline style, not a class */}
      {entry.accentColor && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `${entry.accentColor}0d` }}
        />
      )}

      {/* broadcast chrome — paid ads are always labeled as sponsorship
          (billboardChrome's stance) */}
      <span className="absolute right-3 top-2 text-[8px] tracking-[0.3em] text-zinc-500">
        SPONSOR
      </span>

      {/* the creative — one click target through the counted redirect */}
      <a
        href={`/api/billboard/${entry.adId}/click`}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-500"
      >
        {/* rank chip — the standings medal treatment, gold for #1 */}
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[11px] [font-family:var(--font-pixel)]"
          style={{
            color: 'rgb(var(--lb-gold))',
            border: '1px solid rgb(var(--lb-gold) / 0.5)',
            background: 'rgb(var(--lb-gold) / 0.08)',
            textShadow: '0 0 10px rgb(var(--lb-gold) / calc(0.55 * var(--lb-glow, 1)))'
          }}
        >
          #{entry.rank}
        </span>
        {entry.logoUrl && !logoDead && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.logoUrl}
            alt=""
            aria-hidden
            loading="lazy"
            className="h-8 w-8 shrink-0 rounded object-cover"
            style={{
              boxShadow: `0 0 0 1px ${
                entry.accentColor
                  ? `${entry.accentColor}80`
                  : 'rgb(var(--lb-panel-edge) / 0.14)'
              }`
            }}
            onError={() => setLogoDead(true)}
          />
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[11px] font-semibold uppercase leading-4 tracking-[0.2em] text-zinc-50">
            {title}
          </span>
          <span className="truncate text-xs leading-4 text-zinc-400 transition-colors group-hover:text-zinc-200">
            {entry.text}
          </span>
        </span>
      </a>

      {/* the money row: proof of exposure, proof of stake, the challenge */}
      <div className="relative flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 md:gap-x-6">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] tracking-[0.16em] text-zinc-500 sm:tracking-[0.28em]">
            CLICKS
          </span>
          <span className="text-[12px] leading-none tabular-nums text-zinc-50 [font-family:var(--font-pixel)]">
            {formatCompact(entry.clicks)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] tracking-[0.16em] text-zinc-500 sm:tracking-[0.28em]">
            ACTIVE BID
          </span>
          <span
            className="text-[12px] leading-none tabular-nums [font-family:var(--font-pixel)]"
            style={{
              color: 'rgb(var(--lb-gold))',
              textShadow: '0 0 12px rgb(var(--lb-gold) / calc(0.4 * var(--lb-glow, 1)))'
            }}
          >
            {formatUsd(entry.activeCents)}
          </span>
        </div>
        <Link
          href="/sponsorship?intent=leaderboard-bid"
          className="shrink-0 whitespace-nowrap rounded-md border border-[rgb(var(--lb-gold)/0.5)] bg-[rgb(var(--lb-gold)/0.07)] px-3 py-2 text-[10px] tracking-[0.2em] text-[rgb(var(--lb-gold))] transition-colors hover:bg-[rgb(var(--lb-gold)/0.14)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--lb-gold)/0.6)] sm:tracking-[0.3em]"
        >
          OUTBID · {formatUsd(minTargetCents)}
        </Link>
      </div>
    </div>
  )
}

/* ================= sponsor face: the empty slot ================= */

/** The acquisition face for an empty board — restrained house copy
 *  (labeled as the open slot, never dressed as a sponsor) pitching the
 *  opening price straight into the buy flow. */
function ClaimSlotFace({ openingCents }: { openingCents: number }) {
  return (
    <Link
      href="/sponsorship?intent=leaderboard-bid"
      className="group relative flex h-full flex-col items-center justify-center gap-2 px-4 py-3 text-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[rgb(var(--lb-gold)/0.5)]"
    >
      <span className="text-[9px] tracking-[0.16em] text-zinc-500 sm:tracking-[0.28em]">
        SPONSOR SLOT · OPEN
      </span>
      <span
        className="text-[clamp(12px,2.8vw,17px)] leading-none [font-family:var(--font-pixel)]"
        style={{
          color: 'rgb(var(--lb-gold))',
          textShadow: '0 0 14px rgb(var(--lb-gold) / calc(0.4 * var(--lb-glow, 1)))'
        }}
      >
        CLAIM #1 FOR {formatUsd(openingCents)}
      </span>
      <span className="text-[9px] tracking-[0.2em] text-zinc-600 transition-colors group-hover:text-zinc-400">
        PUT YOUR BRAND ON THE ARENA
      </span>
    </Link>
  )
}
