// Organization + category for every AI tool the AI board can rank.
// Keys are the display names resolveToolName() serves (src/lib/toolNames.ts)
// plus the coding-harness labels from src/lib/harnessBrands.ts, so the
// board can print a serious "ORG" column next to each tool the way Arena's
// leaderboard prints its Organization column, and so the category filter
// chips (ALL · CHAT · CODE · SEARCH · …) have something to filter on.
//
// ORG is the company that owns and ships the product today — after an
// acquisition closes, the acquirer, not the founding brand (Windsurf →
// Cognition, Leonardo AI → Canva, Base44 → Wix, Replicate → Cloudflare,
// Pika → Runway, Cursor → SpaceXAI). Talent-and-license deals that leave
// the company standing do not move it (Character AI, Groq, AI21 Labs).
// Ownership verified against public reporting as of Sep 2026; when a deal
// closes, edit the string here and nowhere else.
//
// CATEGORY is the tool's primary use, one of AI_CATEGORY_ORDER. 'other' is
// reserved for the unknown-name fallback in aiToolMeta(); no entry in this
// table may use it, so every ranked tool lands under a real chip.
//
// aiToolOrgs.test.ts guards drift: every TOOL_NAME_MAP value except Cribble
// must have a row here. Add a domain to toolNames.ts and the test fails
// until the tool is classified.
//
// Data-only (no React): shared by the API route and client components.

export type AiToolCategory =
  | 'chat'
  | 'code'
  | 'search'
  | 'image'
  | 'video'
  | 'audio'
  | 'agent'
  | 'writing'
  | 'platform'
  | 'other'

export interface AiToolMeta {
  org: string
  category: AiToolCategory
}

/** Display order for category filter chips. */
export const AI_CATEGORY_ORDER: readonly AiToolCategory[] = [
  'chat',
  'code',
  'search',
  'image',
  'video',
  'audio',
  'agent',
  'writing',
  'platform',
  'other'
]

/** Uppercase UI label per category, e.g. chat → 'CHAT'. */
export const AI_CATEGORY_LABEL: Record<AiToolCategory, string> = {
  chat: 'CHAT',
  code: 'CODE',
  search: 'SEARCH',
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
  agent: 'AGENT',
  writing: 'WRITING',
  platform: 'PLATFORM',
  other: 'OTHER'
}

