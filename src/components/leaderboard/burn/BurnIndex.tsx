// The `[01]` index — the burn board's rank, in the AI board's bracketed
// register. Ember by default (the .bb-idx rule); the podium prints in the
// arena's medal hue (gold / platinum / bronze via medalFor), which with
// the avatar ring is the whole of the top three's regalia.

import { padRank } from '@/components/leaderboard/ai/aiBoardState'
import { medalFor } from '@/components/leaderboard/types'

export function BurnIndex({ rank }: { rank: number }) {
  const medal = medalFor(rank)
  return (
    <span className="bb-idx" style={medal ? { color: medal.fg } : undefined}>
      [{padRank(rank)}]
    </span>
  )
}
