// HOUSE IDENTITIES for the AI board — every machine on the standings is
// a faction with a brand hue and an epithet. The curated table covers
// the tools resolveToolName can mint (src/lib/toolNames.ts); anything
// else derives a stable hue from its name so a brand-new domain never
// renders broken or re-rolls its color between visits. Hues are meant
// to be mixed with alpha (rgb(x / a)) like the medal triplets — never
// painted as full-sat rectangles behind text.

export interface AiToolIdentity {
  /** space-separated rgb triplet, e.g. '217 119 87' — mix with rgb(x / a) like medalA */
  rgb: string
  /** hex for rare hard fills */
  hex: string
  /** 2–4 word house title, ALL CAPS, no punctuation except spaces. Not a sentence. */
  epithet: string
}

const identity = (rgb: string, hex: string, epithet: string): AiToolIdentity => ({
  rgb,
  hex,
  epithet
})

/** Keys match the display names resolveToolName serves to the AI board. */
const CURATED: Record<string, AiToolIdentity> = {
  ChatGPT: identity('16 163 127', '#10A37F', 'HOUSE DEFAULT'),
  OpenAI: identity('16 163 127', '#10A37F', 'HOUSE DEFAULT'),
  'OpenAI Playground': identity('16 163 127', '#10A37F', 'THE LAB'),
  'OpenAI Beta': identity('16 163 127', '#10A37F', 'THE LAB'),
  Codex: identity('16 163 127', '#10A37F', 'THE CODEX'),
  'DALL·E': identity('16 163 127', '#10A37F', 'THE REEL'),
  Claude: identity('217 119 87', '#D97757', 'THE ORANGE HOUSE'),
  'Claude Playground': identity('217 119 87', '#D97757', 'THE ORANGE BENCH'),
  Grok: identity('232 232 232', '#E8E8E8', 'BLACK STAR'),
  Gemini: identity('124 110 254', '#7C6EFE', 'THE PRISM'),
  Bard: identity('124 110 254', '#7C6EFE', 'THE PRISM'),
  'AI Studio': identity('124 110 254', '#7C6EFE', 'THE PRISM LAB'),
  'Gemini Notebook': identity('124 110 254', '#7C6EFE', 'THE NOTEBOOK'),
  Cursor: identity('200 200 205', '#C8C8CD', 'THE COCKPIT'),
  Windsurf: identity('56 189 248', '#38BDF8', 'THE BREAK'),
  DeepSeek: identity('77 124 255', '#4D7CFF', 'OPEN FORGE'),
  Kimi: identity('232 93 117', '#E85D75', 'NIGHT SHIFT'),
  Suno: identity('255 92 74', '#FF5C4A', 'SOUNDSTAGE'),
  ElevenLabs: identity('255 92 74', '#FF5C4A', 'THE VOICE'),
  Udio: identity('255 92 74', '#FF5C4A', 'THE MIX'),
  Perplexity: identity('31 184 205', '#1FB8CD', 'THE SEARCHLIGHT'),
  Copilot: identity('80 160 255', '#50A0FF', 'THE PAIR'),
  'GitHub Copilot': identity('80 160 255', '#50A0FF', 'THE PAIR'),
  'Microsoft Copilot': identity('80 160 255', '#50A0FF', 'THE PAIR'),
  Midjourney: identity('168 85 247', '#A855F7', 'NIGHT STUDIO'),
  Ideogram: identity('168 85 247', '#A855F7', 'THE TYPESET'),
  Sora: identity('16 163 127', '#10A37F', 'THE REEL'),
  'Hugging Face': identity('255 176 32', '#FFB020', 'THE HUB'),
  Groq: identity('247 168 0', '#F7A800', 'THE PIPE'),
  Replika: identity('244 114 182', '#F472B6', 'THE COMPANION'),
  Gamma: identity('139 92 246', '#8B5CF6', 'THE DECK'),
  v0: identity('250 250 250', '#FAFAFA', 'THE SCAFFOLD'),
  Bolt: identity('251 146 60', '#FB923C', 'LIVE WIRE'),
  Lovable: identity('251 113 133', '#FB7185', 'THE BUILDER'),
  Replit: identity('247 168 0', '#F7A800', 'THE REPL'),
  Mistral: identity('255 176 32', '#FFB020', 'THE WIND'),
  'Qwen Chat': identity('99 102 241', '#6366F1', 'THE EAST GATE'),
  'Meta AI': identity('0 100 224', '#0064E0', 'BLUE ROOM'),
  'Character AI': identity('168 85 247', '#A855F7', 'THE CAST'),
  Runway: identity('255 255 255', '#FFFFFF', 'THE CUT'),
  Pika: identity('52 211 153', '#34D399', 'THE TAKE'),
  'Luma Dream Machine': identity('192 132 252', '#C084FC', 'DREAM MACHINE'),
  'Kling AI': identity('56 189 248', '#38BDF8', 'THE FRAME'),
  'Leonardo AI': identity('251 146 60', '#FB923C', 'THE ATELIER'),
  Jules: identity('66 133 244', '#4285F4', 'THE AGENT'),
  'Z.ai': identity('34 197 94', '#22C55E', 'THE Z'),
  'You.com': identity('99 102 241', '#6366F1', 'THE ANSWER'),
  Poe: identity('139 92 246', '#8B5CF6', 'THE SALON'),
  Phind: identity('34 197 94', '#22C55E', 'THE LOOKUP'),
  LMArena: identity('250 204 21', '#FACC15', 'THE CAGE'),
  Arena: identity('250 204 21', '#FACC15', 'THE CAGE'),
  Manus: identity('244 114 182', '#F472B6', 'THE HAND'),
  Genspark: identity('251 146 60', '#FB923C', 'THE SPARK'),
  Higgsfield: identity('167 139 250', '#A78BFA', 'THE FIELD'),
  'Hailuo AI': identity('251 146 60', '#FB923C', 'THE HAIL'),
  HeyGen: identity('56 189 248', '#38BDF8', 'THE STAND-IN'),
  Synthesia: identity('99 102 241', '#6366F1', 'THE STUDIO'),
  'InVideo AI': identity('251 146 60', '#FB923C', 'THE EDIT'),
  Arcads: identity('244 114 182', '#F472B6', 'THE SPOT'),
  'Google Labs': identity('66 133 244', '#4285F4', 'THE LAB'),
  Base44: identity('52 211 153', '#34D399', 'THE FORTY-FOUR')
}

