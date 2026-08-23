// Vendor + category taxonomy for every tracked AI tool domain.
//
// Source of truth for the aggregate-insights pipeline: the tool_taxonomy
// table (migration 032) is seeded from this map, and the nightly rollup
// stamps vendor/category onto daily_tool_aggregates rows through
// resolveToolTaxonomy(). Keys must cover listTrackedAiDomains() exactly —
// toolTaxonomy.test.ts pins both directions so the allowlist and this map
// can't drift apart.
//
// Vendor is the company operating the surface (v0.app -> Vercel,
// bolt.new -> StackBlitz, kling.ai -> Kuaishou), including acquirers where
// the product is now a subsidiary (Leonardo -> Canva, Base44 -> Wix).
// Category is the tool's primary usage surface, not its corporate line:
// fal.ai lives under image tools in the allowlist but is categorized as a
// hosted-model platform alongside Replicate.

export const TOOL_CATEGORIES = [
  'chat',
  'coding',
  'image',
  'video',
  'audio',
  'writing',
  'agent',
  'platform',
  'other'
] as const

export type ToolCategory = (typeof TOOL_CATEGORIES)[number]

export interface ToolTaxonomyEntry {
  vendor: string
  category: ToolCategory
}

export const UNKNOWN_TAXONOMY: ToolTaxonomyEntry = {
  vendor: 'Unknown',
  category: 'other'
}

