// Shared vocabulary for the Cribble Premium surfaces (welcome modal +
// settings modal). Copy says "Premium"; the internal tier value stays
// 'PRO' everywhere.

/** Tailwind amber-300 — the PRO tier hue, same constant as the shop hero. */
export const AMBER = '252 211 77'

/** M-shaped crown over a baseline, tuned for 14–20px stroke rendering. */
export const CROWN_PATH = 'M2 20h20 M4 20 2 7l5.5 4L12 4l4.5 7L22 7l-2 13z'

export interface PremiumPerk {
  /** 24px-viewBox stroke path, feather-style like the nav ICONS maps. */
  icon: string
  label: string
}

/** The four subscription perks, mirroring the shop hero's pitch list. */
export const PREMIUM_PERKS: readonly PremiumPerk[] = [
  {
    icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21',
    label: 'Animated GIF banner on your profile'
  },
  {
    icon: 'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M8.21 13.89 7 23l5-3 5 3-1.21-9.12',
    label: 'Pixel blue check next to your name'
  },
  {
    icon: 'M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
    label: 'Three exclusive Pro Collection plates'
  },
  {
    icon: 'M19 5 5 19 M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    label: '25% off every plate in the depot'
  }
]

/** "JUN 2026" tail for the PREMIUM SINCE readouts — falls back to now
 *  when the grant predates premium_since stamping (field null/missing). */
export function formatPremiumSince(iso: string | null): string {
  const parsed = iso ? new Date(iso) : new Date()
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  return date
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase()
}