export const AI_TOOL_META: Record<string, AiToolMeta> = {
  // Chat assistants
  ChatGPT: { org: 'OpenAI', category: 'chat' },
  Claude: { org: 'Anthropic', category: 'chat' },
  Gemini: { org: 'Google', category: 'chat' },
  Bard: { org: 'Google', category: 'chat' },
  // xAI was merged into SpaceX (Feb 2026) and renamed SpaceXAI (Jul 2026).
  Grok: { org: 'SpaceXAI', category: 'chat' },
  DeepSeek: { org: 'DeepSeek', category: 'chat' },
  Kimi: { org: 'Moonshot AI', category: 'chat' },
  'Qwen Chat': { org: 'Alibaba', category: 'chat' },
  'Z.ai': { org: 'Zhipu AI', category: 'chat' },
  Mistral: { org: 'Mistral AI', category: 'chat' },
  'Meta AI': { org: 'Meta', category: 'chat' },
  'Microsoft Copilot': { org: 'Microsoft', category: 'chat' },
  Poe: { org: 'Quora', category: 'chat' },
  'Character AI': { org: 'Character.AI', category: 'chat' },
  Replika: { org: 'Luka', category: 'chat' },
  // LMArena dropped the "LM" in Jan 2026; both names resolve to one org.
  LMArena: { org: 'Arena', category: 'chat' },
  Arena: { org: 'Arena', category: 'chat' },
  'LMSYS Chat': { org: 'LMSYS', category: 'chat' },
  // chatbot.com is Text S.A. (formerly LiveChat Software) — a bot builder,
  // so it sits with chat rather than writing.
  'Chatbot.com': { org: 'Text', category: 'chat' },

  // Coding & app builders
  // Anysphere became a SpaceX subsidiary inside SpaceXAI on 14 Aug 2026.
  Cursor: { org: 'SpaceXAI', category: 'code' },
  'GitHub Copilot': { org: 'GitHub', category: 'code' },
  Copilot: { org: 'GitHub', category: 'code' },
  Windsurf: { org: 'Cognition', category: 'code' },
  // Legacy domain from before the company renamed itself Windsurf.
  Codeium: { org: 'Codeium', category: 'code' },
  Tabnine: { org: 'Tricentis', category: 'code' },
  v0: { org: 'Vercel', category: 'code' },
  Bolt: { org: 'StackBlitz', category: 'code' },
  Lovable: { org: 'Lovable', category: 'code' },
  Replit: { org: 'Replit', category: 'code' },
  Base44: { org: 'Wix', category: 'code' },
  Jules: { org: 'Google', category: 'code' },
  // Harness labels (src/lib/harnessBrands.ts), for surfaces that print
  // the agent name rather than the folded AI-board tool name — the AI
  // board's AGENTS panel prints every registry brand's org from here.
  Codex: { org: 'OpenAI', category: 'code' },
  'Claude Code': { org: 'Anthropic', category: 'code' },
  'Gemini CLI': { org: 'Google', category: 'code' },
  // OpenCode is maintained by Anomaly Innovations (the SST company).
  OpenCode: { org: 'Anomaly', category: 'code' },
  // Hermes Agent is Nous Research's open-source agent harness.
  Hermes: { org: 'Nous Research', category: 'agent' },
  // Pi ships as @earendil-works/pi-coding-agent (Mario Zechner).
  Pi: { org: 'Earendil Works', category: 'code' },
  // Collector ids without a brand-registry entry title-case (see
  // tokenAgentLabel), so these keys match that output. oh-my-pi (`omp`,
  // Can Bölük's Pi fork) is © Stencil Labs, Inc.; OpenClaw is stewarded by
  // the OpenClaw Foundation since its author joined OpenAI (Feb 2026).
  Omp: { org: 'Stencil Labs', category: 'code' },
  Openclaw: { org: 'OpenClaw Foundation', category: 'agent' },

  // Search & answer engines
  Perplexity: { org: 'Perplexity', category: 'search' },
  'You.com': { org: 'You.com', category: 'search' },
  // Phind shut down in Jan 2026; kept for stored history.
  Phind: { org: 'Phind', category: 'search' },
  Genspark: { org: 'MainFunc', category: 'search' },

  // Image generation & photo
  Midjourney: { org: 'Midjourney', category: 'image' },
  'DALL·E': { org: 'OpenAI', category: 'image' },
  'Leonardo AI': { org: 'Canva', category: 'image' },
  Ideogram: { org: 'Ideogram', category: 'image' },
  Krea: { org: 'Krea', category: 'image' },
  Recraft: { org: 'Recraft', category: 'image' },
  'Adobe Firefly': { org: 'Adobe', category: 'image' },
  Civitai: { org: 'Civitai', category: 'image' },
  PhotoRoom: { org: 'Photoroom', category: 'image' },
  'Stability AI': { org: 'Stability AI', category: 'image' },

  // Video generation
  Sora: { org: 'OpenAI', category: 'video' },
  Runway: { org: 'Runway', category: 'video' },
  Pika: { org: 'Runway', category: 'video' },
  'Luma Dream Machine': { org: 'Luma AI', category: 'video' },
  'Kling AI': { org: 'Kuaishou', category: 'video' },
  'Hailuo AI': { org: 'MiniMax', category: 'video' },
  HeyGen: { org: 'HeyGen', category: 'video' },
  Synthesia: { org: 'Synthesia', category: 'video' },
  'InVideo AI': { org: 'InVideo', category: 'video' },
  InVideo: { org: 'InVideo', category: 'video' },
  VEED: { org: 'VEED', category: 'video' },
  Arcads: { org: 'Arcads', category: 'video' },
  Higgsfield: { org: 'Higgsfield', category: 'video' },

  // Audio & music
  ElevenLabs: { org: 'ElevenLabs', category: 'audio' },
  Suno: { org: 'Suno', category: 'audio' },
  Udio: { org: 'Udio', category: 'audio' },

  // Agents
  // Meta's 2025 purchase was unwound in 2026; Manus is independent again.
  Manus: { org: 'Butterfly Effect', category: 'agent' },

  // Writing & productivity
  Jasper: { org: 'Jasper', category: 'writing' },
  Writesonic: { org: 'Writesonic', category: 'writing' },
  'Copy.ai': { org: 'Copy.ai', category: 'writing' },
  Rytr: { org: 'Copysmith', category: 'writing' },
  Gamma: { org: 'Gamma', category: 'writing' },
  'Gemini Notebook': { org: 'Google', category: 'writing' },

  // Platforms & hosted playgrounds
  'Hugging Face': { org: 'Hugging Face', category: 'platform' },
  Groq: { org: 'Groq', category: 'platform' },
  'Together AI': { org: 'Together AI', category: 'platform' },
  Replicate: { org: 'Cloudflare', category: 'platform' },
  'fal.ai': { org: 'fal', category: 'platform' },
  'AI21 Studio': { org: 'AI21 Labs', category: 'platform' },
  AI21: { org: 'AI21 Labs', category: 'platform' },
  Cohere: { org: 'Cohere', category: 'platform' },
  RunPod: { org: 'RunPod', category: 'platform' },
  OpenAI: { org: 'OpenAI', category: 'platform' },
  'OpenAI Playground': { org: 'OpenAI', category: 'platform' },
  'OpenAI Beta': { org: 'OpenAI', category: 'platform' },
  'Claude Playground': { org: 'Anthropic', category: 'platform' },
  'AI Studio': { org: 'Google', category: 'platform' },
  'Google Labs': { org: 'Google', category: 'platform' }
}

const UNKNOWN_META: AiToolMeta = Object.freeze({ org: '—', category: 'other' })

/** Meta for a resolved tool display name; unknown names → { org: '—', category: 'other' }. */
export function aiToolMeta(name: string): AiToolMeta {
  return AI_TOOL_META[name] ?? UNKNOWN_META
}
