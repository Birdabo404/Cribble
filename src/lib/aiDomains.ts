// Server-side allowlist of trackable AI tool domains.
// Must stay in sync with cribble-extension/config/ai-tools.js (AI_TOOLS keys).
// Events reported for domains outside this list are rejected at ingestion so
// forged payloads can't inflate scores with arbitrary domains.

const TRACKED_AI_DOMAINS = new Set([
  'claude.ai',
  'anthropic.com',
  'chat.openai.com',
  'chatgpt.com',
  'openai.com',
  'labs.openai.com',
  'playground.openai.com',
  'beta.openai.com',
  'grok.x.ai',
  'x.com',
  'gemini.google.com',
  'aistudio.google.com',
  'bard.google.com',
  'chat.deepseek.com',
  'www.deepseek.com',
  'deepseek.com',
  'copilot.github.com',
  'github.com',
  'cursor.sh',
  'cursor.com',
  'perplexity.ai',
  'you.com',
  'poe.com',
  'huggingface.co',
  'mistral.ai',
  'groq.com',
  'cohere.ai',
  'phind.com',
  'together.ai',
  'replicate.com',
  'character.ai',
  'beta.character.ai',
  'jasper.ai',
  'writesonic.com',
  'copy.ai',
  'rytr.me',
  'chat.lmsys.org',
  'replika.ai',
  'codeium.com',
  'tabnine.com',
  'lovable.ai',
  'lovable.dev',
  'v0.dev',
  'bolt.new',
  'ai21.com',
  'runpod.io',
  'chatbot.com'
])

export function isTrackedAiDomain(domain: string | null | undefined): boolean {
  if (!domain) return false
  return TRACKED_AI_DOMAINS.has(domain.toLowerCase().trim())
}
