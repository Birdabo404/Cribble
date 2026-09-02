'use client'

// Hero rail — one row of compartments across the top of the manifest:
// wordmark, UTC clock, season, roster counts, nav. Each cell draws its own
// left hairline so no line doubles where two meet; the bottom hairline is
// the standalone [data-hero-line] span the entrance grows in. The player
// count and season are the live readings page.tsx fetched (the same
// object the arena's stat grid prints from, so the two never disagree);
// a failed read shows a dash, never a stale or invented number.

import { LiquidMark } from '@/components/brand/LiquidMark'
import { STAGED_SEASON } from '@/components/landing/data'
import { ThemeToggle } from '@/components/ThemeToggle'
import type { LandingLive } from '@/lib/landingLive'
import { UtcClock } from './UtcClock'

const numberFormat = new Intl.NumberFormat('en-US')

const SITE_COUNT = 47

const CELL_BASE = 'flex items-center border-l border-[color:var(--lx-line)]'
const CELL = `${CELL_BASE} px-3 sm:px-5`
const DIM = 'text-[color:var(--lx-ink-dim)]'
const INK = 'text-[color:var(--lx-ink)]'
const NAV_LINK =
  'p-2 text-[color:var(--lx-ink-dim)] transition-colors hover:text-[color:var(--lx-ink)]'

export function Rail({
  playerCount,
  season
}: {
  playerCount: LandingLive['playerCount']
  season: LandingLive['season']
}) {
  // No live season = no season row at all in the DB (or the read failed):
  // print the staged one rather than an empty compartment.
  const shownSeason = season ?? STAGED_SEASON

  return (
    <header
      data-hero-enter
      className="lx-hero-exit relative flex h-12 items-stretch font-data text-[length:var(--fs-label)] tracking-[0.2em]"
    >
      <div
        data-hero-cell
        className={`flex shrink-0 items-center gap-2.5 pr-3 text-[12px] font-semibold tracking-[0.2em] sm:pr-5 sm:tracking-[0.3em] ${INK}`}
      >
        <LiquidMark size={18} />
        <span>
          CRIBBLE
          <span style={{ color: 'var(--lx-signal)' }}>.</span>
        </span>
      </div>

      <div data-hero-cell className={`${CELL} shrink-0 ${INK}`}>
        <UtcClock />
      </div>

      <div data-hero-cell className={`${CELL} hidden whitespace-nowrap lg:flex ${DIM}`}>
        <span>
          {shownSeason.label}
          {shownSeason.daysLeft !== null && (
            <>
              {' · '}
              <span className={INK}>D-{shownSeason.daysLeft}</span>
            </>
          )}
        </span>
      </div>

      <div data-hero-cell className={`${CELL} hidden gap-2.5 whitespace-nowrap md:flex ${DIM}`}>
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0"
          style={{ background: 'var(--lx-signal)' }}
        />
        <span>
          <span className={INK}>
            {playerCount === null ? '—' : numberFormat.format(playerCount)}
          </span>{' '}
          PLAYERS
        </span>
      </div>

      <div data-hero-cell className={`${CELL} hidden whitespace-nowrap md:flex ${DIM}`}>
        <span>
          <span className={INK}>{SITE_COUNT}</span> SITES
        </span>
      </div>

      {/* X / GitHub sit out below sm: wordmark + clock + toggle is all a
          390px rail can hold without wrapping. */}
      <nav
        data-hero-cell
        className={`${CELL_BASE} ml-auto shrink-0 gap-1 pl-3 sm:pl-4`}
      >
        <ThemeToggle className="sm:mr-2" />
        <a
          href="https://x.com/cribble_ai"
          target="_blank"
          rel="noreferrer"
          aria-label="X"
          className={`hidden sm:inline-flex ${NAV_LINK}`}
        >
          <TwitterMark />
        </a>
        <a
          href="https://github.com/Birdabo404/Cribble"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className={`hidden sm:inline-flex ${NAV_LINK}`}
        >
          <GithubMark />
        </a>
      </nav>

      <span
        aria-hidden
        data-hero-line
        className="absolute inset-x-0 bottom-0 h-px"
        style={{ background: 'var(--lx-line)', transformOrigin: 'left center' }}
      />
    </header>
  )
}

function GithubMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .5C5.73.5.92 5.31.92 11.58c0 4.88 3.16 9.01 7.55 10.47.55.1.75-.24.75-.53 0-.26-.01-.95-.02-1.86-3.07.67-3.72-1.48-3.72-1.48-.5-1.27-1.23-1.6-1.23-1.6-1-.69.08-.67.08-.67 1.11.08 1.7 1.14 1.7 1.14.99 1.69 2.6 1.2 3.23.92.1-.72.39-1.2.7-1.48-2.45-.28-5.03-1.23-5.03-5.48 0-1.21.43-2.2 1.14-2.97-.11-.28-.5-1.42.11-2.96 0 0 .93-.3 3.05 1.13a10.6 10.6 0 0 1 2.78-.37c.94 0 1.89.13 2.78.37 2.12-1.43 3.05-1.13 3.05-1.13.61 1.54.22 2.68.11 2.96.71.77 1.14 1.76 1.14 2.97 0 4.26-2.58 5.19-5.04 5.46.4.34.76 1.02.76 2.06 0 1.49-.01 2.69-.01 3.06 0 .29.2.64.76.53 4.38-1.46 7.54-5.59 7.54-10.47C23.08 5.31 18.27.5 12 .5Z" />
    </svg>
  )
}

function TwitterMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M18.244 2H21l-6.52 7.45L22 22h-6.835l-4.79-6.272L4.8 22H2l6.99-7.99L2 2h7.012l4.33 5.741L18.244 2Zm-2.397 18.3h1.66L7.27 3.6H5.49l10.357 16.7Z" />
    </svg>
  )
}
