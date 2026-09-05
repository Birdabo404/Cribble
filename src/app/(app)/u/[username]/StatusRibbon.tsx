'use client'

// STATUS RIBBON — the live strip at the top of the content column that
// keeps a parked profile from reading as a screenshot. Left cell: the
// SYS.TIME clock (1s interval, a <time>). Right cell: one telemetry line
// from ribbonLines, swapped every 6s. The line's span re-keys on every
// flip and scrambles itself through useDecode (the shared glyph set),
// armed unless the viewer prefers reduced motion — so it carries
// data-pf-decode="live", which the boot timeline's decode pass skips
// (it would race this one for the text). A rank loss prints the whole
// line in --pf-alert — the line stays one text node. Below sm the two
// cells stack.

import { useEffect, useMemo, useState } from 'react'
import { prefersReducedMotion } from '@/lib/motion'
import { useDecode } from '@/lib/useDecode'
import { PATH_CLOCK, Stroke } from './parts'
import { ribbonLines, sysTime, type RibbonInput } from './ribbonLines'

/** Telemetry dwell per line. */
export const RIBBON_FLIP_MS = 6_000

export function StatusRibbon({
  profile,
  chase,
  className = ''
}: {
  profile: RibbonInput
  chase: string | null
  className?: string
}) {
  const [now, setNow] = useState(() => new Date())
  // The flip counter carries its own timestamp: lines are rebuilt per
  // flip (not per clock tick) so LAST SEEN's relative stamp only moves
  // when the line comes round again.
  const [flip, setFlip] = useState(() => ({ tick: 0, at: new Date() }))

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1_000)
    const swap = setInterval(
      () => setFlip((f) => ({ tick: f.tick + 1, at: new Date() })),
      RIBBON_FLIP_MS
    )
    return () => {
      clearInterval(clock)
      clearInterval(swap)
    }
  }, [])

  const lines = useMemo(() => ribbonLines(profile, chase, flip.at), [profile, chase, flip.at])
  const line = lines[flip.tick % lines.length]

  return (
    <div
      className={`pf-panel pf-frame flex flex-col gap-1 px-[var(--pf-inset)] py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${className}`}
    >
      <span className="pf-micro flex items-center gap-2 tabular-nums">
        <Stroke d={PATH_CLOCK} size={10} className="shrink-0" />
        <time dateTime={now.toISOString()}>{sysTime(now)}</time>
      </span>
      <TelemetryLine key={flip.tick} text={line.text} alert={line.alert} />
    </div>
  )
}

/** One decoded line. Mounts fresh on every flip (keyed by the caller),
 *  so the scramble runs from the first frame of the new text. */
function TelemetryLine({ text, alert }: { text: string; alert: boolean }) {
  const { out } = useDecode(text, !prefersReducedMotion())
  return (
    <span
      data-pf-decode="live"
      className="pf-label min-w-0 truncate sm:text-right"
      style={alert ? { color: 'var(--pf-alert)' } : undefined}
    >
      {out}
    </span>
  )
}
