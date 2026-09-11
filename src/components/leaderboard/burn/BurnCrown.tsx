// The one ornament on the ledger: rank 1's crown, leading THE MONARCH in
// the persona seat and standing in for the phone tool line's persona dot.
// The same filled silhouette GLOBAL's champion avatar wears and the stat
// strip's TOP BURNER carries, so one crown means "first" across the
// page. Decorative — the title text beside it carries the meaning — and
// it takes its gold from the surrounding colour (medalFor(1).fg).

import { IconCrownSolid } from '@/components/leaderboard/icons'

export function BurnCrown({ size = 13 }: { size?: number }) {
  return (
    <span className="bb-crown" aria-hidden>
      <IconCrownSolid size={size} className="block" />
    </span>
  )
}
