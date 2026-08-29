import { useId, type ReactNode } from 'react'
import { GEMINI_GRADIENT_STOPS, SIMPLE_ICON_PATHS } from '@/lib/harnessBrands'
import type { IconProps } from '@/components/welcome/icons'

/**
 * Icon set for the leaderboard arena.
 * Stroke glyphs are drawn on a 24px grid (Lucide path data, ISC license).
 * Social/tool brand marks use official path data from Simple Icons (CC0).
 * Glyphs and social marks render in currentColor so parents control the
 * hue; known AI tool marks paint their own official brand colors.
 */

function Stroke({
  size = 16,
  className = '',
  strokeWidth = 1.9,
  children
}: IconProps & { strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Arena glyphs                                                        */
/* ------------------------------------------------------------------ */

export function IconCrown(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />
      <path d="M5 21h14" />
    </Stroke>
  )
}

/** Filled crown silhouette — the stroked IconCrown turns to mush at 14px.
 *  Ball-tipped points (the jewels) over deep notched valleys, with a
 *  bottom edge curved to hug a round avatar when the crown sits tilted. */
export function IconCrownSolid({ size = 16, className = '' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M3.4 6.2 8.4 10.3 12 3.9 15.6 10.3 20.6 6.2 19.3 17.3 Q12 19.5 4.7 17.3 Z" />
      <circle cx="3.2" cy="4.8" r="1.7" />
      <circle cx="12" cy="2.9" r="1.9" />
      <circle cx="20.8" cy="4.8" r="1.7" />
    </svg>
  )
}

/** Two mirrored laurel sprigs on a wide short viewBox, cradling the
 *  bottom arc of an avatar. Leaves are filled vesicas fanning outward
 *  along each stem so the wreath still reads at ~40px wide. */
export function IconLaurel({ size = 44, className = '' }: IconProps) {
  const sprigId = useId()
  const leaf = 'M0 0 C-1.8 -2.2 -1.8 -4.4 0 -6.6 C1.8 -4.4 1.8 -2.2 0 0 Z'
  return (
    <svg
      viewBox="0 0 48 22"
      width={size}
      height={size * (22 / 48)}
      className={className}
      aria-hidden
    >
      <g id={sprigId} fill="currentColor">
        <path
          d="M23.2 19.6 C16 19.2 9.8 15.8 5.8 8.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path d={leaf} transform="translate(20.6 19.2) rotate(-95)" />
        <path d={leaf} transform="translate(15.9 17.9) rotate(-80)" />
        <path d={leaf} transform="translate(11.7 15.7) rotate(-64)" />
        <path d={leaf} transform="translate(8.2 12.6) rotate(-49)" />
        <path d={leaf} transform="translate(5.8 8.8) rotate(-32)" />
      </g>
      <use href={`#${sprigId}`} transform="matrix(-1 0 0 1 48 0)" />
    </svg>
  )
}

/** 4-point star — ambient spark for the podium champion and the
 *  standings rank regalia. */
export function IconSpark({
  size = 10,
  className = '',
  style
}: IconProps & { style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} className={className} style={style} aria-hidden>
      <path d="M6 0l1.35 4.65L12 6 7.35 7.35 6 12 4.65 7.35 0 6l4.65-1.35z" fill="currentColor" />
    </svg>
  )
}

export function IconTrophy(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </Stroke>
  )
}

export function IconMedal(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" />
      <path d="M11 12 5.12 2.2" />
      <path d="m13 12 5.88-9.8" />
      <path d="M8 7h8" />
      <circle cx="12" cy="17" r="5" />
      <path d="M12 18v-2h-.5" />
    </Stroke>
  )
}

export function IconFlame(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </Stroke>
  )
}

export function IconBolt(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </Stroke>
  )
}

export function IconUsers(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Stroke>
  )
}

export function IconPulse(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </Stroke>
  )
}

export function IconHourglass(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </Stroke>
  )
}

export function IconSearch(p: IconProps) {
  return (
    <Stroke {...p}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Stroke>
  )
}

export function IconLock(p: IconProps) {
  return (
    <Stroke {...p}>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Stroke>
  )
}

export function IconRefresh(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Stroke>
  )
}

export function IconClose(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Stroke>
  )
}

export function IconExpand(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M15 3h6v6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
      <path d="M9 21H3v-6" />
    </Stroke>
  )
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="m15 18-6-6 6-6" />
    </Stroke>
  )
}

export function IconChevronRight(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="m9 18 6-6-6-6" />
    </Stroke>
  )
}

export function IconChevronsRight(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="m6 17 5-5-5-5" />
      <path d="m13 17 5-5-5-5" />
    </Stroke>
  )
}

export function IconChevronDown(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="m6 9 6 6 6-6" />
    </Stroke>
  )
}

export function IconTrendingUp(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M16 7h6v6" />
      <path d="m22 7-8.5 8.5-5-5L2 17" />
    </Stroke>
  )
}

export function IconTarget(p: IconProps) {
  return (
    <Stroke {...p}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Stroke>
  )
}

export function IconCalendar(p: IconProps) {
  return (
    <Stroke {...p}>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 10h18" />
    </Stroke>
  )
}

export function IconSwords(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
      <path d="M9.5 6.5 21 18v3h-3L6.5 9.5" />
      <path d="M5 14l4 4" />
      <path d="M3 21l2-2" />
    </Stroke>
  )
}

export function IconShieldStar(p: IconProps) {
  return (
    <Stroke {...p}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M10 10h4" />
    </Stroke>
  )
}

