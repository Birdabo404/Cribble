// Rack grid compartment for a Season 01 plate that isn't on sale yet:
// PlateCard's anatomy with the art well sealed and no doors — nothing to
// inspect, buy or equip. The well is the same fixed dark slab PlatePreview
// mounts art on, so the sealed cards sit in the grid like empty frames.

import { JP as JP_COPY, type UnavailablePlate } from './catalog'
import { RarityTick, SeasonTag } from './chips'
import { COPY, DISPLAY, JP_KICKER, LINE, MICRO, MUTE, PAPER_BG } from './shopChrome'

const NAME = `${DISPLAY} ${MUTE} text-[15px] font-semibold leading-tight tracking-[-0.01em] md:text-[length:calc(15px/0.9)]`

export function UnavailableCard({ plate }: { plate: UnavailablePlate }) {
  return (
    <article className={`relative flex h-full flex-col p-[var(--shop-pad)] ${PAPER_BG}`}>
      <div className={`flex items-center justify-between gap-3 ${MICRO}`}>
        <span className={MUTE}>/--</span>
        <span className="flex min-w-0 items-center gap-2">
          <RarityTick rarity={plate.rarity} />
          <span aria-hidden className={MUTE}>
            ·
          </span>
          <SeasonTag label={plate.seasonal.label} />
        </span>
      </div>

      <div
        aria-hidden
        className="relative mt-3 flex aspect-[4/1] w-full items-center justify-center overflow-hidden rounded-xl"
        style={{
          background:
            'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 10px), rgb(9 10 13)',
          border: '1px solid rgb(255 255 255 / 0.1)'
        }}
      >
        <span className={MICRO} style={{ color: 'rgb(244 244 245 / 0.5)' }}>
          UNAVAILABLE
        </span>
      </div>

      <div className="mt-3 min-w-0">
        <h3 className={NAME}>{plate.name}</h3>
        <p className={`mt-1 line-clamp-1 ${COPY} ${MUTE}`}>Still in the studio.</p>
      </div>

      <div className="mt-auto flex items-center justify-end pt-3">
        <span
          className={`inline-flex h-8 items-center gap-2 border border-dashed px-3 ${LINE} ${MICRO} ${MUTE}`}
        >
          UNAVAILABLE
          <span lang="ja" className={JP_KICKER}>
            {JP_COPY.unavailable}
          </span>
        </span>
      </div>
    </article>
  )
}
