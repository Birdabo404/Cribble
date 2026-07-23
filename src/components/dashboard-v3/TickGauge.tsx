import { animDelay } from './anim'

/**
 * Segmented instrument tick gauge — a row of thin ticks, the filled span
 * in ember with a brighter "needle head" on the leading tick, the rest an
 * ice track. Ticks cascade in left → right after the card lands.
 */
export function TickGauge({
  pct,
  segments = 24,
  delayMs = 0,
  className = ''
}: {
  pct: number
  segments?: number
  delayMs?: number
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, pct))
  const filled = Math.round((clamped / 100) * segments)

  const tickClass = (i: number) => {
    if (i >= filled) return 'bg-ice/15'
    if (i === filled - 1) return 'bg-ember shadow-[0_0_5px_rgb(var(--ember-rgb)/0.55)]'
    return 'bg-ember/80'
  }

  return (
    <div className={`flex items-center gap-[2px] ${className}`} aria-hidden>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={`anim-cell h-full min-w-0 flex-1 rounded-[1px] ${tickClass(i)}`}
          style={animDelay(delayMs + i * 12)}
        />
      ))}
    </div>
  )
}
