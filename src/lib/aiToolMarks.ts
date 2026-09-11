// Brand marks for the AI board. Every tool row, the featured panel and the
// YOUR MACHINE dock render their mark through ToolMark, and ToolMark reads
// exclusively from this registry — so a tool gets its official geometry
// everywhere at once, or a monogram everywhere at once, never a mix.
//
// Marks are Simple Icons path data (CC0, 24px grid) imported by name so the
// bundler tree-shakes the 3,000+ icons we don't use, plus a few harness
// marks traced onto the same grid from the harness's own brand asset (see
// HARNESS_MARKS below; provenance in public/agents/LICENSES.md). They carry
// no color: the board renders them monochrome with `fill="currentColor"`
// and lets the parent choose ink or amber. Only a brand's own official
// mark is mapped — a look-alike or a parent company's mark is never
// substituted — so tools without one (Midjourney, Groq, Lovable, Runway,
// Microsoft Copilot…) fall back to a deterministic two-letter monogram via
// aiToolMonogram.
//
// Keys are the display names TOOL_NAME_MAP (src/lib/toolNames.ts) resolves
// raw domains to, plus the harness labels tokenAgentLabel produces (the
// registry labels in src/lib/harnessBrands.ts, or the title-cased
// collector id for harnesses outside the registry, e.g. `omp` → "Omp").
// This module is data-only (no React, no JSX).

import {
  siChatbot,
  siClaude,
  siClaudecode,
  siCursor,
  siDeepseek,
  siElevenlabs,
  siGithubcopilot,
  siGoogle,
  siGooglegemini,
  siGooglejules,
  siHuggingface,
  siKimi,
  siMetaai,
  siMinimax,
  siMistralai,
  siNotebooklm,
  siPerplexity,
  siPoe,
  siQwen,
  siReplicate,
  siReplit,
  siStackblitz,
  siSuno,
  siV0,
  siVeed,
  siWindsurf,
  siX,
  siZdotai,
  type SimpleIcon
} from 'simple-icons'
import { SIMPLE_ICON_PATHS } from './harnessBrands'

export interface AiToolMark {
  /** SVG path data on a 24×24 viewBox, single fill. */
  path: string
  /** Brand title as Simple Icons publishes it (for tooltips / debugging). */
  title: string
  /** Fill rule the path was authored for. Simple Icons omit it (nonzero);
   *  the traced harness marks cut their counters with evenodd. */
  fillRule?: 'nonzero' | 'evenodd'
}

function fromSimpleIcon(icon: SimpleIcon): AiToolMark {
  return { path: icon.path, title: icon.title }
}

/* Coding-harness marks that Simple Icons does not carry, traced onto the
   24-grid from each harness's own published mark (never a parent company's
   logo). All three are evenodd: their counters are separate subpaths.

   HERMES — Nous Research's "nous-girl" portrait, the mark hermes-agent's
   own BrandMark component renders on a white tile in both themes. Traced
   (potrace) from the pinned public/agents/hermes.png after a 64px
   downsample so hair strands finer than a board pixel drop out while the
   face, headband and bangs survive; ink is the fill, the white tile is
   left open. 11 subpaths, coordinates clamped to the 0–24 box.

   PI — the pixel-π glyph from public/agents/pi.svg (earendil-works
   favicon), lifted verbatim from its two paths and rescaled from the 800
   tile to a 22-unit box with a 1-unit margin (cell = 5.5). The dark tile
   behind it is dropped: the glyph is the mark.

   OMP — oh-my-pi's own `assets/icon.svg`: a π whose right leg ends in a
   plug connector. The bar, legs and connector body are unioned into one
   outline, the two connector prongs become counters (widened from 0.66 to
   0.8 units so they still register at 24px), and the two decorative
   accent dots on the bar — sub-pixel at board sizes — are omitted. Scaled
   from the 120×90 art box to a 22-unit width and centred vertically.

   OPENCODE — the identity mark from public/agents/opencode.svg (upstream
   packages/identity/mark.svg): a 4:5 frame with a grey block filling the
   lower two thirds of its counter. Single-colour has no grey, so the
   block joins the frame as ink and the remaining top third of the counter
   is the one cut — the frame + block + slot structure that identifies the
   mark survives, only the tone split goes. The near-black tile is dropped.
   Rescaled from the 512 tile so the 320-tall frame fills the same 22-unit
   height and 1-unit margin as Pi (cell = 4.4), centred horizontally. */
