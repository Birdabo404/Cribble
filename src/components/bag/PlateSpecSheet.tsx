'use client'

// Bag manifest — the plate spec sheet. The one place on /bag where a plate
// is alive: a full-bleed live preview with the name as block type, the
// "as seen on the board" replica row (the only proof that matters — how
// the strip reads behind your own name), a dotted-leader spec table, the
// action block, and the barcode stamp. Presentational: status, sync and
// identity arrive resolved from the page; `onEquip` is the hook's equip.
//
// Host note: the frame draws registration crosses 4px outside its box, so
// the parent must not clip overflow and should leave it 4px of air.

import Link from 'next/link'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { formatCompact } from '@/components/dashboard-v2/format'
import { PLATE_RARITY_META, type PlateDef } from '@/lib/cosmetics/plates'
import {
  STATUS_META,
  acquisitionLine,
  plateSerial,
  rarityColor,
  rarityColorA,
  usd,
  type Identity,
  type PlateStatus,
  type SyncState
} from './bagModel'
import { Barcode } from './Barcode'
import {
  BAG_BLOCK,
  BAG_BLOCK_TYPE,
  BAG_COPY,
  BAG_MICRO,
  BAG_SHEET,
  RegFrame,
  SheetHeader,
  SpecLabel,
  SpecRow,
  SpecValue
} from './RegMarks'

export interface PlateSpecSheetProps {
  plate: PlateDef
  status: PlateStatus
  identity: Identity
  /** Cosmetics still in flight: status reads SYNCING, action is a ghost. */
  loading: boolean
  syncState: SyncState
  equipping: boolean
  onEquip: (plateId: string | null) => void
  /** 'drawer' (mobile bottom sheet) trades preview height for room. */
  variant?: 'panel' | 'drawer'
}

/** Every action is the same tap-floor mono bar; the branch only picks
 * fill. The focus ring is dashed ink 2px outside the box, so it reads on
 * paper around the filled EQUIP as well as around the outlines. */
const ACTION =
  'inline-flex min-h-[var(--bag-tap)] w-full items-center justify-center gap-2 [font-family:var(--bag-font-data)] text-[length:var(--bag-fs-label)] uppercase tracking-[0.2em] transition-colors focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--bag-focus)]'
const ACTION_BUSY = 'disabled:cursor-wait disabled:opacity-60'
const ACTION_OUTLINE =
  'border border-[color:var(--bag-line)] text-[color:var(--bag-ink)] hover:border-[color:var(--bag-ink)]'

