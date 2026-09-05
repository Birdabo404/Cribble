'use client'

// THE BURN's CRT: the same tube as GLOBAL's attract monitor, tuned to the
// top burners of whichever fuel the board is showing. This file maps the
// active board's rows onto burner dossiers (crtFeeds.ts), hands the tube
// a feed identity that flips with both the CLI↔CURSOR toggle and the
// SEASON/7D/ALL window (so each re-tunes with the channel-switch glitch),
// and round-trips PRESS START back to the row so TokenBoard can open the
// burn card or the cursor.com profile.

import { memo, useCallback, useMemo } from 'react'
import type { BurnSource } from '@/components/leaderboard/burnSource'
import type { CrtChrome, CrtDossier } from '@/components/leaderboard/crtDossier'
import { cliDossier, cursorDossier } from '@/components/leaderboard/crtFeeds'
import { CrtMonitor } from '@/components/leaderboard/CrtMonitor'
import type { CursorBoardRow } from '@/lib/cursorProfileBoard'
import type { TokenBoardRow, TokenBoardWindowId } from '@/lib/tokenLeaderboard'

/** The rows the active board has landed, tagged with their fuel. */
export type BurnFeed =
  | { source: 'cli'; rows: TokenBoardRow[] }
  | { source: 'cursor'; rows: CursorBoardRow[] }

/** PRESS START's payload: the on-screen row in its own wire shape. */
export type BurnSelection =
  | { source: 'cli'; row: TokenBoardRow }
  | { source: 'cursor'; row: CursorBoardRow }

/** The tube shows the top of the board, like the GLOBAL attract rotation. */
const ROTATION = 10

const CHROME: Record<BurnSource, CrtChrome> = {
  cli: {
    brand: 'CRIBBLE//BURN·CLI',
    model: 'MODEL CRT·1984 // BURN MODE',
    scanning: 'SCANNING FOR BURNERS',
    aria: 'Burn mode — top burners showcase'
  },
  cursor: {
    brand: 'CRIBBLE//BURN·CURSOR',
    model: 'MODEL CRT·1984 // BURN MODE',
    scanning: 'SCANNING FOR BURNERS',
    aria: 'Burn mode — top burners showcase'
  }
}

type CrtBurnProps = {
  /** The fuel the toggle is on. Separate from `feed` so the feed identity
   *  flips the instant the toggle is clicked — while `feed` is still null
   *  and the new board is fetching — and the tube drops to AWAITING. */
  source: BurnSource
  /** The active board's rows, or null while it is loading. */
  feed: BurnFeed | null
  windowId: TokenBoardWindowId
  loading: boolean
  /** True while a modal covers the arena — hard-pauses GSAP + anime. */
  frozen: boolean
  onSelect: (selection: BurnSelection) => void
}

function toDossiers(feed: BurnFeed | null): CrtDossier[] {
  if (feed === null) return []
  switch (feed.source) {
    case 'cli': {
      const leader = feed.rows[0]?.burnUsd ?? '0'
      return feed.rows.slice(0, ROTATION).map((row) => cliDossier(row, leader))
    }
    case 'cursor': {
      const leader = feed.rows[0]?.tokens ?? '0'
      return feed.rows.slice(0, ROTATION).map((row) => cursorDossier(row, leader))
    }
    default: {
      const exhaustive: never = feed
      throw new Error(`Unhandled burn source: ${String(exhaustive)}`)
    }
  }
}

function selectionFor(feed: BurnFeed, key: number): BurnSelection | null {
  switch (feed.source) {
    case 'cli': {
      const row = feed.rows.find((r) => r.userId === key)
      return row ? { source: 'cli', row } : null
    }
    case 'cursor': {
      const row = feed.rows.find((r) => r.userId === key)
      return row ? { source: 'cursor', row } : null
    }
    default: {
      const exhaustive: never = feed
      throw new Error(`Unhandled burn source: ${String(exhaustive)}`)
    }
  }
}

// Memoized like CrtAttract: TokenBoard re-renders on its own fetch state,
// and only a fresh feed / toggle / window / freeze should reach the tube.
export const CrtBurn = memo(function CrtBurn({
  source,
  feed,
  windowId,
  loading,
  frozen,
  onSelect
}: CrtBurnProps) {
  const dossiers = useMemo(() => toDossiers(feed), [feed])
  const total = feed?.rows.length ?? 0
  const handleSelect = useCallback(
    (key: number) => {
      if (feed === null) return
      const selection = selectionFor(feed, key)
      if (selection) onSelect(selection)
    },
    [feed, onSelect]
  )
  return (
    <CrtMonitor
      dossiers={dossiers}
      total={total}
      loading={loading}
      frozen={frozen}
      feedId={`${source}:${windowId}`}
      theme="ember"
      chrome={CHROME[source]}
      onSelect={handleSelect}
    />
  )
})
