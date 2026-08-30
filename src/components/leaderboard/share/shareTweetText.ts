import { formatNumber, formatScore } from '@/components/dashboard-v2/format'
import {
  compareExactDecimals,
  formatCompactTokenCount,
  usdDisplayParts
} from '@/lib/tokenLeaderboard'
import type { ShareCardVariant } from './ShareCard'

export interface ShareTweetOpts {
  variant: ShareCardVariant
  isOwn: boolean
  username: string
  rank: number
  score: number
  link: string
  /** exact-decimal token count for the ember quote; falls back to score */
  totalTokens?: string | null
  /** exact-decimal USD for the ember quote; omitted when missing or zero */
  costUsd?: string | null
}

function emberQuote(score: number, totalTokens?: string | null, costUsd?: string | null): string {
  const tokens = totalTokens
    ? `${formatCompactTokenCount(totalTokens)} tokens torched`
    : `${formatScore(score)} tokens torched`
  if (!costUsd || compareExactDecimals(costUsd, '0') <= 0) return tokens
  const cost = usdDisplayParts(costUsd)
  return `${tokens} · ${cost.tiny ? '<' : ''}$${cost.number}`
}

/**
 * Composer copy for POST ON X.
 *
 *   #{rank} {headline}
 *
 *   > {flex line}
 *
 *   {cta}
 *   {link}
 */
export function shareTweetText(opts: ShareTweetOpts): string {
  const { variant, isOwn, username, rank, score, link, totalTokens, costUsd } = opts
  const who = isOwn ? '' : `@${username} `
  switch (variant) {
    case 'medal':
      return [
        `#${rank} ${who}on cribble`,
        '',
        `> ${formatNumber(score)} pts`,
        '',
        isOwn ? 'join me. outrank me.' : 'join me. get on the board.',
        link
      ].join('\n')
    case 'ember':
      return [
        `#${rank} ${who}on cribble's burn board`,
        '',
        `> ${emberQuote(score, totalTokens, costUsd)}`,
        '',
        isOwn ? 'join me. burn whatever.' : 'join me. burn with us.',
        link
      ].join('\n')
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}
