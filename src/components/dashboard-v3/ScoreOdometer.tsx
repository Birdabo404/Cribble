'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatNumber } from '@/components/dashboard-v2/format'

/**
 * Instrument odometer score readout (Space Grotesk tabular numerals via
 * --font-display, ember glow).
 *
 * The layout is budgeted for an 8-digit maximum score (99,999,999 pts).
 * Every value is zero-padded to that width — leading zeros render dimmed —
 * so the panel never reflows as the score grows. If a score ever exceeds
 * the budget, the digit count expands and the font steps down a size so
 * the card still holds without breaking.
 *
 * First load: digits roll slot-machine style from 0, settling left → right
 * (rightmost digit spins the longest). Later updates take the short path,
 * only rolling the digits that changed.
 */
const DIGIT_BUDGET = 8

const FIRST_RUN_BASE_MS = 1300
const FIRST_RUN_STAGGER_MS = 190
const UPDATE_BASE_MS = 550
const UPDATE_STAGGER_MS = 90
const MAX_FIRST_RUN_SPINS = 4

const ROLL_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'

interface Roll {
  from: number
  to: number
  first: boolean
  gen: number
}

const digitAt = (value: number, placeFromRight: number) =>
  Math.floor(value / 10 ** placeFromRight) % 10

function sizeClass(digitCount: number) {
  // Space Grotesk tabular digits run ~0.6em wide (each reel is pinned to
  // 1ch), so the face can sit a step larger than the old pixel font did.
  if (digitCount <= DIGIT_BUDGET) return 'text-[22px] sm:text-[34px] md:text-[44px]'
  if (digitCount <= 10) return 'text-[18px] sm:text-[28px] md:text-[36px]'
  return 'text-[15px] sm:text-[22px] md:text-[28px]'
}

function DigitReel({
  from,
  to,
  spins,
  duration,
  dim
}: {
  from: number
  to: number
  spins: number
  duration: number
  dim: boolean
}) {
  const steps = spins * 10 + ((to - from + 10) % 10)
  const [engaged, setEngaged] = useState(false)
  const [instant, setInstant] = useState(false)

  useEffect(() => {
    if (steps === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInstant(true)
      setEngaged(true)
      return
    }
    // Double-raf so the reel paints at position 0 before the transition engages.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEngaged(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [steps])

  const glyphs = useMemo(
    () => Array.from({ length: steps + 1 }, (_, n) => (from + n) % 10),
    [from, steps]
  )

  return (
    <span
      className={`inline-block overflow-hidden text-center ${dim ? 'text-zinc-800' : 'text-zinc-50'}`}
      // 1ch pins every reel to the tabular digit advance, so glyph-width
      // differences can't make the row jitter while rolling.
      style={{ height: '1em', width: '1ch', textShadow: dim ? 'none' : undefined }}
    >
      <span
        className="block"
        style={{
          transform: engaged ? `translateY(-${steps}em)` : 'translateY(0)',
          transition:
            instant || steps === 0
              ? 'none'
              : `transform ${duration}ms ${ROLL_EASING}`,
          willChange: steps === 0 ? undefined : 'transform'
        }}
      >
        {glyphs.map((g, n) => (
          <span key={n} className="block" style={{ height: '1em', lineHeight: 1 }}>
            {g}
          </span>
        ))}
      </span>
    </span>
  )
}

export function ScoreOdometer({
  value,
  className = ''
}: {
  value: number
  className?: string
}) {
  const target = Math.max(0, Math.round(value))

  const [roll, setRoll] = useState<Roll>(() => ({
    from: 0,
    to: target,
    first: true,
    gen: 0
  }))
  const [rolling, setRolling] = useState(true)

  useEffect(() => {
    setRoll((r) =>
      r.to === target ? r : { from: r.to, to: target, first: false, gen: r.gen + 1 }
    )
  }, [target])

  // Accent glow flares while the reels roll, then settles.
  useEffect(() => {
    const sig = String(roll.to).length
    const total = roll.first
      ? FIRST_RUN_BASE_MS + (sig - 1) * FIRST_RUN_STAGGER_MS
      : UPDATE_BASE_MS + (sig - 1) * UPDATE_STAGGER_MS
    setRolling(true)
    const id = setTimeout(() => setRolling(false), total + 250)
    return () => clearTimeout(id)
  }, [roll])

  const digitCount = Math.max(DIGIT_BUDGET, String(roll.to).length)
  const sigCount = String(roll.to).length

  const reels = []
  for (let i = 0; i < digitCount; i++) {
    const place = digitCount - 1 - i
    const significant = i >= digitCount - sigCount
    // j = position within the significant digits, left → right.
    const j = i - (digitCount - sigCount)

    let fromDigit = 0
    let toDigit = 0
    let spins = 0
    let duration = 0
    if (significant) {
      fromDigit = digitAt(roll.from, place)
      toDigit = digitAt(roll.to, place)
      if (roll.first) {
        spins = Math.min(1 + j, MAX_FIRST_RUN_SPINS)
        duration = FIRST_RUN_BASE_MS + j * FIRST_RUN_STAGGER_MS
      } else {
        duration = UPDATE_BASE_MS + j * UPDATE_STAGGER_MS
      }
    }

    // Thin group gap every 3 digits (arcade counters skip commas).
    const grouped = i !== 0 && (digitCount - i) % 3 === 0

    reels.push(
      <span key={`${roll.gen}-${i}`} className={grouped ? 'ml-[0.3em]' : undefined}>
        <DigitReel
          from={fromDigit}
          to={toDigit}
          spins={spins}
          duration={duration}
          dim={!significant}
        />
      </span>
    )
  }

  return (
    <span
      className={`inline-flex ${sizeClass(digitCount)} ${className}`}
      style={{
        fontFamily: "var(--font-display), 'Inter', system-ui, sans-serif",
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
        textShadow: rolling
          ? '0 0 22px rgb(var(--ember-rgb)/0.45), 0 0 46px rgb(var(--ember-rgb)/0.18)'
          : '0 0 16px rgb(var(--ember-rgb)/0.14)',
        transition: 'text-shadow 700ms ease'
      }}
    >
      <span className="sr-only">{formatNumber(target)} PTS</span>
      <span aria-hidden className="flex items-center">
        {reels}
      </span>
    </span>
  )
}
