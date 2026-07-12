import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '@/lib/motion'

interface AnimatedCounterProps {
  value: number
  duration?: number
  formatter?: (value: number) => string
  className?: string
}

export default function AnimatedCounter({
  value,
  duration = 1000,
  formatter = (val) => val.toString(),
  className = ""
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(value)
  // The actually-painted value, updated every frame. Interrupted animations
  // restart from here instead of jumping to the previous target.
  const displayRef = useRef(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    const startValue = displayRef.current
    const difference = value - startValue
    if (difference === 0) return

    if (prefersReducedMotion()) {
      displayRef.current = value
      setDisplayValue(value)
      return
    }

    const startTime = performance.now()

    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1)

      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = startValue + difference * eased

      displayRef.current = current
      setDisplayValue(current)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        displayRef.current = value
        setDisplayValue(value)
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [value, duration])

  return (
    <span className={className}>
      {formatter(displayValue)}
    </span>
  )
}
