import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_CLI_COMMANDS,
  AGENT_PLATFORMS,
  DEFAULT_AGENT_PLATFORM,
  agentPlatform,
  detectAgentPlatform,
  type AgentPlatformId
} from './agentCli'

describe('AGENT_PLATFORMS', () => {
  it('sends every platform at the same package', () => {
    for (const platform of AGENT_PLATFORMS) {
      expect(platform.install).toContain('cribble-agent')
    }
  })

  // The whole point of the beta flag is that the UI can warn about the
  // pre-release channel, so the two must never disagree.
  it('flags exactly the platforms pinned to the beta channel', () => {
    for (const platform of AGENT_PLATFORMS) {
      expect(platform.install === AGENT_CLI_COMMANDS.installBeta).toBe(platform.beta)
    }
    expect(AGENT_CLI_COMMANDS.installBeta).toContain('@beta')
  })

  it('keeps macOS on the shipped build and the rest on beta', () => {
    expect(agentPlatform('macos')).toMatchObject({
      install: AGENT_CLI_COMMANDS.install,
      beta: false
    })
    expect(agentPlatform('linux').install).toBe(AGENT_CLI_COMMANDS.installBeta)
    expect(agentPlatform('windows').install).toBe(AGENT_CLI_COMMANDS.installBeta)
  })

  it('falls back to the default platform for an unknown id', () => {
    expect(agentPlatform('freebsd' as AgentPlatformId).id).toBe(DEFAULT_AGENT_PLATFORM)
  })
})

describe('detectAgentPlatform', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cases: { name: string; ua: string; expected: AgentPlatformId }[] = [
    {
      name: 'macOS Chrome',
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      expected: 'macos'
    },
    {
      name: 'Windows Chrome',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      expected: 'windows'
    },
    {
      name: 'Linux Firefox',
      ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
      expected: 'linux'
    },
    {
      name: 'ChromeOS',
      ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      expected: 'linux'
    },
    {
      name: 'Android Chrome',
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      expected: 'linux'
    },
    {
      // "like Mac OS X" must not be mistaken for a Windows or Linux box —
      // it reads as macOS, which is the harmless answer on a phone.
      name: 'iPhone Safari',
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      expected: 'macos'
    },
    {
      name: 'an unrecognizable agent',
      ua: 'Mozilla/5.0 (Unknown)',
      expected: DEFAULT_AGENT_PLATFORM
    }
  ]

  for (const c of cases) {
    it(`reads ${c.name} as ${c.expected}`, () => {
      vi.stubGlobal('navigator', { userAgent: c.ua })
      expect(detectAgentPlatform()).toBe(c.expected)
    })
  }

  it('reads client hints when the user agent string says nothing', () => {
    vi.stubGlobal('navigator', {
      userAgentData: { platform: 'Linux' },
      userAgent: 'Mozilla/5.0 (Unknown)'
    })
    expect(detectAgentPlatform()).toBe('linux')
  })

  it('falls back to the default platform without a navigator (SSR)', () => {
    vi.stubGlobal('navigator', undefined)
    expect(detectAgentPlatform()).toBe(DEFAULT_AGENT_PLATFORM)
  })
})
