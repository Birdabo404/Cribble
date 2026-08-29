'use client'

import { useId, useState } from 'react'
import { rampVar, type RampName, type RampStep } from '@/components/achievements/palette'
import { ToolIcon } from '@/components/leaderboard/icons'
import {
  harnessBrandForLabel,
  harnessFallbackLetter,
  type HarnessMark
} from '@/lib/harnessBrands'
import { tokenAgentLabel } from '@/lib/tokenLeaderboard'

/** Deterministic same-size letter stand-in: exactly the glyph box the real
 *  mark would occupy, so a failed asset never shifts layout. Styled like
 *  ToolIcon's monogram so degraded brands look like unknown ones. */
function LetterMark({ letter, size }: { letter: string; size: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center font-display font-bold select-none"
      style={{ width: size, height: size, fontSize: size * 0.78, lineHeight: 1 }}
      aria-hidden
    >
      {letter}
    </span>
  )
}

/** Self-hosted brand asset tile. If the pinned file ever fails to load
 *  (broken deploy, blocked request), swap in the same-size letter fallback
 *  instead of the browser's broken-image glyph. The rounded clip keeps
 *  square avatar-style logos looking intentional. */
function ImageMark({
  src,
  label,
  size
}: {
  src: string
  label: string
  size: number
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return <LetterMark letter={harnessFallbackLetter(label)} size={size} />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      width={size}
      height={size}
      className="shrink-0 object-cover"
      style={{ borderRadius: Math.max(2, Math.round(size * 0.28)) }}
      onError={() => setFailed(true)}
    />
  )
}

type VectorMark = Exclude<HarnessMark, { kind: 'image' }>

/** Inline SVG mark drawn from registry path data. Paints its fill inline
 *  so official brand colors beat wrapper tints. */
function PathMark({ mark, size }: { mark: VectorMark; size: number }) {
  const gradientId = useId()
  switch (mark.kind) {
    case 'path':
      return (
        <svg
          viewBox="0 0 24 24"
          width={size}
          height={size}
          style={{ fill: mark.fill }}
          aria-hidden
        >
          <path d={mark.d} />
        </svg>
      )
    case 'gradient-path':
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              {mark.stops.map((stop) => (
                <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
              ))}
            </linearGradient>
          </defs>
          <path d={mark.d} fill={`url(#${gradientId})`} />
        </svg>
      )
    default: {
      const exhausted: never = mark
      return exhausted
    }
  }
}

/** Brand glyph for a known label, straight from the harness registry.
 *  Labels without a registry entry fall through to the shared ToolIcon,
 *  which keeps tool-name collisions (Grok, Perplexity…) on their marks and
 *  gives true unknowns the same-size currentColor monogram. */
function LabelMark({ label, size }: { label: string; size: number }) {
  const brand = harnessBrandForLabel(label)
  if (!brand) return <ToolIcon name={label} size={size} />
  if (brand.mark.kind === 'image') {
    return <ImageMark src={brand.mark.src} label={label} size={size} />
  }
  return <PathMark mark={brand.mark} size={size} />
}

/**
 * MIXED — an alchemy flask mid-reaction, drawn in the achievement-trophy
 * pixel language (16x16, shared --px-* tone ramps, one top-left light).
 * Two agents' liquids — plasma over ember — fold into each other along a
 * glowing seam, with a sparkle suspended in the brew and bubbles escaping
 * the mouth: several agents in one vessel, still blending, no clear top.
 * Chars: '1'-'4' ember shadow->highlight · '5'-'8' plasma · '9'-'c' ice.
 */
const MIXED_RAMPS: RampName[] = ['ember', 'plasma', 'ice']
const MIXED_GRID = [
  '................',
  '..........c.....',
  '........b.......',
  '......ba99......',
  '......b..9......',
  '......b..9......',
  '......b..9......',
  '.....b....9.....',
  '....b......9....',
  '...b877664339...',
  '..a77666632219..',
  '..a66c63222119..',
  '..a56632221119..',
  '..a55322211119..',
  '..a99999999999..',
  '................'
]

const SLOT_CHARS = '123456789abc'

/* Static sprite: collapse each row's horizontal runs of one fill into
   single rects once at module load, same trick as the achievements wall. */
const MIXED_RUNS: { x: number; y: number; w: number; fill: string }[] = []
MIXED_GRID.forEach((row, y) => {
  let x = 0
  while (x < row.length) {
    const slot = SLOT_CHARS.indexOf(row[x])
    if (slot === -1) {
      x += 1
      continue
    }
    let end = x + 1
    while (end < row.length && row[end] === row[x]) end += 1
    MIXED_RUNS.push({
      x,
      y,
      w: end - x,
      fill: rampVar(MIXED_RAMPS[Math.floor(slot / 4)], ((slot % 4) + 1) as RampStep)
    })
    x = end
  }
})

function MixedBrewGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
      {MIXED_RUNS.map((run, i) => (
        <rect key={i} x={run.x} y={run.y} width={run.w} height={1} fill={run.fill} />
      ))}
    </svg>
  )
}

/* Boxed chrome for the mixed brew: ember-to-plasma wash, matching how the
   liquids sit in the flask (ember lower-right, plasma upper-left). */
const MIXED_ACCENT = {
  edge: 'rgb(214 26 127 / 0.3)',
  surface: 'linear-gradient(145deg, rgb(234 88 12 / 0.13), rgb(214 26 127 / 0.11))'
}

export function TokenAgentIcon({
  agent,
  size = 18,
  className = '',
  bare = false,
  mixed = false
}: {
  agent: string | null
  size?: number
  className?: string
  /** Render only the brand-tinted glyph, without the boxed chrome — for inline text lines. */
  bare?: boolean
  /** When no top agent exists but several agents were reported, show the mixed-brew flask instead of '?'. */
  mixed?: boolean
}) {
  const label = tokenAgentLabel(agent)
  const accent = label ? harnessBrandForLabel(label)?.accent ?? null : null
  const showBrew = !label && mixed
  const box = Math.max(30, size + 16)

  if (bare) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center ${className}`}
        style={{ color: accent?.color ?? 'rgb(var(--z500))' }}
        aria-hidden
      >
        {label ? (
          <LabelMark label={label} size={size} />
        ) : showBrew ? (
          <MixedBrewGlyph size={size + 2} />
        ) : (
          <span style={{ fontSize: size }}>?</span>
        )}
      </span>
    )
  }

  const fallbackTitle = showBrew ? 'Mixed agents' : 'Agent not reported'

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[10px] ${className}`}
      style={{
        width: box,
        height: box,
        color: accent?.color ?? 'rgb(var(--z500))',
        border: `1px solid ${accent?.edge ?? (showBrew ? MIXED_ACCENT.edge : 'rgb(var(--lb-panel-edge) / 0.12)')}`,
        background: accent?.surface ?? (showBrew ? MIXED_ACCENT.surface : 'rgb(var(--lb-panel-edge) / 0.035)')
      }}
      title={label ?? fallbackTitle}
      aria-label={label ?? fallbackTitle}
    >
      {label ? (
        <LabelMark label={label} size={size} />
      ) : showBrew ? (
        <MixedBrewGlyph size={size + 4} />
      ) : (
        <span className="text-xs">?</span>
      )}
    </span>
  )
}
