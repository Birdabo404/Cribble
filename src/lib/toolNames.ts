// Maps raw event domains to display-friendly AI tool names.
// Shared by the tools API (top-tools card) and the achievements
// evaluator (distinct-tool achievements), so both count "chatgpt.com"
// and "chat.openai.com" as the same tool.
//
// Keys mirror cribble-extension/config/ai-tools.js (AI_TOOLS), plus the
// LEGACY block for domains we no longer track but that still exist in
// stored events_raw history. Resolution walks up parent domains like the
// extension does, so "chat.z.ai" resolves via the "z.ai" entry.

const TOOL_NAME_MAP: Record<string, string> = {
  // Chat assistants
  'claude.ai': 'Claude',
  'console.anthropic.com': 'Anthropic Workbench',
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'platform.openai.com': 'OpenAI Playground',
  'grok.com': 'Grok',
  'grok.x.ai': 'Grok',
  'x.com': 'Grok',
  'chat.deepseek.com': 'DeepSeek',
  'copilot.microsoft.com': 'Microsoft Copilot',
  'meta.ai': 'Meta AI',
  'kimi.com': 'Kimi',
  'chat.qwen.ai': 'Qwen Chat',
  'z.ai': 'Z.ai',
  'chat.mistral.ai': 'Mistral',
  'perplexity.ai': 'Perplexity',
  'you.com': 'You.com',
  'poe.com': 'Poe',
  'phind.com': 'Phind',
  'lmarena.ai': 'LMArena',
  'arena.ai': 'Arena',
  'character.ai': 'Character AI',
  'my.replika.ai': 'Replika',
  'manus.im': 'Manus',
  'genspark.ai': 'Genspark',

  // Google
  'gemini.google.com': 'Gemini',
  'aistudio.google.com': 'AI Studio',
  'notebooklm.google.com': 'NotebookLM',
  'labs.google': 'Google Labs',
  'jules.google': 'Jules',
  'jules.google.com': 'Jules',

  // Coding & app builders
  'github.com': 'GitHub Copilot',
  'cursor.com': 'Cursor',
  'v0.app': 'v0',
  'lovable.dev': 'Lovable',
  'bolt.new': 'Bolt',
  'replit.com': 'Replit',
  'app.base44.com': 'Base44',

  // Video generation
  'sora.chatgpt.com': 'Sora',
  'sora.com': 'Sora',
  'app.arcads.ai': 'Arcads',
  'higgsfield.ai': 'Higgsfield',
  'app.runwayml.com': 'Runway',
  'pika.art': 'Pika',
  'lumalabs.ai': 'Luma Dream Machine',
  'kling.ai': 'Kling AI',
  'hailuoai.video': 'Hailuo AI',
  'app.heygen.com': 'HeyGen',
  'app.synthesia.io': 'Synthesia',
  'ai.invideo.io': 'InVideo AI',

  // Image generation & photo
  'midjourney.com': 'Midjourney',
  'app.leonardo.ai': 'Leonardo AI',
  'ideogram.ai': 'Ideogram',
  'krea.ai': 'Krea',
  'recraft.ai': 'Recraft',
  'firefly.adobe.com': 'Adobe Firefly',
  'civitai.com': 'Civitai',
  'app.photoroom.com': 'PhotoRoom',
  'fal.ai': 'fal.ai',

  // Audio & music
  'elevenlabs.io': 'ElevenLabs',
  'suno.com': 'Suno',
  'udio.com': 'Udio',

  // Writing & productivity
  'app.jasper.ai': 'Jasper',
  'app.writesonic.com': 'Writesonic',
  'app.copy.ai': 'Copy.ai',
  'app.rytr.me': 'Rytr',
  'gamma.app': 'Gamma',

  // Platforms & hosted playgrounds
  'huggingface.co': 'Hugging Face',
  'groq.com': 'Groq',
  'api.together.ai': 'Together AI',
  'replicate.com': 'Replicate',
  'studio.ai21.com': 'AI21 Studio',

  // Cribble
  'cribble.dev': 'Cribble',

  // LEGACY — no longer tracked, but present in stored event history.
  'anthropic.com': 'Claude',
  'openai.com': 'OpenAI',
  'labs.openai.com': 'DALL·E',
  'playground.openai.com': 'OpenAI Playground',
  'beta.openai.com': 'OpenAI Beta',
  'deepseek.com': 'DeepSeek',
  'qwen.ai': 'Qwen Chat',
  'mistral.ai': 'Mistral',
  'chat.lmsys.org': 'LMSYS Chat',
  'replika.ai': 'Replika',
  'bard.google.com': 'Bard',
  'copilot.github.com': 'Copilot',
  'cursor.sh': 'Cursor',
  'lovable.ai': 'Lovable',
  'v0.dev': 'v0',
  'base44.com': 'Base44',
  'windsurf.com': 'Windsurf',
  'codeium.com': 'Codeium',
  'tabnine.com': 'Tabnine',
  'arcads.ai': 'Arcads',
  'runwayml.com': 'Runway',
  'klingai.com': 'Kling AI',
  'heygen.com': 'HeyGen',
  'synthesia.io': 'Synthesia',
  'veed.io': 'VEED',
  'invideo.io': 'InVideo',
  'leonardo.ai': 'Leonardo AI',
  'stability.ai': 'Stability AI',
  'photoroom.com': 'PhotoRoom',
  'jasper.ai': 'Jasper',
  'writesonic.com': 'Writesonic',
  'copy.ai': 'Copy.ai',
  'rytr.me': 'Rytr',
  'chatbot.com': 'Chatbot.com',
  'together.ai': 'Together AI',
  'cohere.ai': 'Cohere',
  'ai21.com': 'AI21',
  'runpod.io': 'RunPod'
}

export function resolveToolName(rawDomain: string): string {
  let host = (rawDomain || '').toLowerCase().trim()
  if (!host) return 'Unknown'
  if (host.startsWith('www.')) host = host.slice(4)
  // Exact match first, then walk up parent domains — same resolution the
  // extension's resolveTool() uses, so subdomain rows merge correctly.
  let cursor = host
  while (cursor.includes('.')) {
    if (TOOL_NAME_MAP[cursor]) return TOOL_NAME_MAP[cursor]
    cursor = cursor.slice(cursor.indexOf('.') + 1)
  }
  if (TOOL_NAME_MAP[host]) return TOOL_NAME_MAP[host]
  const fallback = (host.split('.')[0] || 'Unknown')
    .replace(/\W+/g, '')
    .slice(0, 16)
  return fallback.charAt(0).toUpperCase() + fallback.slice(1)
}
