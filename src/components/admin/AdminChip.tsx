'use client'

import type { ReactNode } from 'react'

// One chip for the whole staff console. Tones are the only color chips
// carry (color means state): emerald = healthy, amber = needs attention /
// elevated, red = danger, sky = staff / informational, neutral = inert.
// Hue utilities sit at mid saturation (600) so a single class string reads
// on both the dark #0a0a0b canvas and the light #ffffff one; danger rides
// the theme-aware --st-danger tokens.

export type AdminChipTone = 'neutral' | 'good' | 'warn' | 'danger' | 'info'

/** Text + border classes for a tone, for the rare custom element that
 *  needs chip coloring without the chip layout. */
export function chipToneClasses(tone: AdminChipTone): string {
  switch (tone) {
    case 'neutral':
      return 'border-[color:var(--st-border-strong)] text-[color:var(--st-text-muted)]'
    case 'good':
      return 'border-emerald-600/40 text-emerald-600'
    case 'warn':
      return 'border-amber-600/40 text-amber-600'
    case 'danger':
      return 'border-[color:var(--st-danger-muted)] text-[color:var(--st-danger)]'
    case 'info':
      return 'border-sky-600/40 text-sky-600'
    default: {
      const exhaustive: never = tone
      return exhaustive
    }
  }
}

export interface AdminChipProps {
  tone?: AdminChipTone
  title?: string
  className?: string
  children: ReactNode
}

/** Bordered micro-chip. Labels stay short uppercase — the only
 *  scream-case allowed in the console. */
export function AdminChip({ tone = 'neutral', title, className = '', children }: AdminChipProps) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-data text-[11px] font-medium uppercase leading-none tracking-[0.08em] ${chipToneClasses(tone)} ${className}`}
    >
      {children}
    </span>
  )
}

export interface AdminChipMeta {
  label: string
  tone: AdminChipTone
}

/** Account status → chip (active / suspended / banned). */
export function statusChipMeta(status: string): AdminChipMeta {
  if (status === 'banned') return { label: 'BANNED', tone: 'danger' }
  if (status === 'suspended') return { label: 'SUSPENDED', tone: 'warn' }
  return { label: 'ACTIVE', tone: 'good' }
}

/** Staff role → chip; null for members without panel access. */
export function staffChipMeta(role: string | null): AdminChipMeta | null {
  if (role === 'owner') return { label: 'OWNER', tone: 'warn' }
  if (role === 'moderator') return { label: 'MODERATOR', tone: 'info' }
  return null
}

/** Account tier → chip. Free stays quiet; paid tiers read informational. */
export function tierChipMeta(tier: string): AdminChipMeta {
  const label = tier.toUpperCase()
  return { label, tone: label === 'FREE' ? 'neutral' : 'info' }
}

/** Feedback category → chip (bug / idea / other). */
export function categoryChipMeta(category: string): AdminChipMeta {
  if (category === 'bug') return { label: 'BUG', tone: 'danger' }
  if (category === 'idea') return { label: 'IDEA', tone: 'info' }
  return { label: 'OTHER', tone: 'neutral' }
}
