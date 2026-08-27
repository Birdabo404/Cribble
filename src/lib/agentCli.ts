/**
 * Single source for every command the Cribble Agent surfaces show
 * (welcome flow and settings), so the two can never drift apart.
 */
export const AGENT_CLI_COMMANDS = {
  install: 'npm install -g cribble-agent',
  /** Pre-release channel — the only build that tracks Linux and Windows. */
  installBeta: 'npm install --global cribble-agent@beta',
  connect: 'cribble connect',
  sync: 'cribble sync',
  autoSync: 'cribble start'
} as const

export type AgentPlatformId = 'macos' | 'linux' | 'windows'

export interface AgentPlatform {
  id: AgentPlatformId
  label: string
  install: string
  /** Linux and Windows ride the beta channel until tracking graduates. */
  beta: boolean
}

/** Ordered as the install step renders them: shipped build first. */
export const AGENT_PLATFORMS: readonly AgentPlatform[] = [
  {
    id: 'macos',
    label: 'macOS',
    install: AGENT_CLI_COMMANDS.install,
    beta: false
  },
  {
    id: 'linux',
    label: 'Linux',
    install: AGENT_CLI_COMMANDS.installBeta,
    beta: true
  },
  {
    id: 'windows',
    label: 'Windows',
    install: AGENT_CLI_COMMANDS.installBeta,
    beta: true
  }
] as const

/** What both surfaces render before detection runs, and where an
 *  unrecognized agent lands: the shipped build. */
export const DEFAULT_AGENT_PLATFORM: AgentPlatformId = 'macos'

export function agentPlatform(id: AgentPlatformId): AgentPlatform {
  return AGENT_PLATFORMS.find((platform) => platform.id === id) ?? AGENT_PLATFORMS[0]
}

/**
 * Best guess at the visitor's OS, so the install step opens on a command
 * they can actually run instead of asking them to self-select.
 *
 * Call this from an effect, never during render: the server has no
 * `navigator` and would hydrate a different answer than the browser.
 */
export function detectAgentPlatform(): AgentPlatformId {
  if (typeof navigator === 'undefined') return DEFAULT_AGENT_PLATFORM

  const clientHints = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData
  const hint = [clientHints?.platform, navigator.platform, navigator.userAgent]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase()

  // Apple first. iPadOS reports a desktop "Macintosh" agent, and every
  // other platform's string is unambiguous once Apple's is off the table.
  if (hint.includes('mac') || hint.includes('iphone') || hint.includes('ipad')) {
    return 'macos'
  }
  if (hint.includes('win')) return 'windows'
  if (
    hint.includes('linux') ||
    hint.includes('android') ||
    hint.includes('cros') ||
    hint.includes('x11')
  ) {
    return 'linux'
  }
  return DEFAULT_AGENT_PLATFORM
}