export const TOOL_TAXONOMY: Record<string, ToolTaxonomyEntry> = {
  // Chat assistants
  'claude.ai': { vendor: 'Anthropic', category: 'chat' },
  'console.anthropic.com': { vendor: 'Anthropic', category: 'platform' },
  'platform.claude.com': { vendor: 'Anthropic', category: 'platform' },
  'chatgpt.com': { vendor: 'OpenAI', category: 'chat' },
  'chat.openai.com': { vendor: 'OpenAI', category: 'chat' },
  'platform.openai.com': { vendor: 'OpenAI', category: 'platform' },
  'grok.com': { vendor: 'xAI', category: 'chat' },
  'grok.x.ai': { vendor: 'xAI', category: 'chat' },
  'x.com': { vendor: 'xAI', category: 'chat' },
  'chat.deepseek.com': { vendor: 'DeepSeek', category: 'chat' },
  'copilot.microsoft.com': { vendor: 'Microsoft', category: 'chat' },
  'copilot.com': { vendor: 'Microsoft', category: 'chat' },
  'copilot.cloud.microsoft': { vendor: 'Microsoft', category: 'chat' },
  'meta.ai': { vendor: 'Meta', category: 'chat' },
  'kimi.com': { vendor: 'Moonshot AI', category: 'chat' },
  'kimi.ai': { vendor: 'Moonshot AI', category: 'chat' },
  'chat.qwen.ai': { vendor: 'Alibaba', category: 'chat' },
  'z.ai': { vendor: 'Zhipu AI', category: 'chat' },
  'chat.mistral.ai': { vendor: 'Mistral AI', category: 'chat' },
  'perplexity.ai': { vendor: 'Perplexity', category: 'chat' },
  'you.com': { vendor: 'You.com', category: 'chat' },
  'poe.com': { vendor: 'Quora', category: 'chat' },
  'phind.com': { vendor: 'Phind', category: 'chat' },
  // arena.ai is LMArena's post-rebrand home; both hosts are the same org.
  'lmarena.ai': { vendor: 'LMArena', category: 'chat' },
  'arena.ai': { vendor: 'LMArena', category: 'chat' },
  'character.ai': { vendor: 'Character.AI', category: 'chat' },
  'my.replika.ai': { vendor: 'Replika', category: 'chat' },
  'manus.im': { vendor: 'Manus', category: 'agent' },
  'genspark.ai': { vendor: 'Genspark', category: 'agent' },

  // Google
  'gemini.google.com': { vendor: 'Google', category: 'chat' },
  'aistudio.google.com': { vendor: 'Google', category: 'platform' },
  'notebooklm.google.com': { vendor: 'Google', category: 'writing' },
  'notebooklm.google': { vendor: 'Google', category: 'writing' },
  'notebook.google.com': { vendor: 'Google', category: 'writing' },
  'notebook.google': { vendor: 'Google', category: 'writing' },
  'labs.google': { vendor: 'Google', category: 'platform' },
  'jules.google': { vendor: 'Google', category: 'agent' },
  'jules.google.com': { vendor: 'Google', category: 'agent' },

  // Coding & app builders
  'github.com': { vendor: 'GitHub', category: 'coding' },
  'cursor.com': { vendor: 'Anysphere', category: 'coding' },
  'v0.app': { vendor: 'Vercel', category: 'coding' },
  'lovable.dev': { vendor: 'Lovable', category: 'coding' },
  'bolt.new': { vendor: 'StackBlitz', category: 'coding' },
  'replit.com': { vendor: 'Replit', category: 'coding' },
  'app.base44.com': { vendor: 'Wix', category: 'coding' },

  // Video generation
  'sora.chatgpt.com': { vendor: 'OpenAI', category: 'video' },
  'sora.com': { vendor: 'OpenAI', category: 'video' },
  'app.arcads.ai': { vendor: 'Arcads', category: 'video' },
  'higgsfield.ai': { vendor: 'Higgsfield', category: 'video' },
  'app.runwayml.com': { vendor: 'Runway', category: 'video' },
  'pika.art': { vendor: 'Pika', category: 'video' },
  'lumalabs.ai': { vendor: 'Luma AI', category: 'video' },
  'app.lumalabs.ai': { vendor: 'Luma AI', category: 'video' },
  'kling.ai': { vendor: 'Kuaishou', category: 'video' },
  'hailuoai.video': { vendor: 'MiniMax', category: 'video' },
  'app.heygen.com': { vendor: 'HeyGen', category: 'video' },
  'app.synthesia.io': { vendor: 'Synthesia', category: 'video' },
  'ai.invideo.io': { vendor: 'InVideo', category: 'video' },

  // Image generation & photo
  'midjourney.com': { vendor: 'Midjourney', category: 'image' },
  'app.leonardo.ai': { vendor: 'Canva', category: 'image' },
  'ideogram.ai': { vendor: 'Ideogram', category: 'image' },
  'krea.ai': { vendor: 'Krea', category: 'image' },
  'recraft.ai': { vendor: 'Recraft', category: 'image' },
  'firefly.adobe.com': { vendor: 'Adobe', category: 'image' },
  'civitai.com': { vendor: 'Civitai', category: 'image' },
  'app.photoroom.com': { vendor: 'Photoroom', category: 'image' },
  'fal.ai': { vendor: 'fal', category: 'platform' },

  // Audio & music
  'elevenlabs.io': { vendor: 'ElevenLabs', category: 'audio' },
  'suno.com': { vendor: 'Suno', category: 'audio' },
  'udio.com': { vendor: 'Udio', category: 'audio' },

  // Writing & productivity
  'app.jasper.ai': { vendor: 'Jasper', category: 'writing' },
  'app.writesonic.com': { vendor: 'Writesonic', category: 'writing' },
  'app.copy.ai': { vendor: 'Copy.ai', category: 'writing' },
  'app.rytr.me': { vendor: 'Rytr', category: 'writing' },
  'gamma.app': { vendor: 'Gamma', category: 'writing' },

  // Platforms & hosted playgrounds
  'huggingface.co': { vendor: 'Hugging Face', category: 'platform' },
  'groq.com': { vendor: 'Groq', category: 'platform' },
  'api.together.ai': { vendor: 'Together AI', category: 'platform' },
  'replicate.com': { vendor: 'Replicate', category: 'platform' },
  'studio.ai21.com': { vendor: 'AI21 Labs', category: 'platform' },

  // Cribble
  'cribble.dev': { vendor: 'Cribble', category: 'other' }
}

/**
 * Resolve a stored event domain to its taxonomy entry. Exact match first,
 * then strip "www.", then walk up parent domains — the same resolution
 * resolveToolName / resolveTrackedAiDomain use — so pre-canonicalization
 * rows ("www.kimi.com", "chat.z.ai") still classify. Anything unmatched
 * (legacy retired domains included) falls back to Unknown/other.
 */
export function resolveToolTaxonomy(
  domain: string | null | undefined
): ToolTaxonomyEntry {
  if (!domain) return UNKNOWN_TAXONOMY
  let host = domain.toLowerCase().trim()
  if (host.startsWith('www.')) host = host.slice(4)
  while (host.includes('.')) {
    const entry = TOOL_TAXONOMY[host]
    if (entry) return entry
    host = host.slice(host.indexOf('.') + 1)
  }
  return UNKNOWN_TAXONOMY
}
