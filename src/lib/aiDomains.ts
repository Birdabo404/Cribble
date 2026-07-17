// Server-side allowlist of trackable AI tool domains.
// Must stay in sync with cribble-extension/config/ai-tools.js (AI_TOOLS keys).
//
// POLICY: only usage surfaces count — hosts where the user actually operates
// an AI tool in the browser (types a prompt, generates media, runs an agent).
// Corporate/marketing sites (openai.com, anthropic.com, mistral.ai, ...) are
// deliberately absent: visiting a vendor homepage is not AI usage.
//
// Matching mirrors the extension's resolveTool(): exact hostname first, then
// strip "www.", then walk up parent domains, so "chat.z.ai" resolves to the
// registered "z.ai" entry. resolveTrackedAiDomain() returns the canonical
// registry key so ingestion can normalize what it stores; events reported
// for hostnames outside this list are rejected at ingestion so forged
// payloads can't inflate scores with arbitrary domains.

const TRACKED_AI_DOMAINS = new Set([
  // Chat assistants
  'claude.ai',
  'console.anthropic.com',
  'chatgpt.com',
  'chat.openai.com',
  'platform.openai.com',
  'grok.com',
  'grok.x.ai',
  'x.com',
  'chat.deepseek.com',
  'copilot.microsoft.com',
  'meta.ai',
  'kimi.com',
  'chat.qwen.ai',
  'z.ai',
  'chat.mistral.ai',
  'perplexity.ai',
  'you.com',
  'poe.com',
  'phind.com',
  'lmarena.ai',
  'arena.ai',
  'character.ai',
  'my.replika.ai',
  'manus.im',
  'genspark.ai',

  // Google
  'gemini.google.com',
  'aistudio.google.com',
  'notebooklm.google.com',
  'labs.google',
  'jules.google',
  'jules.google.com',

  // Coding & app builders
  'github.com',
  'cursor.com',
  'v0.app',
  'lovable.dev',
  'bolt.new',
  'replit.com',
  'app.base44.com',

  // Video generation
  'sora.chatgpt.com',
  'sora.com',
  'app.arcads.ai',
  'higgsfield.ai',
  'app.runwayml.com',
  'pika.art',
  'lumalabs.ai',
  'kling.ai',
  'hailuoai.video',
  'app.heygen.com',
  'app.synthesia.io',
  'ai.invideo.io',

  // Image generation & photo
  'midjourney.com',
  'app.leonardo.ai',
  'ideogram.ai',
  'krea.ai',
  'recraft.ai',
  'firefly.adobe.com',
  'civitai.com',
  'app.photoroom.com',
  'fal.ai',

  // Audio & music
  'elevenlabs.io',
  'suno.com',
  'udio.com',

  // Writing & productivity
  'app.jasper.ai',
  'app.writesonic.com',
  'app.copy.ai',
  'app.rytr.me',
  'gamma.app',

  // Platforms & hosted playgrounds
  'huggingface.co',
  'groq.com',
  'api.together.ai',
  'replicate.com',
  'studio.ai21.com',

  // Cribble
  'cribble.dev'
])

// Domains we USED to track (corporate sites, dead hosts, renamed products).
// New events for these are rejected, but rows already stored in events_raw
// reference them, so display-name resolution and the AI leaderboard's
// domain→tool map still need to recognize them.
const LEGACY_AI_DOMAINS = new Set([
  'anthropic.com',
  'openai.com',
  'labs.openai.com',
  'playground.openai.com',
  'beta.openai.com',
  'deepseek.com',
  'www.deepseek.com',
  'qwen.ai',
  'mistral.ai',
  'chat.lmsys.org',
  'replika.ai',
  'bard.google.com',
  'copilot.github.com',
  'cursor.sh',
  'lovable.ai',
  'v0.dev',
  'base44.com',
  'windsurf.com',
  'codeium.com',
  'tabnine.com',
  'arcads.ai',
  'runwayml.com',
  'klingai.com',
  'heygen.com',
  'synthesia.io',
  'veed.io',
  'invideo.io',
  'leonardo.ai',
  'stability.ai',
  'photoroom.com',
  'jasper.ai',
  'writesonic.com',
  'copy.ai',
  'rytr.me',
  'chatbot.com',
  'together.ai',
  'cohere.ai',
  'ai21.com',
  'runpod.io'
])

/**
 * Resolve a reported hostname to its canonical tracked domain (a
 * TRACKED_AI_DOMAINS key), or null when the hostname is not tracked.
 * Exact match first, then strip "www.", then walk up parent domains —
 * the same resolution the extension uses.
 */
export function resolveTrackedAiDomain(domain: string | null | undefined): string | null {
  if (!domain) return null
  let host = domain.toLowerCase().trim()
  if (host.startsWith('www.')) host = host.slice(4)
  while (host.includes('.')) {
    if (TRACKED_AI_DOMAINS.has(host)) return host
    host = host.slice(host.indexOf('.') + 1)
  }
  return null
}

export function isTrackedAiDomain(domain: string | null | undefined): boolean {
  return resolveTrackedAiDomain(domain) !== null
}

/** Snapshot of the allowlist for consumers that need to enumerate it
 *  (the AI leaderboard builds its domain→tool map from this). */
export function listTrackedAiDomains(): string[] {
  return [...TRACKED_AI_DOMAINS]
}

/** Retired domains still present in stored history. */
export function listLegacyAiDomains(): string[] {
  return [...LEGACY_AI_DOMAINS]
}
