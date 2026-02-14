import { useEffect, useState } from 'react'

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
  const [displayValue, setDisplayValue] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    if (value === displayValue) return

    setIsAnimating(true)
    const startValue = displayValue
    const difference = value - startValue
    const startTime = Date.now()

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      
      // Use easeOutCubic for smooth animation
      const easeOutCubic = 1 - Math.pow(1 - progress, 3)
      const currentValue = startValue + (difference * easeOutCubic)
      
      setDisplayValue(currentValue)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        setDisplayValue(value)
        setIsAnimating(false)
      }
    }

    requestAnimationFrame(animate)
  }, [value, duration, displayValue])

  return (
    <span className={className}>
      {formatter(displayValue)}
    </span>
  )
}