const HERMES_PATH =
  'M13.16 1.41C15.15 3.27 16.06 5.72 14.87 6.02C14.28 6.17 14.03 6.04 13.94 5.53C13.87 5.14 13.57 4.74 13.27 4.62C12.96 4.5 12.81 4.14 12.94 3.76C13.33 2.51 10.43 .37 8.34 .38C5.53 .38 1.21 3.35 2.54 4.36C3.25 4.9 4.5 5.04 4.5 4.59C4.5 4.44 5.6 4.33 6.95 4.35C8.82 4.37 9.49 4.24 9.75 3.78C9.95 3.46 10.11 3.32 10.11 3.48C10.12 3.64 10.52 3.51 11 3.2C11.48 2.88 11.98 2.73 12.11 2.86C12.52 3.27 11.64 4.48 11.09 4.27C10.76 4.14 10.59 4.32 10.63 4.76C10.67 5.18 10.48 5.39 10.13 5.31C9.63 5.2 7.76 5.22 2.52 5.39C.41 5.46 0 8.65 1.42 10.59C2.07 11.35 2.8 11.48 2.41 10.78C2.26 10.52 2.44 10.59 2.79 10.92C3.84 11.91 2.73 19.5 1.53 19.5C1.04 19.5 .46 18.65 .26 17.63C.16 17.11 .1 17.53 .13 18.56C.2 20.72 1.54 21.37 3.09 20C3.84 19.33 3.85 19.33 3.43 20.13C2.89 21.16 1.75 21.54 .76 21.01C.27 20.74 0 20.73 0 20.98C0 21.19 .51 21.62 1.13 21.94C1.74 22.26 2.25 22.68 2.25 22.87C2.25 23.56 3.71 24 4.5 23.63C5.01 23.35 5.25 23.35 5.25 23.61C5.25 24 11.06 24 12.45 23.29C13.13 22.9 14.11 22.46 14.63 22.33L15.56 22.08 14.63 22.83C14.12 23.24 13.82 23.7 13.98 23.85C14.13 24 14.63 23.78 15.1 23.35C15.64 22.84 16.53 22.54 17.63 22.48C19.92 22.37 20.25 22.43 20.25 22.95C20.25 23.3 20.15 23.3 19.8 22.95C19.55 22.7 19.18 22.5 18.97 22.5C18.3 22.5 20.4 23.79 21.25 23.91C22.32 24 23.86 22.61 24 21.19L24 20.06 23.67 21.24C23.27 21.89 22.72 22.55 22.47 22.71C22.21 22.87 22.28 22.6 22.62 22.1C23.79 20.44 23.12 15.38 20.6 6.75C19.7 3.7 19.27 2.97 18.78 3.72C18.46 4.21 16.88 4.72 16.88 4.33C16.88 4.23 17.31 3.75 17.84 3.26L18.81 2.36 17.38 1.18C16.15 .16 15.66 0 13.8 0L11.65 0 13.16 1.41M15.75 4.1C15.75 4.3 15.92 4.56 16.13 4.69C16.33 4.81 16.5 4.66 16.5 4.33C16.5 4.01 16.33 3.75 16.13 3.75C15.92 3.75 15.75 3.91 15.75 4.1M4.95 8.78C5.1 8.95 4.85 9.4 4.39 9.78C3.7 10.36 3.67 10.48 4.2 10.49C4.96 10.5 5.39 11.1 5.04 11.67C4.86 11.95 4.69 11.93 4.47 11.58C4.14 11.04 4.11 11.17 4.03 13.94C3.96 16.3 5.68 18.46 7.51 18.32C8.61 18.24 9.2 18.43 9.88 19.07C10.73 19.87 11.62 19.66 11.09 18.79C10.97 18.6 11.13 17.04 11.43 15.32C11.74 13.6 11.99 11.58 11.99 10.83L12 9.47 9.84 9.28C8.66 9.18 7.48 9.26 7.22 9.47C6.9 9.72 6.75 9.7 6.75 9.4C6.75 9.16 6.57 9.06 6.36 9.2C6.14 9.33 5.68 9.22 5.33 8.95C4.98 8.68 4.81 8.6 4.95 8.78M7.33 9.72C7.06 10.16 8.23 11.63 8.85 11.63C9.63 11.63 10.19 10.65 9.66 10.22C8.89 9.6 7.58 9.32 7.33 9.72M15.38 10.5C16.11 10.97 16.61 10.97 16.31 10.5C16.18 10.29 15.8 10.13 15.45 10.13C14.9 10.14 14.89 10.19 15.38 10.5M4.75 15.2C4.84 15.46 5.25 15.58 5.65 15.48C6.6 15.23 6.56 15.12 5.47 14.91C4.86 14.8 4.63 14.89 4.75 15.2M21.49 16.37C21.58 16.82 21.53 17.91 21.37 18.8C21.1 20.25 21.12 20.35 21.6 19.7C22.22 18.85 22.28 16.92 21.71 16.13C21.39 15.67 21.34 15.72 21.49 16.37M13.39 16.9C13.26 17.39 13.34 17.61 13.62 17.52C14.16 17.34 14.44 16.13 13.95 16.13C13.75 16.13 13.5 16.47 13.39 16.9M13.59 18.25C12.93 18.51 13.01 19.5 13.69 19.5C14 19.5 14.25 19.17 14.25 18.75C14.25 18.34 14.21 18.01 14.16 18.03C14.1 18.05 13.85 18.14 13.59 18.25M10.2 21C9.38 21.67 9.42 22.46 10.32 23.55C10.47 23.73 13.13 22.38 13.13 22.12C13.13 21.9 11.36 20.23 11.15 20.26C11.1 20.27 10.67 20.6 10.2 21M4.24 21.5C4.07 21.77 3.62 22.11 3.23 22.26C2.84 22.4 2.62 22.62 2.74 22.74C3.11 23.11 4.05 22.59 4.49 21.77C4.94 20.93 4.72 20.69 4.24 21.5'

