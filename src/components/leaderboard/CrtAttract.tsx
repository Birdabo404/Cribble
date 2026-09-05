'use client'

// The GLOBAL standings hero: the pixel LEADERBOARD wordmark and the CRT
// monitor tuned to the top of the standings. The tube itself lives in
// CrtMonitor (feed-agnostic); this file maps LeaderRows onto pilot
// dossiers and round-trips PRESS START back to the row for the PlayerCard.

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { memo, useCallback, useMemo, useRef } from 'react'
import type { CrtChrome } from '@/components/leaderboard/crtDossier'
import { pilotDossier } from '@/components/leaderboard/crtFeeds'
import { CrtMonitor, reducedNow } from '@/components/leaderboard/CrtMonitor'
import { IconCrown } from '@/components/leaderboard/icons'
import type { LeaderRow } from '@/components/leaderboard/types'

gsap.registerPlugin(useGSAP)

/* ================= title entrance ================= */

const TITLE = 'LEADERBOARD'

/** The pixel wordmark lockup with its GSAP entrance: the crown rules draw
 *  outward from center while the letters slam in with a pixel-shadow
 *  stagger. Replaces the CSS lb4-reveal on the h1; reduced motion renders
 *  the static lockup untouched. */
export function HeroTitle({ eyebrow }: { eyebrow: string }) {
  const scope = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      if (reducedNow()) return
      gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from('.lbh-rule-l', { scaleX: 0, transformOrigin: '100% 50%', duration: 0.55 }, 0.05)
        .from('.lbh-rule-r', { scaleX: 0, transformOrigin: '0% 50%', duration: 0.55 }, 0.05)
        .from('.lbh-eyecore', { autoAlpha: 0, y: -8, duration: 0.45 }, 0.12)
        .from(
          '.lbh-letter',
          {
            autoAlpha: 0,
            y: -20,
            scale: 1.6,
            duration: 0.3,
            ease: 'back.out(2.2)',
            stagger: { each: 0.045 }
          },
          0.16
        )
    },
    { scope }
  )
  return (
    <div ref={scope} className="flex flex-col items-center">
      <div className="flex items-center gap-2.5 text-[rgb(var(--lb-gold))]">
        <span className="lbh-rule-l h-px w-8 bg-gradient-to-r from-transparent to-[rgb(var(--lb-gold)/0.6)]" />
        <span className="lbh-eyecore flex items-center gap-2.5">
          <IconCrown size={13} />
          <span className="font-display text-[10px] font-semibold tracking-[0.42em] sm:tracking-[0.55em]">
            {eyebrow}
          </span>
          <IconCrown size={13} className="-scale-x-100" />
        </span>
        <span className="lbh-rule-r h-px w-8 bg-gradient-to-l from-transparent to-[rgb(var(--lb-gold)/0.6)]" />
      </div>
      <h1
        aria-label={TITLE}
        className="lb4-title mt-4 select-none text-center leading-none [font-family:var(--font-pixel)]"
      >
        {TITLE.split('').map((ch, i) => (
          <span key={i} aria-hidden className="lbh-letter inline-block">
            {ch}
          </span>
        ))}
      </h1>
    </div>
  )
}

/* ================= attract mode ================= */

const ATTRACT_CHROME: CrtChrome = {
  brand: 'CRIBBLE//BROADCAST',
  model: 'MODEL CRT·1984 // ATTRACT MODE',
  scanning: 'SCANNING FOR PILOTS',
  aria: 'Attract mode — top pilots showcase'
}

type CrtAttractProps = {
  /** Top slice of the standings (the attract rotation, ≤10 rows). */
  rows: LeaderRow[]
  topScore: number
  totalPlayers: number
  loading: boolean
  /** True while a modal covers the arena — hard-pauses GSAP + anime
   *  (the page's .lb4-freeze only reaches CSS animations). */
  frozen: boolean
  onSelect: (row: LeaderRow) => void
}

// Memoized: the arena page re-renders on every keystroke in the standings
// search and on score-flash state flips — none of which change these props.
// Only the 15s poll (fresh rows array) gets through.
export const CrtAttract = memo(function CrtAttract({
  rows,
  topScore,
  totalPlayers,
  loading,
  frozen,
  onSelect
}: CrtAttractProps) {
  const dossiers = useMemo(
    () => rows.map((row) => pilotDossier(row, topScore)),
    [rows, topScore]
  )
  const handleSelect = useCallback(
    (key: number) => {
      const row = rows.find((r) => r.userId === key)
      if (row) onSelect(row)
    },
    [rows, onSelect]
  )
  return (
    <CrtMonitor
      dossiers={dossiers}
      total={totalPlayers}
      loading={loading}
      frozen={frozen}
      feedId="attract"
      theme="amber"
      chrome={ATTRACT_CHROME}
      onSelect={handleSelect}
    />
  )
})
