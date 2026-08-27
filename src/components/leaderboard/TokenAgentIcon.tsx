import { rampVar, type RampName, type RampStep } from '@/components/achievements/palette'
import { ToolIcon } from '@/components/leaderboard/icons'
import { tokenAgentLabel } from '@/lib/tokenLeaderboard'

const AGENT_ACCENTS: Record<string, { color: string; edge: string; surface: string }> = {
  Codex: {
    color: 'rgb(var(--z100))',
    edge: 'rgb(16 163 127 / 0.38)',
    surface: 'linear-gradient(145deg, rgb(16 163 127 / 0.18), rgb(var(--lb-panel-edge) / 0.04))'
  },
  'Claude Code': {
    color: '#D97757',
    edge: 'rgb(217 119 87 / 0.4)',
    surface: 'linear-gradient(145deg, rgb(217 119 87 / 0.17), rgb(var(--lb-panel-edge) / 0.04))'
  },
  Cursor: {
    color: 'rgb(var(--z100))',
    edge: 'rgb(var(--lb-panel-edge) / 0.2)',
    surface: 'linear-gradient(145deg, rgb(var(--lb-panel-edge) / 0.12), rgb(var(--lb-panel-edge) / 0.025))'
  },
  'Gemini CLI': {
    color: '#8B9DFF',
    edge: 'rgb(139 157 255 / 0.4)',
    surface: 'linear-gradient(145deg, rgb(33 123 254 / 0.16), rgb(189 153 254 / 0.1))'
  },
  'GitHub Copilot': {
    color: 'rgb(var(--z100))',
    edge: 'rgb(168 85 247 / 0.34)',
    surface: 'linear-gradient(145deg, rgb(168 85 247 / 0.14), rgb(var(--lb-panel-edge) / 0.035))'
  },
  /* Hermes' mark is monochrome ink-on-white (Nous renders it on a white tile
     in both themes), so the chrome is a neutral silver tint, not a hue. */
  Hermes: {
    color: 'rgb(var(--z100))',
    edge: 'rgb(var(--lb-panel-edge) / 0.24)',
    surface:
      'linear-gradient(145deg, rgb(var(--lb-panel-edge) / 0.14), rgb(var(--lb-panel-edge) / 0.03))'
  }
}

/** Agents whose brand mark is a raster image (label → self-hosted /public
 * path) rather than an SVG glyph in icons.tsx. Checked before ToolIcon. */
const AGENT_IMAGE_MARKS: Record<string, string> = {
  Hermes: '/agents/hermes.png'
}

/** Brand glyph for a known label: image tile when the agent ships a raster
 * mark, otherwise the shared SVG ToolIcon (which monogram-falls-back). The
 * rounded clip keeps square avatar-style logos looking intentional. */
function LabelMark({ label, size }: { label: string; size: number }) {
  const src = AGENT_IMAGE_MARKS[label]
  if (!src) return <ToolIcon name={label} size={size} />
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
    />
  )
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
  const accent = label ? AGENT_ACCENTS[label] : null
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
