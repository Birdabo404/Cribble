import { useEffect, useRef, useState } from 'react'

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
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    // Cancel any in-flight animation
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
    }

    const startValue = fromRef.current
    const difference = value - startValue

    // No change — skip animation
    if (difference === 0) return

    const startTime = Date.now()

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)

      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = startValue + difference * eased

      setDisplayValue(current)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        setDisplayValue(value)
        fromRef.current = value
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
      // Remember where we stopped so next animation starts from here
      fromRef.current = value
    }
  }, [value, duration]) // ← displayValue intentionally NOT in deps

  return (
    <span className={className}>
      {formatter(displayValue)}
    </span>
  )
}
