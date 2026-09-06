'use client'

// Loadout strip — the phone's sticky readout of the selected item: a
// paused 64x16 thumb (or sprite), the name on one line with the status
// glyph + label in micro under it, and ONE right-hand action. The whole
// left area is a single button that opens the spec drawer. When the plate
// can be equipped or unequipped that is the right-hand button; when it is
// locked, unknown, or the badges compartment is open, the right-hand
// button is SPEC ▲ (the left area opens the drawer too, so the status
// never prints twice). The page mounts it below md only.
//
// Sticky offset: the fixed top bar is h-14 plus its 1px border
// (NavTopBar.tsx) and the shell exports the height as --nav-topbar-h: 56px
// (globals.css, the :root block of the "App navigation shell" section).
// Below md the page renders at zoom 1 and the top bar is always present
// (the rail is md+ only), so `top` is the bar plus its hairline — the
// strip's own top rule never tucks under the nav's.

import { PixelIcon } from '@/components/achievements/PixelIcon'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import type { PlateDef } from '@/lib/cosmetics/plates'
import {
  STATUS_META,
  type AchievementRow,
  type BagTab,
  type PlateStatus,
  type SyncState
} from './bagModel'
import {
  DISPLAY,
  FOCUS,
  FOCUS_ON_SIGNAL,
  INK,
  LINE,
  MICRO,
  MUTE,
  PAPER_BG,
  toneColor
} from './manifestChrome'

export interface LoadoutStripProps {
  tab: BagTab
  plate: PlateDef | null
  plateStatus: PlateStatus
  badge: AchievementRow | null
  loading: boolean
  syncState: SyncState
  equipping: boolean
  onEquip: (plateId: string | null) => void
  onOpen: () => void
  className?: string
}

const STICKY_TOP = 'top-[calc(var(--nav-topbar-h)_+_1px)]'

const NAME = `${DISPLAY} truncate text-[13px] font-semibold uppercase leading-tight tracking-[-0.01em]`
const ACTION = `inline-flex min-h-[var(--bag-tap)] min-w-[88px] shrink-0 items-center justify-center gap-1.5 px-3 ${MICRO} disabled:cursor-wait disabled:opacity-60`

/** Which right-hand control the strip shows. */
type StripAction = 'equip' | 'unequip' | 'spec'

