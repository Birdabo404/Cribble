// Bag manifest — the badge spec sheet. A 16x16 sprite blown up on a
// dot-matrix well with registration crosses, the name as block type, and
// the dotted-leader table: status, class, category, progress (readout plus
// a 20-cell segmented block bar — no rounded track), unlock stamp, note.
// Locked badges render the sprite through the void ramp and keep their
// class muted; `unit: 'none'` badges have no counter, so progress reads
// CLASSIFIED. Deep progress lives on /dashboard/achievements, linked from
// the stamp footer.
//
// Host note: the frame draws registration crosses 4px outside its box, so
// the parent must not clip overflow and should leave it 4px of air.

import Link from 'next/link'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import {
  badgeSerial,
  formatProgressValue,
  formatUnlockDate,
  rarityColor,
  type AchievementRow
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
  SpecRow,
  SpecValue
} from './RegMarks'

export interface BadgeSpecSheetProps {
  row: AchievementRow
  /** 'drawer' (mobile bottom sheet) shortens the well and the sprite. */
  variant?: 'panel' | 'drawer'
}

const BAR_CELLS = 20

export function BadgeSpecSheet({ row, variant = 'panel' }: BadgeSpecSheetProps) {
  const serial = badgeSerial(row.id)
  const unlocked = row.unlockedAt !== null
  const hue = rarityColor(row.rarity)
  const drawer = variant === 'drawer'

  return (
    <RegFrame as="section" aria-label={`${row.name} spec sheet`} className={BAG_SHEET}>
      <SheetHeader serial={serial} />

      {/* well + name — re-keyed per badge so the swap plays the cut */}
      <div key={row.id} className={`bag-cut ${BAG_BLOCK}`}>
        <div
          className={`bag-regmarks relative flex items-center justify-center border border-[color:var(--bag-line-soft)] ${drawer ? 'aspect-[2/1]' : 'aspect-[3/2]'}`}
          style={{
            backgroundImage: 'radial-gradient(var(--bag-line-soft) 1px, transparent 1px)',
            backgroundSize: '8px 8px',
            backgroundPosition: '0 0'
          }}
        >
          <PixelIcon name={row.icon} size={drawer ? 96 : 128} locked={!unlocked} />
        </div>
        <h2
          className={`mt-4 ${BAG_BLOCK_TYPE}`}
          style={{ fontSize: 'clamp(1.5rem, 2.5vw, 2.25rem)' }}
        >
          {row.name}
        </h2>
      </div>

      {/* spec table */}
      <dl className={`${BAG_BLOCK} m-0 grid gap-y-2`}>
        <SpecRow label="STATUS">
          {unlocked ? (
            <SpecValue style={{ color: hue }}>
              <span aria-hidden>◆</span> UNLOCKED
            </SpecValue>
          ) : (
            <SpecValue tone="mute">LOCKED</SpecValue>
          )}
        </SpecRow>
        <SpecRow label="CLASS">
          <SpecValue tone="mute" style={unlocked ? { color: hue } : undefined}>
            {row.rarity}
          </SpecValue>
        </SpecRow>
        <SpecRow label="CATEGORY">
          <SpecValue>{row.category}</SpecValue>
        </SpecRow>
        <ProgressRow row={row} unlocked={unlocked} hue={hue} />
        {row.unlockedAt !== null && (
          <SpecRow label="UNLOCKED">
            <SpecValue>{formatUnlockDate(row.unlockedAt)}</SpecValue>
          </SpecRow>
        )}
        <SpecRow label="NOTE" block>
          <p className={`${BAG_COPY} m-0 text-[color:var(--bag-ink)]`}>{row.description}</p>
        </SpecRow>
      </dl>

      {/* stamp */}
      <div className={`${BAG_BLOCK} text-[color:var(--bag-mute)]`}>
        <Barcode seed={row.id} caption={`${serial} · ${row.id}`} />
        <div className="mt-3 flex justify-end border-t border-[color:var(--bag-line)] pt-1">
          <Link
            href="/dashboard/achievements"
            className={`inline-flex min-h-[var(--bag-tap)] items-center gap-1 ${BAG_MICRO} tracking-[0.18em] text-[color:var(--bag-ink)] decoration-1 underline-offset-[3px] hover:underline focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--bag-focus)]`}
          >
            FULL SERVICE RECORD <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </RegFrame>
  )
}

/* ================= progress ================= */

function ProgressRow({
  row,
  unlocked,
  hue
}: {
  row: AchievementRow
  unlocked: boolean
  hue: string
}) {
  if (row.unit === 'none') {
    return (
      <SpecRow label="PROGRESS">
        <SpecValue tone="mute">CLASSIFIED</SpecValue>
      </SpecRow>
    )
  }

  const current = Math.min(row.current, row.target)
  // Unlocked always prints full — a granted badge can sit under target.
  // Otherwise floor, so the last cell only lights when the badge does.
  const filled = unlocked
    ? BAR_CELLS
    : row.target > 0
      ? Math.min(BAR_CELLS, Math.floor((current / row.target) * BAR_CELLS))
      : 0
  // Unlocked prints in its class hue; progress toward a locked badge is
  // plain ink — the signal hue means "equipped" and nothing else.
  const fill = unlocked ? hue : 'var(--bag-ink)'

  return (
    <SpecRow
      label="PROGRESS"
      detail={
        <div
          role="progressbar"
          aria-label={`${row.name} progress`}
          aria-valuemin={0}
          aria-valuemax={row.target}
          aria-valuenow={current}
          className="grid grid-cols-[repeat(20,1fr)] gap-px border border-[color:var(--bag-line-soft)] p-px"
        >
          {Array.from({ length: BAR_CELLS }, (_, i) => (
            <span
              key={i}
              className="h-1.5"
              style={{ background: i < filled ? fill : 'var(--bag-well)' }}
            />
          ))}
        </div>
      }
    >
      <SpecValue>
        {formatProgressValue(row.unit, current)} / {formatProgressValue(row.unit, row.target)}
      </SpecValue>
    </SpecRow>
  )
}
