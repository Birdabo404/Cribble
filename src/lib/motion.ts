// Cached prefers-reduced-motion lookup. Callers hit this from hot paths
// (pointermove, rAF loops), so the MediaQueryList is created once instead
// of per call.

let mq: MediaQueryList | null = null

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  mq ??= window.matchMedia('(prefers-reduced-motion: reduce)')
  return mq.matches
}