/** FNV-1a — the same name must land on the same hue forever. */
const hashName = (name: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const hslChannel = (h: number, s: number, l: number, n: number): number => {
  const k = (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))))
}

const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('')

/** Uncurated tools: hue off the name hash, mid saturation/lightness so
 *  the derived color sits in the same register as the curated table. */
function derivedIdentity(name: string): AiToolIdentity {
  const hue = hashName(name) % 360
  const r = hslChannel(hue, 0.48, 0.58, 0)
  const g = hslChannel(hue, 0.48, 0.58, 8)
  const b = hslChannel(hue, 0.48, 0.58, 4)
  const firstWord = (name.trim().split(/\s+/)[0] || 'UNKNOWN').toUpperCase()
  const oneWord = !name.trim().includes(' ')
  return identity(
    `${r} ${g} ${b}`,
    toHex(r, g, b),
    oneWord ? `THE ${firstWord}` : `HOUSE ${firstWord}`
  )
}

export function identityForTool(name: string): AiToolIdentity {
  return CURATED[name] ?? derivedIdentity(name)
}

export function toolRgbA(rgb: string, alpha: number): string {
  return `rgb(${rgb} / ${alpha})`
}

/** WCAG relative luminance — the naive channel average calls mid-tone
 *  brand hues (ChatGPT teal) "bright" and inks them for no reason. */
const relativeLuminance = (r: number, g: number, b: number): number => {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * Light-theme ink for a house hue: bright brands (Grok's near-white,
 * LMArena's yellow) vanish on the white panel, so channels scale down
 * until relative luminance lands at a readable level. Dark-enough hues
 * pass through untouched. Components set both triplets as CSS vars and
 * let html.light pin the paint var to this one.
 */
export function toolInkRgb(rgb: string): string {
  const [r, g, b] = rgb.split(' ').map(Number)
  const luminance = relativeLuminance(r, g, b)
  if (luminance <= 0.3) return rgb
  // Channel scaling moves linear luminance by ~factor^2.4 (gamma space).
  const factor = Math.pow(0.22 / luminance, 1 / 2.4)
  return [r, g, b].map((c) => Math.round(c * factor)).join(' ')
}
