'use client'

// Register empty state, shared by both compartments: the filter set left
// nothing on the sheet, so say so in the manifest's own voice and offer
// the one way out. The button is the page's only outline action at this
// size — tap-floor tall, hairline border, mono label, square.

import { LABEL, MICRO, OPTION_HOVER } from './registerChrome'

export interface RegisterEmptyProps {
  onClearFilters: () => void
  /** Defaults to `[ NO ENTRIES ]`. */
  message?: string
}

export function RegisterEmpty({ onClearFilters, message = '[ NO ENTRIES ]' }: RegisterEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-10">
      <p role="status" className={`${MICRO} text-[color:var(--bag-mute)]`}>
        {message}
      </p>
      <button
        type="button"
        onClick={onClearFilters}
        className={`${LABEL} ${OPTION_HOVER} min-h-[var(--bag-tap)] min-w-[10rem] appearance-none border border-[color:var(--bag-line)] bg-[color:var(--bag-paper)] px-5 text-[color:var(--bag-ink)] outline-none touch-manipulation focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--bag-focus)]`}
      >
        CLEAR FILTERS
      </button>
    </div>
  )
}
