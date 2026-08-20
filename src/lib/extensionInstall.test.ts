import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  evaluateExtensionGate,
  isExtensionCapableBrowser,
  shouldShowMobileExtensionNotice,
  type ExtensionGateInput,
  type ExtensionGateVerdict,
  type MobileExtensionNoticeInput
} from './extensionInstall'

// The hard install wall only holds if both enforcement points — the (app)
// ExtensionGate and /welcome — reach identical verdicts from identical
// inputs. These tables pin the decision so a drive-by edit can't silently
// reopen a bypass (or start a redirect loop between the two).

describe('evaluateExtensionGate', () => {
  const base: ExtensionGateInput = {
    enabled: true,
    signedIn: true,
    accountType: 'solo',
    capableBrowser: true,
    detected: false,
    linked: false
  }

  const cases: {
    name: string
    input: Partial<ExtensionGateInput>
    expected: ExtensionGateVerdict
  }[] = [
    {
      name: 'feature off (no store listing) always allows',
      input: { enabled: false },
      expected: 'allow'
    },
    {
      name: 'feature off allows even a never-linked non-capable browser',
      input: { enabled: false, capableBrowser: false },
      expected: 'allow'
    },
    {
      name: 'signed-out visitors are never gated',
      input: { signedIn: false },
      expected: 'allow'
    },
    {
      name: 'capable browser with a live handshake passes',
      input: { detected: true },
      expected: 'allow'
    },
    {
      name: 'capable browser without a handshake hits the wall',
      input: {},
      expected: 'install'
    },
    {
      name: 'capable browser: past linkage cannot stand in for the live handshake',
      input: { linked: true },
      expected: 'install'
    },
    // Team buyer accounts track nothing (checkout already leaves the
    // wizard), so the wall never applies to them — not even on a capable
    // browser with no handshake. Solo is the strict default: affiliated
    // pilots sign up solo and must still install.
    {
      name: 'team account on a capable browser passes without a handshake',
      input: { accountType: 'team' },
      expected: 'allow'
    },
    {
      name: 'solo account in the same spot still hits the wall',
      input: { accountType: 'solo' },
      expected: 'install'
    },
    {
      name: 'team account with the feature off stays allowed',
      input: { accountType: 'team', enabled: false },
      expected: 'allow'
    },
    // Non-capable browsers (Safari/Firefox/mobile) can never install —
    // the store is desktop-Chromium only — so gating them would demand
    // the impossible. They always pass, linked or not; phone users get
    // the one-time desktop-only notice (pinned below) instead.
    {
      name: 'non-capable browser with a linked account passes',
      input: { capableBrowser: false, linked: true },
      expected: 'allow'
    },
    {
      name: 'non-capable browser never linked still passes (cannot install)',
      input: { capableBrowser: false },
      expected: 'allow'
    },
    {
      name: 'non-capable browser passes regardless of a stray detected flag',
      input: { capableBrowser: false, detected: true },
      expected: 'allow'
    }
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(evaluateExtensionGate({ ...base, ...c.input })).toBe(c.expected)
    })
  }
})

describe('isExtensionCapableBrowser', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers false without a navigator (SSR)', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isExtensionCapableBrowser()).toBe(false)
  })

  const cases: { name: string; ua: string; capable: boolean }[] = [
    {
      name: 'desktop Chrome',
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      capable: true
    },
    {
      name: 'desktop Edge (Chromium)',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      capable: true
    },
    {
      name: 'desktop Safari (no Chromium engine)',
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      capable: false
    },
    {
      name: 'desktop Firefox',
      ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
      capable: false
    },
    {
      name: 'Android Chrome (mobile)',
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      capable: false
    },
    {
      name: 'iOS Chrome (WebKit shell, CriOS)',
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
      capable: false
    }
  ]

  for (const c of cases) {
    it(`${c.capable ? 'accepts' : 'rejects'} ${c.name}`, () => {
      vi.stubGlobal('navigator', { userAgent: c.ua })
      expect(isExtensionCapableBrowser()).toBe(c.capable)
    })
  }
})

// The phone notice is informational-only, so the failure mode isn't a
// gate bypass — it's showing the modal to someone it doesn't apply to
// (desktop Chrome mid-handshake, signed-out visitors, desktop Safari) or
// re-showing it after GOT IT. Each suppression reason is pinned alone
// against an all-show baseline.
describe('shouldShowMobileExtensionNotice', () => {
  const base: MobileExtensionNoticeInput = {
    enabled: true,
    signedIn: true,
    capableBrowser: false,
    mobileViewport: true,
    dismissed: false
  }

  const cases: {
    name: string
    input: Partial<MobileExtensionNoticeInput>
    expected: boolean
  }[] = [
    {
      name: 'signed-in phone user who never dismissed sees the notice',
      input: {},
      expected: true
    },
    {
      name: 'feature off (no store listing) never shows it',
      input: { enabled: false },
      expected: false
    },
    {
      name: 'signed-out visitors never see it (dismissal is keyed by user id)',
      input: { signedIn: false },
      expected: false
    },
    {
      name: 'capable browsers never see it — they get the real install gate',
      input: { capableBrowser: true },
      expected: false
    },
    {
      name: 'non-capable desktop (Safari/Firefox, fine pointer) skips it',
      input: { mobileViewport: false },
      expected: false
    },
    {
      name: 'once dismissed it stays gone',
      input: { dismissed: true },
      expected: false
    }
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(shouldShowMobileExtensionNotice({ ...base, ...c.input })).toBe(
        c.expected
      )
    })
  }
})
