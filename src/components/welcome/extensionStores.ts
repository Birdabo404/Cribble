// The extension stage's two link tables: where the extension installs
// from, and where a freshly linked user goes to earn a first signal. Both
// are data only — the stage renders them — so the derivations can be
// pinned in vitest without a browser.
import {
  EXTENSION_INSTALL_URL,
  FIREFOX_EXTENSION_INSTALL_URL,
  type ChromiumForkName,
  type ExtensionBrowserFamily
} from '@/lib/extensionInstall'
import {
  BrandBolt,
  BrandChrome,
  BrandClaude,
  BrandCopilot,
  BrandDeepSeek,
  BrandFirefox,
  BrandGemini,
  BrandGrok,
  BrandLovable,
  BrandMidjourney,
  BrandOpenAI,
  BrandPerplexity,
  BrandReplit,
  BrandV0
} from '@/components/welcome/icons'
import type { IconComponent } from '@/components/welcome/shared'

export interface ExtensionStore {
  family: ExtensionBrowserFamily
  storeName: string
  cta: string
  icon: IconComponent
  url: string
}

// One card per live store listing — no empty slot for a store that isn't
// live. Today that's the Chrome Web Store alone; the Firefox card appears
// the moment NEXT_PUBLIC_FIREFOX_EXTENSION_STORE_URL ships, the same
// switch that turns on the Firefox gate and nudge.
export const EXTENSION_STORES: ExtensionStore[] = [
  ...(EXTENSION_INSTALL_URL !== null
    ? [
        {
          family: 'chrome' as const,
          storeName: 'Chrome Web Store',
          cta: 'Add to Chrome',
          icon: BrandChrome,
          url: EXTENSION_INSTALL_URL
        }
      ]
    : []),
  ...(FIREFOX_EXTENSION_INSTALL_URL !== null
    ? [
        {
          family: 'firefox' as const,
          storeName: 'Firefox Add-ons',
          cta: 'Add to Firefox',
          icon: BrandFirefox,
          url: FIREFOX_EXTENSION_INSTALL_URL
        }
      ]
    : [])
]

// The forks the Chrome card names, in the order they're listed when none
// is the running browser. A detected fork moves to the front so a Brave
// user reads "works in Brave" before anything else.
const NAMED_FORKS: ChromiumForkName[] = ['Brave', 'Edge', 'Arc']

/** The store card's sublabel. Plain store name on Google Chrome itself and
 *  on Firefox; on a Chromium fork the Chrome card says so, because a bare
 *  "Chrome Web Store" reads as an exclusion to a Brave or Edge user. */
export function storeSublabel(
  store: Pick<ExtensionStore, 'family' | 'storeName'>,
  forkName: ChromiumForkName | null
): string {
  if (store.family !== 'chrome' || forkName === null) return store.storeName
  const names = [forkName, ...NAMED_FORKS.filter((n) => n !== forkName)].slice(
    0,
    NAMED_FORKS.length
  )
  return `${store.storeName} · works in ${names.join(', ')}`
}

/** A tool the extension counts in a browser tab, as a link the FIRST
 *  SIGNAL grid can open. `host` is the domain the status pill will name
 *  once the first CRIBBLE_POINTS_EARNED arrives from it. */
export interface SignalSurface {
  id: string
  label: string
  host: string
  href: string
  icon: IconComponent
}

// Keyed by the onboarding API's tool ids. Every entry is a domain the
// extension's own registry (cribble-extension/config/ai-tools.js) tracks,
// so a click here can actually produce a signal. Tools without a browser
// surface — Cursor, Claude Code, Codex, Windsurf — are deliberately
// absent: the CLI counts those, and sending someone to a marketing page
// would earn nothing.
const SURFACES: Record<string, Omit<SignalSurface, 'id'>> = {
  chatgpt: {
    label: 'ChatGPT',
    host: 'chatgpt.com',
    href: 'https://chatgpt.com',
    icon: BrandOpenAI
  },
  claude: {
    label: 'Claude',
    host: 'claude.ai',
    href: 'https://claude.ai',
    icon: BrandClaude
  },
  gemini: {
    label: 'Gemini',
    host: 'gemini.google.com',
    href: 'https://gemini.google.com',
    icon: BrandGemini
  },
  perplexity: {
    label: 'Perplexity',
    host: 'perplexity.ai',
    href: 'https://www.perplexity.ai',
    icon: BrandPerplexity
  },
  grok: {
    label: 'Grok',
    host: 'grok.com',
    href: 'https://grok.com',
    icon: BrandGrok
  },
  deepseek: {
    label: 'DeepSeek',
    host: 'chat.deepseek.com',
    href: 'https://chat.deepseek.com',
    icon: BrandDeepSeek
  },
  copilot: {
    label: 'Copilot',
    host: 'github.com/copilot',
    href: 'https://github.com/copilot',
    icon: BrandCopilot
  },
  v0: { label: 'v0', host: 'v0.app', href: 'https://v0.app', icon: BrandV0 },
  lovable: {
    label: 'Lovable',
    host: 'lovable.dev',
    href: 'https://lovable.dev',
    icon: BrandLovable
  },
  bolt: { label: 'Bolt', host: 'bolt.new', href: 'https://bolt.new', icon: BrandBolt },
  replit: {
    label: 'Replit',
    host: 'replit.com',
    href: 'https://replit.com',
    icon: BrandReplit
  },
  midjourney: {
    label: 'Midjourney',
    host: 'midjourney.com',
    href: 'https://www.midjourney.com',
    icon: BrandMidjourney
  }
}

// What fills the grid when the loadout names fewer than six web surfaces
// (or none — a returning user bounced here by the gate has no answers
// this session).
const FALLBACK_SURFACES = [
  'chatgpt',
  'claude',
  'gemini',
  'perplexity',
  'grok',
  'deepseek'
]

export const SIGNAL_GRID_SIZE = 6

/** The FIRST SIGNAL grid: the user's own tools first (those with a web
 *  surface, in the order they were picked), topped up from the fallback
 *  list to six, never repeating. */
export function signalSurfaces(topTools: readonly string[]): SignalSurface[] {
  const out: SignalSurface[] = []
  for (const id of [...topTools, ...FALLBACK_SURFACES]) {
    if (out.length >= SIGNAL_GRID_SIZE) break
    const surface = SURFACES[id]
    if (!surface || out.some((s) => s.id === id)) continue
    out.push({ id, ...surface })
  }
  return out
}
