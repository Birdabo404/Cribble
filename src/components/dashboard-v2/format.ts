import type { Tier } from '@/types/dashboard'

export { ACCENT, accentA } from '@/lib/theme'

export const formatNumber = (n: number) => n.toLocaleString('en-US')

export const formatCompact = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

/** Scoreboard numerals: exact with grouping while short, compact once the
 * grouped form would blow past ~6 glyphs (pixel-font stat cells have room
 * for about that many). 99,999 → "99,999"; 142,500 → "143K";
 * 1,234,567 → "1.23M". Never longer than 5 characters once compacted. */
export const formatScore = (n: number) => {
  const abs = Math.abs(n)
  if (abs < 100_000) return formatNumber(n)
  const sig = (v: number) => {
    const a = Math.abs(v)
    const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)
    return s.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')
  }
  // Unit thresholds sit at 999,500 so rounding never yields "1000K".
  if (abs < 999_500) return `${sig(n / 1_000)}K`
  if (abs < 999_500_000) return `${sig(n / 1_000_000)}M`
  return `${sig(n / 1_000_000_000)}B`
}

export const formatDuration = (ms: number) => {
  if (!ms || ms < 1000) return '0s'
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  // Past 100h the minutes are noise and the string stops fitting stat cells.
  if (hours >= 100) return `${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

export const formatRelative = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / 86400_000)}d ago`
}

export const tierAccent = (tier: Tier | undefined): string => {
  switch (tier) {
    case 'PRO':
      return 'text-amber-300 border-amber-300/40 bg-amber-300/5'
    case 'PREMIUM':
    case 'PREMIUM+':
      return 'text-zinc-100 border-zinc-300/40 bg-zinc-300/5'
    case 'AFFILIATE':
      return 'text-cyan-300 border-cyan-300/40 bg-cyan-300/5'
    case 'BASIC':
      return 'text-accent border-accent/40 bg-accent/5'
    default:
      return 'text-zinc-300 border-zinc-700 bg-zinc-900/60'
  }
}