/** Filled movement triangles — crisper than strokes at 8px. */
export function MoveGlyph({
  dir,
  size = 8,
  className = ''
}: {
  dir: 'up' | 'down'
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      {dir === 'up' ? (
        <path d="M6 1.5 11 10H1z" fill="currentColor" />
      ) : (
        <path d="M6 10.5 1 2h10z" fill="currentColor" />
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Social brand marks                                                  */
/* ------------------------------------------------------------------ */

export type SocialKind = 'x' | 'github' | 'youtube' | 'linkedin'

const SOCIAL_PATHS: Record<SocialKind, string> = {
  x: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  github:
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  youtube:
    'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  linkedin:
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'
}

export const SOCIAL_LABEL: Record<SocialKind, string> = {
  x: 'X',
  github: 'GitHub',
  youtube: 'YouTube',
  linkedin: 'LinkedIn'
}

const SOCIAL_BASE: Record<SocialKind, string> = {
  x: 'https://x.com/',
  github: 'https://github.com/',
  youtube: 'https://youtube.com/@',
  linkedin: 'https://linkedin.com/in/'
}

/** Accepts either a bare handle or a full URL stored in user metadata. */
export const socialHref = (kind: SocialKind, raw: string) =>
  raw.startsWith('http') ? raw : SOCIAL_BASE[kind] + raw.replace(/^@/, '')

export function SocialIcon({
  kind,
  size = 15,
  className = ''
}: {
  kind: SocialKind
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d={SOCIAL_PATHS[kind]} />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* AI tool marks — known brands render their official colors,          */
/* the monogram fallback keeps currentColor                            */
/* ------------------------------------------------------------------ */

/** Official brand mark path data (24px grid), Simple Icons (CC0).
 *  Harness-relevant geometry lives in src/lib/harnessBrands.ts (shared
 *  with TokenAgentIcon); tool-only marks stay local. */
const BRAND_PATHS = {
  ...SIMPLE_ICON_PATHS,
  perplexity:
    'M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z'
} as const

/**
 * Full ink for officially monochrome brands (OpenAI, Copilot, Cursor,
 * Grok): near-black on light surfaces, near-white on dark, and flipped
 * back to white inside dark plate slabs via the `.lb4-plated` var re-pin.
 */
const BRAND_INK = 'rgb(var(--z100))'

/** Brand marks paint their fill inline so official colors beat wrapper
 *  tints like `text-zinc-400`; unknown-tool monograms keep currentColor. */
function BrandMark({
  d,
  color,
  size = 16,
  className = ''
}: IconProps & { d: string; color: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{ fill: color }}
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}

function MarkOpenAI(p: IconProps) {
  return <BrandMark {...p} d={BRAND_PATHS.openai} color={BRAND_INK} />
}

function MarkClaude(p: IconProps) {
  return <BrandMark {...p} d={BRAND_PATHS.claude} color="#D97757" />
}

/** Official Gemini gradient, top-left blue to bottom-right violet.
 *  `useId` keeps the gradient def unique across instances on one page. */
function MarkGemini({ size = 16, className = '' }: IconProps) {
  const gradientId = useId()
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          {GEMINI_GRADIENT_STOPS.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
      </defs>
      <path d={BRAND_PATHS.gemini} fill={`url(#${gradientId})`} />
    </svg>
  )
}

function MarkPerplexity(p: IconProps) {
  return <BrandMark {...p} d={BRAND_PATHS.perplexity} color="#1FB8CD" />
}

function MarkCursor(p: IconProps) {
  return <BrandMark {...p} d={BRAND_PATHS.cursor} color={BRAND_INK} />
}

function MarkCopilot(p: IconProps) {
  return <BrandMark {...p} d={BRAND_PATHS.copilot} color={BRAND_INK} />
}

/** Grok ships under the X brand — Simple Icons carries no Grok/xAI mark
 *  (as of v16), so the X mark stays its recognizable face. */
function MarkGrok(p: IconProps) {
  return <BrandMark {...p} d={SOCIAL_PATHS.x} color={BRAND_INK} />
}

const TOOL_BRANDS: Record<string, (p: IconProps) => JSX.Element> = {
  ChatGPT: MarkOpenAI,
  OpenAI: MarkOpenAI,
  Codex: MarkOpenAI,
  'DALL·E': MarkOpenAI,
  'OpenAI Playground': MarkOpenAI,
  'OpenAI Beta': MarkOpenAI,
  Claude: MarkClaude,
  'Claude Code': MarkClaude,
  Gemini: MarkGemini,
  'Gemini CLI': MarkGemini,
  'AI Studio': MarkGemini,
  Bard: MarkGemini,
  Perplexity: MarkPerplexity,
  Cursor: MarkCursor,
  Copilot: MarkCopilot,
  'GitHub Copilot': MarkCopilot,
  Grok: MarkGrok,
  Bolt: IconBolt
}

/**
 * Icon chip for a resolved tool name. Known brands render their mark in
 * official brand colors; everything else gets a clean monogram (in
 * currentColor) so no tool ever looks broken.
 */
export function ToolIcon({
  name,
  size = 14,
  className = ''
}: {
  name: string
  size?: number
  className?: string
}) {
  const Brand = TOOL_BRANDS[name]
  if (Brand) return <Brand size={size} className={className} />
  return (
    <span
      className={`inline-flex items-center justify-center font-display font-bold select-none ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.78, lineHeight: 1 }}
      aria-hidden
    >
      {(name[0] || '?').toUpperCase()}
    </span>
  )
}
