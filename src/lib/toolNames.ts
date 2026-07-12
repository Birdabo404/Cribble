// Maps raw event domains to display-friendly AI tool names.
// Shared by the tools API (top-tools card) and the achievements
// evaluator (distinct-tool achievements), so both count "claude.ai"
// and "anthropic.com" as the same tool.

const TOOL_NAME_MAP: Record<string, string> = {
  'chat.openai.com': 'ChatGPT',
  'chatgpt.com': 'ChatGPT',
  'openai.com': 'OpenAI',
  'labs.openai.com': 'DALL·E',
  'playground.openai.com': 'OpenAI Playground',
  'beta.openai.com': 'OpenAI Beta',
  'claude.ai': 'Claude',
  'anthropic.com': 'Claude',
  'gemini.google.com': 'Gemini',
  'aistudio.google.com': 'AI Studio',
  'bard.google.com': 'Bard',
  'grok.x.ai': 'Grok',
  'x.com': 'Grok',
  'chat.deepseek.com': 'DeepSeek',
  'www.deepseek.com': 'DeepSeek',
  'deepseek.com': 'DeepSeek',
  'copilot.github.com': 'Copilot',
  'github.com': 'GitHub Copilot',
  'cursor.sh': 'Cursor',
  'cursor.com': 'Cursor',
  'perplexity.ai': 'Perplexity',
  'you.com': 'You.com',
  'poe.com': 'Poe',
  'huggingface.co': 'Hugging Face',
  'mistral.ai': 'Mistral',
  'groq.com': 'Groq',
  'cohere.ai': 'Cohere',
  'phind.com': 'Phind',
  'together.ai': 'Together AI',
  'replicate.com': 'Replicate',
  'character.ai': 'Character AI',
  'beta.character.ai': 'Character AI',
  'lovable.ai': 'Lovable',
  'lovable.dev': 'Lovable',
  'v0.dev': 'v0',
  'bolt.new': 'Bolt',
  'cribble.dev': 'Cribble'
}

export function resolveToolName(rawDomain: string): string {
  const d = (rawDomain || '').toLowerCase()
  if (!d) return 'Unknown'
  if (TOOL_NAME_MAP[d]) return TOOL_NAME_MAP[d]
  const matchKey = Object.keys(TOOL_NAME_MAP).find((k) => d.includes(k))
  if (matchKey) return TOOL_NAME_MAP[matchKey]
  const fallback = (d.split('.')[0] || 'Unknown')
    .replace(/\W+/g, '')
    .slice(0, 16)
  return fallback.charAt(0).toUpperCase() + fallback.slice(1)
}
