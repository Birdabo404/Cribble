'use client'

// Manifest header — block type + telemetry + the counts strip. Replaces the
// ASCII hero: `BAG` as macro display type, a right-aligned mono telemetry
// block (sheet name, pilot handle, revision, sync cell), a full-width rule,
// then the two counts in pixel numerals with 1px dividers. Below md the
// telemetry collapses to one line and the counts stay a 2-cell grid; the
// PILOT cell joins at lg. Registration crosses sit on the block's corners.

import { useMemo } from 'react'
import { pad2, revStamp, type Identity, type SyncState } from './bagModel'
import { DISPLAY, FOCUS, INK, LINE, MICRO, MUTE, PAPER_BG, PIXEL } from './manifestChrome'
import type { AchievementsState } from './useBagData'

export interface ManifestHeaderProps {
  identity: Identity
  usableCount: number
  plateTotal: number
  unlockedCount: number | null
  badgeTotal: number
  syncState: SyncState
  achievementsState: AchievementsState
  onRetry: () => void
}

const NUMERAL = `${PIXEL} mt-2 text-[length:clamp(1.25rem,3vw,2rem)] leading-none tabular-nums`

export function ManifestHeader({
  identity,
  usableCount,
  plateTotal,
  unlockedCount,
  badgeTotal,
  syncState,
  achievementsState,
  onRetry
}: ManifestHeaderProps) {
  // Month-granular, so a render on either side of midnight still agrees.
  const rev = useMemo(() => revStamp(new Date()), [])

  // `-- / 32` while the idle prefetch has not landed; the count is unknown,
  // not zero, so it paints mute. A failed fetch resolves to NEUTRAL_BADGES
  // upstream (unlockedCount 0), so null + error never really occurs — it
  // falls through to the same placeholder.
  const badgesPending =
    unlockedCount === null && (achievementsState === 'idle' || achievementsState === 'loading')
  const badgeValue = `${unlockedCount === null ? '--' : pad2(unlockedCount)} / ${badgeTotal}`

  return (
    <header className="bag-regmarks relative">
      <div className="px-[var(--bag-pad)] pb-4 pt-[var(--bag-pad)] md:grid md:grid-cols-[1fr_auto] md:items-end md:gap-x-6">
        <h1
          className={`${DISPLAY} ${INK} font-bold uppercase leading-[0.85] tracking-[-0.05em] text-[length:clamp(3.5rem,18vw,6rem)] md:text-[length:clamp(3.5rem,12vw,9rem)]`}
        >
          BAG
        </h1>

        {/* md+: the telemetry block, right-aligned, one datum per line */}
        <div className={`hidden flex-col items-end gap-y-2 text-right md:flex ${MICRO} ${MUTE}`}>
          <div>{'[ MANIFEST ]\u00a0\u00a0// EVERYTHING YOU CARRY'}</div>
          <div>@{identity.username}</div>
          <div>{rev}</div>
          <SyncCell syncState={syncState} onRetry={onRetry} />
        </div>

        {/* <md: one line, at least the tap floor tall for RETRY. */}
        <div
          className={`mt-3 flex min-h-[var(--bag-tap)] flex-wrap items-center gap-x-2 gap-y-1 md:hidden ${MICRO} ${MUTE}`}
        >
          <span>[ MANIFEST ]</span>
          <span aria-hidden>·</span>
          <span>{rev}</span>
          <span aria-hidden>·</span>
          <SyncCell syncState={syncState} onRetry={onRetry} />
        </div>
      </div>

      <div className={`border-t ${LINE}`} />

      {/* counts strip: hairlines come from the 1px gap over the line color */}
      <div className="grid grid-cols-2 gap-px bg-[color:var(--bag-line)] lg:grid-cols-3">
        <CountCell label="PLATES CARRIED" value={`${pad2(usableCount)} / ${plateTotal}`} />
        <CountCell label="BADGES EARNED" value={badgeValue} pending={badgesPending} />
        <div className={`hidden min-w-0 px-[var(--bag-pad)] py-3 lg:block ${PAPER_BG}`}>
          <div className={`${MICRO} ${MUTE}`}>PILOT</div>
          <div
            className={`${DISPLAY} ${INK} mt-2 truncate text-[length:clamp(1.25rem,3vw,2rem)] font-semibold uppercase leading-none tracking-[-0.02em]`}
          >
            {identity.name}
          </div>
        </div>
      </div>
    </header>
  )
}

function CountCell({
  label,
  value,
  pending = false
}: {
  label: string
  value: string
  pending?: boolean
}) {
  return (
    <div className={`min-w-0 px-[var(--bag-pad)] py-3 ${PAPER_BG}`}>
      <div className={`${MICRO} ${MUTE}`}>{label}</div>
      <div className={`${NUMERAL} ${pending ? MUTE : INK}`}>{value}</div>
    </div>
  )
}

/** The cosmetics sync readout. Failure is the one case with an action:
 * RETRY re-runs the load so a network blip never reads as lost items. The
 * button is a real tap target in both variants — tap-floor tall, padded,
 * underlined mono; a negative right margin keeps the underline flush with
 * the telemetry block's right edge. */
function SyncCell({ syncState, onRetry }: { syncState: SyncState; onRetry: () => void }) {
  switch (syncState) {
    case 'loading':
      return (
        <span role="status" className={`bag-cursor ${MUTE}`}>
          SYNCING
        </span>
      )
    case 'ok':
      return (
        <span role="status" className={INK}>
          SYNCED
        </span>
      )
    case 'error':
      return (
        <span role="status" className={`inline-flex items-center gap-x-1 ${INK}`}>
          SYNC FAILED <span aria-hidden>·</span>
          <button
            type="button"
            onClick={onRetry}
            className={`-mr-2 inline-flex min-h-[var(--bag-tap)] items-center px-2 underline decoration-1 underline-offset-[3px] ${INK} ${FOCUS}`}
          >
            RETRY
          </button>
        </span>
      )
    default: {
      const exhaustive: never = syncState
      return exhaustive
    }
  }
}
