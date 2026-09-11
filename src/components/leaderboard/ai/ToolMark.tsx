// Monochrome brand mark for one AI tool on the board. Renders the official
// Simple Icons geometry from src/lib/aiToolMarks as a single-fill SVG that
// inherits `currentColor`, so the parent decides ink vs amber. Tools with
// no faithful mark get a two-letter monogram in a 1px hairline square —
// square corners are a hard rule for this board, no radius anywhere.
// Decorative only (aria-hidden): the tool name is always rendered as text
// beside it.

import type { CSSProperties } from 'react'
import { aiToolMark, aiToolMonogram } from '@/lib/aiToolMarks'

export function ToolMark({
  name,
  size = 16,
  className = ''
}: {
  name: string
  size?: number
  className?: string
}): JSX.Element {
  const mark = aiToolMark(name)

  if (mark) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden
        className={className}
      >
        <path d={mark.path} />
      </svg>
    )
  }

  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    flexShrink: 0,
    width: size,
    height: size,
    border: '1px solid rgb(var(--aib-edge, 214 218 228) / 0.55)',
    fontFamily: 'var(--font-data), ui-monospace, monospace',
    fontWeight: 600,
    fontSize: Math.round(size * 0.42),
    lineHeight: 1,
    letterSpacing: 0,
    color: 'currentColor',
    userSelect: 'none',
    borderRadius: 0
  }

  return (
    <span aria-hidden className={className} style={style}>
      {aiToolMonogram(name)}
    </span>
  )
}
