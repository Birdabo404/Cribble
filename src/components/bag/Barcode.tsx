// Bag manifest — a deterministic barcode stamp. Hashes the seed (FNV-1a)
// and runs it through xorshift32 to draw ~48 bars, widths 1–3 units and
// gaps 1–2 units, so the same id always prints the same code and two ids
// never look alike. Pure SVG rects in currentColor, stretched to the
// container width; decorative, so it is hidden from assistive tech and
// the optional caption carries the human-readable stamp.

import { BAG_MICRO } from './RegMarks'

const BAR_COUNT = 48

/** FNV-1a, 32-bit. Never zero (xorshift would stall on it). */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash === 0 ? 0x9e3779b9 : hash
}

function xorshift32(state: number): number {
  let x = state
  x ^= x << 13
  x >>>= 0
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

interface Bar {
  x: number
  width: number
}

function barsFor(seed: string): { bars: Bar[]; total: number } {
  let state = fnv1a(seed)
  const bars: Bar[] = []
  let x = 0
  for (let i = 0; i < BAR_COUNT; i += 1) {
    state = xorshift32(state)
    // low two bits → width 1..3 (a 3-way cycle keeps thick bars rarer than
    // the 1s and 2s), next bit → gap 1..2
    const width = ((state & 0b11) % 3) + 1
    const gap = ((state >>> 2) & 0b1) + 1
    bars.push({ x, width })
    x += width + gap
  }
  // drop the trailing gap so the last bar lands flush right
  const last = bars[bars.length - 1]
  const total = last ? last.x + last.width : 1
  return { bars, total }
}

export interface BarcodeProps {
  /** Any stable id; the same seed always draws the same code. */
  seed: string
  /** Bar height in px; the code stretches horizontally to its container. */
  height?: number
  /** Human-readable stamp printed under the bars, uppercased. */
  caption?: string
  className?: string
}

export function Barcode({ seed, height = 24, caption, className = '' }: BarcodeProps) {
  const { bars, total } = barsFor(seed)
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <svg
        aria-hidden
        viewBox={`0 0 ${total} 1`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        shapeRendering="crispEdges"
        className="block"
      >
        {bars.map((bar) => (
          <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={1} fill="currentColor" />
        ))}
      </svg>
      {caption !== undefined && (
        <span className={`${BAG_MICRO} tracking-[0.18em]`}>{caption.toUpperCase()}</span>
      )}
    </div>
  )
}
