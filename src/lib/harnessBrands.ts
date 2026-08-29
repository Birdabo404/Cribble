// Single source of truth for coding-agent harness branding. Every surface
// that shows a harness identity — the Burn Board rows, the token player
// card, the season player modal's AGENTIC section, and the profile page's
// agent breakdown — renders through TokenAgentIcon, and TokenAgentIcon
// renders exclusively from this registry. Collector-id → label mapping
// (tokenAgentLabel) reads the same records, so a harness added here gets
// its aliases, accent chrome and brand mark everywhere at once — the four
// surfaces cannot drift.
//
// This module is intentionally data-only (no React, no JSX): it is shared
// by server code (src/lib/tokenLeaderboard.ts, API routes) and client
// components alike.

/** Boxed-chrome tint for a harness, keyed off the brand's own palette.
 *  Values are raw CSS — theme-aware via the --z / --lb variable ramps. */
export interface HarnessAccent {
  color: string
  edge: string
  surface: string
}

/**
 * How a harness draws its brand mark:
 *  - `image`: pinned self-hosted asset under /public/agents (provenance,
 *    upstream revisions, hashes and licensing in public/agents/LICENSES.md;
 *    SVG assets are gated by the fail-closed validator in svgAssetValidator).
 *  - `path`: official Simple Icons path data (CC0), single fill.
 *  - `gradient-path`: official path data filled with a brand gradient.
 */
export type HarnessMark =
  | { kind: 'image'; src: string }
  | { kind: 'path'; d: string; fill: string }
  | {
      kind: 'gradient-path'
      d: string
      stops: readonly { offset: number; color: string }[]
    }

export interface HarnessBrand {
  /** Canonical display label — the exact string tokenAgentLabel returns. */
  label: string
  /** Normalized collector ids (see normalizeAgentId) that map to this
   *  harness. Every alias needs documented evidence — a binary name, an
   *  npm package, a repo, or ids observed in live collector data. */
  aliases: readonly string[]
  accent: HarnessAccent
  mark: HarnessMark
}

/**
 * Official brand mark path data (24px grid), Simple Icons (CC0). Shared
 * with the AI-tool icon set in components/leaderboard/icons.tsx so the
 * geometry exists exactly once.
 */
export const SIMPLE_ICON_PATHS = {
  openai:
    'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  claude:
    'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  gemini:
    'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  cursor:
    'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
  copilot:
    'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z'
} as const

/** Official Gemini gradient, top-left blue to bottom-right violet. */
export const GEMINI_GRADIENT_STOPS = [
  { offset: 0, color: '#217BFE' },
  { offset: 0.35, color: '#078EFB' },
  { offset: 0.7, color: '#A190FF' },
  { offset: 1, color: '#BD99FE' }
] as const

/**
 * Full ink for officially monochrome brands: near-black on light surfaces,
 * near-white on dark, flipped back to white inside dark plate slabs via
 * the `.lb4-plated` var re-pin. Matches BRAND_INK in icons.tsx.
 */
const INK = 'rgb(var(--z100))'

/** Neutral silver chrome for monochrome brands whose mark is (or sits on)
 *  its own dark/white tile — a hue would fight the asset. */
const NEUTRAL_ACCENT: HarnessAccent = {
  color: INK,
  edge: 'rgb(var(--lb-panel-edge) / 0.24)',
  surface:
    'linear-gradient(145deg, rgb(var(--lb-panel-edge) / 0.14), rgb(var(--lb-panel-edge) / 0.03))'
}