export function PlateSpecSheet({
  plate,
  status,
  identity,
  loading,
  syncState,
  equipping,
  onEquip,
  variant = 'panel'
}: PlateSpecSheetProps) {
  const serial = plateSerial(plate.id)
  const rarity = PLATE_RARITY_META[plate.rarity]
  // A failed sync resolves everything to locked as a guess, not a fact —
  // the photocopy treatment would read as "not yours", so it waits.
  const dithered = status === 'locked' && !loading && syncState !== 'error'

  return (
    <RegFrame as="section" aria-label={`${plate.name} spec sheet`} className={BAG_SHEET}>
      <SheetHeader serial={serial} />

      {/* preview — live art, scrim, block-type name. Re-keyed per plate so
          a selection swap plays the two-frame terminal cut. */}
      <div key={plate.id} className="bag-cut bg-[color:var(--bag-paper)]">
        <div
          className={`relative overflow-hidden ${variant === 'drawer' ? 'aspect-[5/2]' : 'aspect-[3/1]'}`}
        >
          <PlateLayer plateId={plate.id} fade="none" />
          {dithered && <span aria-hidden className="bag-dither" />}
          {/* flat readability scrim: onset at 45% (not 55%) so a two-line
              name — SEASON 01: IGNITION at 360px — keeps its first line on
              paper-tinted ground in light mode too */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(180deg, transparent 45%, var(--bag-paper))' }}
          />
          <span
            className={`absolute right-3 top-3 px-1.5 py-1 ${BAG_MICRO} tracking-[0.18em]`}
            style={{
              color: rarityColor(plate.rarity),
              border: `1px solid ${rarityColorA(plate.rarity, 0.5)}`,
              background: 'var(--bag-paper)'
            }}
          >
            {rarity.label}
          </span>
          {/* sized for the 340px sheet at lg: two lines of SEASON 01:
              IGNITION still clear the rarity tag and the scrim onset */}
          <h2
            className={`absolute bottom-3 left-[var(--bag-pad)] right-[var(--bag-pad)] ${BAG_BLOCK_TYPE}`}
            style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.5rem)' }}
          >
            {plate.name}
          </h2>
        </div>
      </div>

      {/* board replica — the leaderboard row facsimile */}
      <div className={BAG_BLOCK}>
        <SpecLabel>AS SEEN ON THE BOARD</SpecLabel>
        <BoardReplica key={plate.id} plateId={plate.id} identity={identity} />
      </div>

      {/* spec table */}
      <dl className={`${BAG_BLOCK} m-0 grid gap-y-2`}>
        <SpecRow label="STATUS">
          <StatusReadout status={status} loading={loading} syncState={syncState} />
        </SpecRow>
        <SpecRow label="CLASS">
          <SpecValue style={{ color: rarityColor(plate.rarity) }}>{rarity.label}</SpecValue>
        </SpecRow>
        <SpecRow label="SOURCE">
          <SpecValue>{acquisitionLine(plate)}</SpecValue>
        </SpecRow>
        <SpecRow label="SERIAL">
          <SpecValue>{serial}</SpecValue>
        </SpecRow>
        {plate.seasonal && (
          <SpecRow label="SEASON">
            <SpecValue>{plate.seasonal.label}</SpecValue>
          </SpecRow>
        )}
        <SpecRow label="NOTE" block>
          <p className={`${BAG_COPY} m-0 text-[color:var(--bag-ink)]`}>{plate.tagline}</p>
        </SpecRow>
      </dl>

      {/* action */}
      <div className={BAG_BLOCK}>
        <PlateAction
          plate={plate}
          status={status}
          loading={loading}
          syncState={syncState}
          equipping={equipping}
          onEquip={onEquip}
        />
      </div>

      {/* stamp */}
      <div className={`${BAG_BLOCK} text-[color:var(--bag-mute)]`}>
        <Barcode seed={plate.id} caption={`${serial} · ${plate.id}`} />
        <p
          className={`mt-3 border-t border-[color:var(--bag-line)] pt-2 ${BAG_MICRO} tracking-[0.18em]`}
        >
          UNIT / {serial} · REV 2.6
        </p>
      </div>
    </RegFrame>
  )
}

/* ================= board replica ================= */

/** A 56px leaderboard row: avatar + name over the left-faded plate, score
 * on the right. The strip is paper, so the fade lands the art on the
 * theme's own surface; the score sits on a flat paper chip because the
 * art is a fixed product and light-mode ink would drown in it. */
