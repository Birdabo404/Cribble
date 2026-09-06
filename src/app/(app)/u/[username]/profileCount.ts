// Numeral formatting for the profile's boot count-ups. Pure so the motion
// hook's onUpdate can call it every frame and the mapping from
// data-pf-format to the dashboard formatters stays pinned by a test rather
// than by eyeballing a tween. The markup renders the final string itself;
// this only has to agree with it at value === data-pf-count.

import {
  formatDuration,
  formatNumber,
  formatScore
} from '@/components/dashboard-v2/format'

/** The data-pf-format vocabulary. `score` compacts past 6 glyphs (pixel
 *  stat cells), `duration` takes milliseconds, `int` is a grouped integer.
 *  Switches over this union must keep a `never` default case. */
export type ProfileCountFormat = 'score' | 'duration' | 'int'

const FORMATS: ReadonlySet<string> = new Set<ProfileCountFormat>([
  'score',
  'duration',
  'int'
])

/** Narrows a raw dataset string; callers fall back to 'int' when false. */
export function isProfileCountFormat(
  raw: string | undefined
): raw is ProfileCountFormat {
  return raw !== undefined && FORMATS.has(raw)
}

/** Formats an in-flight count-up value. Integer formats round because a
 *  tween hands over fractions; duration takes the ms as-is since
 *  formatDuration floors internally. `prefix` is the literal glyph that
 *  sits before the numeral (RANK's "#"), so it rides along unchanged. */
export function formatProfileCount(
  value: number,
  format: ProfileCountFormat,
  prefix: string
): string {
  switch (format) {
    case 'score':
      return prefix + formatScore(Math.round(value))
    case 'duration':
      return prefix + formatDuration(value)
    case 'int':
      return prefix + formatNumber(Math.round(value))
    default: {
      const exhaustive: never = format
      return exhaustive
    }
  }
}