export const HARNESS_BRANDS: readonly HarnessBrand[] = [
  {
    label: 'Codex',
    aliases: ['codex', 'openai-codex'],
    accent: {
      color: INK,
      edge: 'rgb(16 163 127 / 0.38)',
      surface:
        'linear-gradient(145deg, rgb(16 163 127 / 0.18), rgb(var(--lb-panel-edge) / 0.04))'
    },
    mark: { kind: 'path', d: SIMPLE_ICON_PATHS.openai, fill: INK }
  },
  {
    label: 'Claude Code',
    aliases: ['claude', 'claude-code'],
    accent: {
      color: '#D97757',
      edge: 'rgb(217 119 87 / 0.4)',
      surface:
        'linear-gradient(145deg, rgb(217 119 87 / 0.17), rgb(var(--lb-panel-edge) / 0.04))'
    },
    mark: { kind: 'path', d: SIMPLE_ICON_PATHS.claude, fill: '#D97757' }
  },
  {
    label: 'Cursor',
    aliases: ['cursor'],
    accent: {
      color: INK,
      edge: 'rgb(var(--lb-panel-edge) / 0.2)',
      surface:
        'linear-gradient(145deg, rgb(var(--lb-panel-edge) / 0.12), rgb(var(--lb-panel-edge) / 0.025))'
    },
    mark: { kind: 'path', d: SIMPLE_ICON_PATHS.cursor, fill: INK }
  },
  {
    label: 'Gemini CLI',
    aliases: ['gemini', 'gemini-cli'],
    accent: {
      color: '#8B9DFF',
      edge: 'rgb(139 157 255 / 0.4)',
      surface: 'linear-gradient(145deg, rgb(33 123 254 / 0.16), rgb(189 153 254 / 0.1))'
    },
    mark: {
      kind: 'gradient-path',
      d: SIMPLE_ICON_PATHS.gemini,
      stops: GEMINI_GRADIENT_STOPS
    }
  },
  {
    label: 'GitHub Copilot',
    aliases: ['copilot', 'github-copilot'],
    accent: {
      color: INK,
      edge: 'rgb(168 85 247 / 0.34)',
      surface:
        'linear-gradient(145deg, rgb(168 85 247 / 0.14), rgb(var(--lb-panel-edge) / 0.035))'
    },
    mark: { kind: 'path', d: SIMPLE_ICON_PATHS.copilot, fill: INK }
  },
  /* Hermes' mark is monochrome ink-on-white (Nous renders it on a white
     tile in both themes), so the chrome is a neutral silver tint, not a
     hue. Aliases observed in live collector data. */
  {
    label: 'Hermes',
    aliases: ['hermes', 'hermes-agent'],
    accent: NEUTRAL_ACCENT,
    mark: { kind: 'image', src: '/agents/hermes.png' }
  },
  /* OpenCode ships a monochrome identity: near-black tile, white glyph
     (packages/identity/mark.svg upstream). Alias evidence: the CLI/binary
     and npm package are `opencode`; `open-code` guards the hyphenated
     spelling normalizeAgentId produces from "Open Code". */
  {
    label: 'OpenCode',
    aliases: ['opencode', 'open-code'],
    accent: NEUTRAL_ACCENT,
    mark: { kind: 'image', src: '/agents/opencode.svg' }
  },
  /* Pi (the Pi agent harness by Mario Zechner / earendil-works) is also
     monochrome: near-black rounded tile, white glyph. Alias evidence:
     `pi` is the CLI binary (`pi --version`); `pi-coding-agent` is the npm
     package name (@mariozechner/pi-coding-agent, later
     @earendil-works/pi-coding-agent); `pi-mono` is the monorepo name the
     project itself uses (badlogic/pi-mono, published sessions under
     "pi-mono"). Collectors reporting any of these mean the same harness. */
  {
    label: 'Pi',
    aliases: ['pi', 'pi-coding-agent', 'pi-mono'],
    accent: NEUTRAL_ACCENT,
    mark: { kind: 'image', src: '/agents/pi.svg' }
  }
]

/** Normalized collector id → canonical display label, derived from the
 *  registry. This is the map tokenAgentLabel resolves against. */
export const HARNESS_AGENT_LABELS: Record<string, string> = Object.fromEntries(
  HARNESS_BRANDS.flatMap((brand) => brand.aliases.map((alias) => [alias, brand.label]))
)

const BRANDS_BY_LABEL = new Map(HARNESS_BRANDS.map((brand) => [brand.label, brand]))

/** Registry lookup for a display label (tokenAgentLabel output).
 *  Unknown harnesses return undefined — callers keep their monogram path. */
export function harnessBrandForLabel(label: string): HarnessBrand | undefined {
  return BRANDS_BY_LABEL.get(label)
}

/** Deterministic letter for a harness whose mark asset failed to load (or
 *  that has no mark at all): first character of the label, uppercased.
 *  Pure function of the label so every surface degrades identically. */
export function harnessFallbackLetter(label: string): string {
  return (label.trim()[0] ?? '?').toUpperCase()
}
