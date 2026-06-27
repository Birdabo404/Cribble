import type { Tier } from '@/types/dashboard'

export const HACKER_GREEN = '#02fe01'

export const SEASON = {
  name: 'SEASON 01',
  startISO: '2026-04-01T00:00:00.000Z',
  endISO: '2026-07-01T00:00:00.000Z'
}

export const formatNumber = (n: number) => n.toLocaleString('en-US')

export const formatCompact = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

export const formatDuration = (ms: number) => {
  if (!ms || ms < 1000) return '0s'
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
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
      return 'text-[#02fe01] border-[#02fe01]/40 bg-[#02fe01]/5'
    default:
      return 'text-zinc-300 border-zinc-700 bg-zinc-900/60'
  }
}