const PI_PATH = 'M1 1H17.5V12H12V17.5H6.5V23H1ZM6.5 6.5V12H12V6.5ZM17.5 12H23V23H17.5Z'

const OMP_PATH =
  'M1 3.86H23V6.5H17.94V14.2H18.82V17.72H14.42V14.2H15.3V6.5H6.94V20.14H4.3V6.5H1ZM15.42 15H16.22V16.9H15.42ZM17.02 15H17.82V16.9H17.02Z'

const OPENCODE_PATH = 'M3.2 1H20.8V23H3.2ZM7.6 5.4V9.8H16.4V5.4Z'

export const HARNESS_MARKS = {
  hermes: { path: HERMES_PATH, title: 'Hermes Agent', fillRule: 'evenodd' },
  pi: { path: PI_PATH, title: 'Pi', fillRule: 'evenodd' },
  omp: { path: OMP_PATH, title: 'oh-my-pi', fillRule: 'evenodd' },
  opencode: { path: OPENCODE_PATH, title: 'OpenCode', fillRule: 'evenodd' }
} as const satisfies Record<string, AiToolMark>

/* Simple Icons dropped OpenAI upstream; the geometry is vendored once in
   harnessBrands and shared with the harness registry. */
const OPENAI: AiToolMark = { path: SIMPLE_ICON_PATHS.openai, title: 'OpenAI' }

const CLAUDE = fromSimpleIcon(siClaude)
const GEMINI = fromSimpleIcon(siGooglegemini)
const COPILOT = fromSimpleIcon(siGithubcopilot)
const CURSOR = fromSimpleIcon(siCursor)
const V0 = fromSimpleIcon(siV0)

/* Simple Icons has no xAI / Grok mark. Grok is X's assistant and the
   extension already folds x.com into the Grok tool, so the X mark is the
   repo's documented choice for the Grok row. */
const GROK = fromSimpleIcon(siX)