function BoardReplica({ plateId, identity }: { plateId: string; identity: Identity }) {
  const initial = identity.name.charAt(0).toUpperCase() || '?'
  return (
    <div className="bag-cut relative mt-2 h-14 overflow-hidden border border-[color:var(--bag-line)] bg-[color:var(--bag-paper)]">
      <PlateLayer plateId={plateId} fade="left" />
      <div className="relative flex h-full items-center gap-3 px-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden bg-[color:var(--bag-well)]">
          {identity.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={identity.avatar}
              alt={`@${identity.username}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="[font-family:var(--bag-font-pixel)] text-[12px] leading-none text-[color:var(--bag-mute)]">
              {initial}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate [font-family:var(--bag-font-display)] text-[13px] font-semibold leading-tight text-[color:var(--bag-ink)]">
            {identity.name}
          </span>
          <span className={`truncate ${BAG_MICRO} tracking-[0.08em] text-[color:var(--bag-mute)]`}>
            @{identity.username}
          </span>
        </span>
        <span className="shrink-0 bg-[color:var(--bag-paper)] px-1.5 py-1 [font-family:var(--bag-font-pixel)] text-[12px] leading-none tabular-nums text-[color:var(--bag-ink)]">
          {identity.totalScore !== null ? formatCompact(identity.totalScore) : '—'}
        </span>
      </div>
    </div>
  )
}

/* ================= status readout ================= */

function StatusReadout({
  status,
  loading,
  syncState
}: {
  status: PlateStatus
  loading: boolean
  syncState: SyncState
}) {
  if (loading) return <SpecValue tone="mute">SYNCING</SpecValue>
  if (syncState === 'error') return <SpecValue tone="mute">UNKNOWN · SYNC FAILED</SpecValue>
  const meta = STATUS_META[status]
  return (
    <SpecValue tone={meta.tone}>
      <span aria-hidden>{meta.glyph}</span> {meta.label}
    </SpecValue>
  )
}

/* ================= action ================= */

function PlateAction({
  plate,
  status,
  loading,
  syncState,
  equipping,
  onEquip
}: {
  plate: PlateDef
  status: PlateStatus
  loading: boolean
  syncState: SyncState
  equipping: boolean
  onEquip: (plateId: string | null) => void
}) {
  if (loading) {
    return (
      <div
        aria-busy="true"
        className="flex min-h-[var(--bag-tap)] w-full items-center justify-center bg-[color:var(--bag-well)]"
      >
        <span className={`bag-cursor ${BAG_MICRO} tracking-[0.2em] text-[color:var(--bag-mute)]`}>
          SYNCING
        </span>
      </div>
    )
  }

  // Never offer a write against a sheet we could not read.
  if (syncState === 'error') {
    return (
      <button
        type="button"
        disabled
        className={`${ACTION} border border-[color:var(--bag-line)] text-[color:var(--bag-mute)] disabled:cursor-not-allowed`}
      >
        EQUIP UNAVAILABLE
      </button>
    )
  }

  switch (status) {
    case 'equipped':
      return (
        <button
          type="button"
          onClick={() => onEquip(null)}
          disabled={equipping}
          className={`${ACTION} ${ACTION_OUTLINE} ${ACTION_BUSY}`}
        >
          {equipping ? 'WORKING…' : 'UNEQUIP'}
        </button>
      )
    case 'usable':
      // the only filled element on the page
      return (
        <button
          type="button"
          onClick={() => onEquip(plate.id)}
          disabled={equipping}
          className={`${ACTION} ${ACTION_BUSY} bg-[color:var(--bag-signal)] font-bold text-[color:var(--bag-on-signal)] hover:opacity-90`}
        >
          {equipping ? 'EQUIPPING…' : 'EQUIP'}
        </button>
      )
    case 'locked':
      if (plate.priceUsd !== null) {
        return (
          <Link
            href="/shop"
            className={`${ACTION} border border-[color:var(--bag-signal-text)] text-[color:var(--bag-signal-text)] hover:bg-[color:var(--bag-well)]`}
          >
            GET IT — {usd(plate.priceUsd)} <span aria-hidden>→</span>
          </Link>
        )
      }
      if (plate.proExclusive) {
        return (
          <Link href="/shop" className={`${ACTION} ${ACTION_OUTLINE}`}>
            REQUIRES PRO <span aria-hidden>→</span>
          </Link>
        )
      }
      return (
        <p
          className={`flex min-h-[var(--bag-tap)] items-center justify-center border border-dashed border-[color:var(--bag-line)] ${BAG_MICRO} tracking-[0.2em] text-[color:var(--bag-mute)]`}
        >
          {plate.championExclusive ? 'NEVER SOLD · AWARDED AT #1' : 'NEVER SOLD · BETA GIFT'}
        </p>
      )
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}
