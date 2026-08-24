import type { IconProps } from '@/components/welcome/icons'

/** Official GoatCounter mark (public/logo.svg) — purple goat stroke. */
const GOAT_PURPLE = '#9a15a4'

export function IconGoatCounter({ size = 14, className = '' }: IconProps) {
  return (
    <svg
      viewBox="0 0 417 429"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <path
        d="M25.399,235.075l118.517,-135.285c0,0 -124.734,-57.004 -120.995,-58.98c182.412,-96.381 370.769,214.033 370.769,214.033l-24.839,65.501c0,0 -169.954,-0.509 -192.464,-75.727"
        fill="none"
        stroke={GOAT_PURPLE}
        strokeWidth={44.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M179.11,406.252c-0.044,-36.273 38.389,-117.225 38.389,-117.225"
        fill="none"
        stroke={GOAT_PURPLE}
        strokeWidth={44.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