const AI_TOOL_MARKS: Readonly<Record<string, AiToolMark>> = {
  // OpenAI family — all ride the vendored OpenAI mark
  ChatGPT: OPENAI,
  OpenAI: OPENAI,
  'OpenAI Playground': OPENAI,
  'OpenAI Beta': OPENAI,
  Codex: OPENAI,
  'DALL·E': OPENAI,
  Sora: OPENAI,

  // Anthropic
  Claude: CLAUDE,
  'Claude Playground': CLAUDE,
  'Claude Code': fromSimpleIcon(siClaudecode),

  // Google
  Gemini: GEMINI,
  'Gemini CLI': GEMINI,
  Bard: GEMINI,
  'AI Studio': GEMINI,
  'Gemini Notebook': fromSimpleIcon(siNotebooklm),
  Jules: fromSimpleIcon(siGooglejules),
  'Google Labs': fromSimpleIcon(siGoogle),

  // xAI (see GROK note above)
  Grok: GROK,

  // Other model labs
  DeepSeek: fromSimpleIcon(siDeepseek),
  Kimi: fromSimpleIcon(siKimi),
  'Qwen Chat': fromSimpleIcon(siQwen),
  Mistral: fromSimpleIcon(siMistralai),
  'Meta AI': fromSimpleIcon(siMetaai),
  'Z.ai': fromSimpleIcon(siZdotai),
  'Hailuo AI': fromSimpleIcon(siMinimax),

  // Search & aggregators
  Perplexity: fromSimpleIcon(siPerplexity),
  Poe: fromSimpleIcon(siPoe),

  // Coding & app builders
  Cursor: CURSOR,
  Copilot: COPILOT,
  'GitHub Copilot': COPILOT,
  Windsurf: fromSimpleIcon(siWindsurf),
  v0: V0,
  Bolt: fromSimpleIcon(siStackblitz),
  Replit: fromSimpleIcon(siReplit),

  // Platforms, audio, video
  'Hugging Face': fromSimpleIcon(siHuggingface),
  Replicate: fromSimpleIcon(siReplicate),
  Suno: fromSimpleIcon(siSuno),
  ElevenLabs: fromSimpleIcon(siElevenlabs),
  VEED: fromSimpleIcon(siVeed),

  // Writing & productivity (ChatBot by LiveChat — chatbot.com / chatbot.design)
  'Chatbot.com': fromSimpleIcon(siChatbot),

  // Coding-agent harnesses (see HARNESS_MARKS). Keys are every label
  // tokenAgentLabel can produce for the harness — the registry label for
  // Hermes, Pi and OpenCode (`opencode` / `open-code` both resolve to
  // "OpenCode"); for oh-my-pi, which has no registry record, the
  // title-cased collector ids `omp` → "Omp" and `oh-my-pi` → "Oh My Pi" —
  // plus the brand's own spellings so hand-written names resolve too.
  Hermes: HARNESS_MARKS.hermes,
  'Hermes Agent': HARNESS_MARKS.hermes,
  Pi: HARNESS_MARKS.pi,
  OpenCode: HARNESS_MARKS.opencode,
  'Open Code': HARNESS_MARKS.opencode,
  Omp: HARNESS_MARKS.omp,
  OMP: HARNESS_MARKS.omp,
  'Oh My Pi': HARNESS_MARKS.omp,
  'oh-my-pi': HARNESS_MARKS.omp
}

/** Official monochrome mark for a resolved tool display name, or null when no faithful mark exists. */
export function aiToolMark(name: string): AiToolMark | null {
  return AI_TOOL_MARKS[name.trim()] ?? null
}

/* Hand-picked where the derived pair reads badly or collides with a
   neighbour on the board (Midjourney would derive to "MI", Groq to "GR",
   Lovable to "LO", Luma Dream Machine to "LD"). */
const MONOGRAM_OVERRIDES: Readonly<Record<string, string>> = {
  Midjourney: 'MJ',
  Groq: 'GQ',
  Lovable: 'LV',
  Runway: 'RW',
  'Character AI': 'CA',
  'Microsoft Copilot': 'MC',
  Ideogram: 'ID',
  'Leonardo AI': 'LE',
  'Luma Dream Machine': 'LU',
  'Kling AI': 'KL',
  'Hugging Face': 'HF'
}

const NON_ALNUM = /[^0-9A-Za-z]/g

/** Two-letter monogram used when aiToolMark returns null. Deterministic, uppercase. */
export function aiToolMonogram(name: string): string {
  const trimmed = name.trim()
  const override = MONOGRAM_OVERRIDES[trimmed]
  if (override) return override

  // Multi-word names take the initial of the first two words; single words
  // (and dotted names like "You.com" or "fal.ai") take their first two
  // letters or digits. Punctuation never lands in a monogram.
  const words = trimmed
    .split(/\s+/)
    .map((word) => word.replace(NON_ALNUM, ''))
    .filter(Boolean)
  const raw =
    words.length >= 2
      ? words[0].charAt(0) + words[1].charAt(0)
      : trimmed.replace(NON_ALNUM, '').slice(0, 2)

  return (raw.toUpperCase() + '??').slice(0, 2)
}