function stripActionFor(
  tab: BagTab,
  plate: PlateDef | null,
  status: PlateStatus,
  loading: boolean,
  syncState: SyncState
): StripAction {
  if (tab !== 'plates' || plate === null || loading || syncState !== 'ok') return 'spec'
  switch (status) {
    case 'usable':
      return 'equip'
    case 'equipped':
      return 'unequip'
    case 'locked':
      return 'spec'
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

export function LoadoutStrip({
  tab,
  plate,
  plateStatus,
  badge,
  loading,
  syncState,
  equipping,
  onEquip,
  onOpen,
  className = ''
}: LoadoutStripProps) {
  const hasSelection = tab === 'plates' ? plate !== null : badge !== null
  const action = stripActionFor(tab, plate, plateStatus, loading, syncState)

  return (
    <div
      role="region"
      aria-label="Loadout"
      className={`sticky z-30 flex h-14 items-stretch border-y ${LINE} ${PAPER_BG} ${STICKY_TOP} ${className}`}
    >
      {/* the whole left area opens the spec drawer */}
      <button
        type="button"
        onClick={onOpen}
        disabled={loading || !hasSelection}
        aria-label="Open spec sheet"
        className={`flex min-w-0 flex-1 items-center gap-3 px-[var(--bag-pad)] text-left ${FOCUS} disabled:cursor-default`}
      >
        <Readout
          tab={tab}
          plate={plate}
          plateStatus={plateStatus}
          badge={badge}
          loading={loading}
          syncState={syncState}
        />
      </button>

      <div className="flex shrink-0 items-center pr-2">
        <StripControl
          action={action}
          plate={plate}
          disabled={loading || !hasSelection}
          equipping={equipping}
          onEquip={onEquip}
          onOpen={onOpen}
        />
      </div>
    </div>
  )
}

/* ================= readout ================= */

function Readout({
  tab,
  plate,
  plateStatus,
  badge,
  loading,
  syncState
}: {
  tab: BagTab
  plate: PlateDef | null
  plateStatus: PlateStatus
  badge: AchievementRow | null
  loading: boolean
  syncState: SyncState
}) {
  if (loading) {
    return (
      <>
        <span aria-hidden className="h-4 w-16 shrink-0 bg-[color:var(--bag-well)]" />
        <span className={`bag-cursor ${MICRO} ${MUTE}`}>LOADING MANIFEST</span>
      </>
    )
  }

  switch (tab) {
    case 'plates': {
      if (!plate) return <span className={`${MICRO} ${MUTE}`}>[ NO PLATE SELECTED ]</span>
      const meta = STATUS_META[plateStatus]
      // A failed sync makes every status a guess; say so instead.
      const unknown = syncState === 'error'
      return (
        <>
          <span className="bag-thumb relative h-4 w-16 shrink-0 overflow-hidden">
            <PlateLayer plateId={plate.id} fade="none" />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className={`${NAME} ${INK}`}>{plate.name}</span>
            {unknown ? (
              <span className={`truncate ${MICRO} ${MUTE}`}>
                <span aria-hidden>? </span>
                STATUS UNKNOWN
              </span>
            ) : (
              <span className={`truncate ${MICRO}`} style={{ color: toneColor(meta.tone) }}>
                <span aria-hidden>{meta.glyph} </span>
                {meta.label}
              </span>
            )}
          </span>
        </>
      )
    }
    case 'badges': {
      if (!badge) return <span className={`${MICRO} ${MUTE}`}>[ NO BADGE SELECTED ]</span>
      const unlocked = badge.unlockedAt !== null
      return (
        <>
          <PixelIcon name={badge.icon} size={28} locked={!unlocked} className="shrink-0" />
          <span className="flex min-w-0 flex-col gap-1">
            <span className={`${NAME} ${unlocked ? INK : MUTE}`}>{badge.name}</span>
            {unlocked ? (
              <span className={`truncate ${MICRO} ${INK}`}>
                <span aria-hidden>◆ </span>UNLOCKED
              </span>
            ) : (
              <span className={`truncate ${MICRO} ${MUTE}`}>
                <span aria-hidden>□ </span>LOCKED
              </span>
            )}
          </span>
        </>
      )
    }
    default: {
      const exhaustive: never = tab
      return exhaustive
    }
  }
}

/* ================= right-hand control ================= */

/** EQUIP (the strip's one filled element) / UNEQUIP (outline) when the
 * sheet is synced and the plate is usable or live; otherwise SPEC ▲,
 * which opens the drawer just like the left area does. */
function StripControl({
  action,
  plate,
  disabled,
  equipping,
  onEquip,
  onOpen
}: {
  action: StripAction
  plate: PlateDef | null
  disabled: boolean
  equipping: boolean
  onEquip: (plateId: string | null) => void
  onOpen: () => void
}) {
  switch (action) {
    case 'unequip':
      return (
        <button
          type="button"
          onClick={() => onEquip(null)}
          disabled={equipping}
          className={`${ACTION} border border-[color:var(--bag-ink)] ${INK} ${FOCUS}`}
        >
          {equipping ? 'WORKING…' : 'UNEQUIP'}
        </button>
      )
    case 'equip':
      return (
        <button
          type="button"
          onClick={() => plate && onEquip(plate.id)}
          disabled={equipping || plate === null}
          className={`${ACTION} bg-[color:var(--bag-signal)] font-bold text-[color:var(--bag-on-signal)] ${FOCUS_ON_SIGNAL}`}
        >
          {equipping ? 'EQUIPPING…' : 'EQUIP'}
        </button>
      )
    case 'spec':
      return (
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled}
          className={`${ACTION} ${INK} ${FOCUS} disabled:cursor-default disabled:opacity-40`}
        >
          SPEC
          <span aria-hidden>▲</span>
        </button>
      )
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}
