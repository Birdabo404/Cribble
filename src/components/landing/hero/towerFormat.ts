// Number formatting shared by the hero tower's SSR markup (Tower.tsx) and
// its client-side liveness ticker (useTowerLiveness.ts), so a ticked cell
// is byte-identical in shape to the one it replaces.

import { SIM_ROSTER } from '@/components/landing/data'

/** P1's score — the numeral's "score to beat" and the GAP column's zero. */
export const P1_SCORE = SIM_ROSTER[0].score

const numberFormat = new Intl.NumberFormat('en-US')

export function formatScore(score: number): string {
  return numberFormat.format(score)
}

/** Distance behind the leader — P1 at rest; the liveness ticker passes the
 *  drifting value. Real minus (U+2212) so the gaps sit on the same tabular
 *  grid as the digits; the leader itself prints an em dash. */
export function formatGap(score: number, leader: number = P1_SCORE): string {
  const behind = leader - score
  return behind <= 0 ? '—' : `−${numberFormat.format(behind)}`
}
