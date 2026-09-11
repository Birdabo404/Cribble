// Brand marks for the AI board. Every tool row, the featured panel and the
// YOUR MACHINE dock render their mark through ToolMark, and ToolMark reads
// exclusively from this registry — so a tool gets its official geometry
// everywhere at once, or a monogram everywhere at once, never a mix.
//
// Marks are Simple Icons path data (CC0, 24px grid) imported by name so the
// bundler tree-shakes the 3,000+ icons we don't use. They carry no color:
// the board renders them monochrome with `fill="currentColor"` and lets the
// parent choose ink or amber. Only a brand's own official mark is mapped —
// a look-alike or a parent company's mark is never substituted — so tools
// without one (Midjourney, Groq, Lovable, Runway, Microsoft Copilot…) fall
// back to a deterministic two-letter monogram via aiToolMonogram.
//
// Keys are the display names TOOL_NAME_MAP (src/lib/toolNames.ts) resolves
// raw domains to. This module is data-only (no React, no JSX).

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
}

function fromSimpleIcon(icon: SimpleIcon): AiToolMark {
  return { path: icon.path, title: icon.title }
}

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
  'Chatbot.com': fromSimpleIcon(siChatbot)
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
