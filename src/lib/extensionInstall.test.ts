import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  evaluateExtensionGate,
  extensionBrowserFamily,
  isExtensionCapableBrowser,
  shouldShowMobileExtensionNotice,
  type ExtensionBrowserFamily,
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
    countMode: null,
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
    // Tokens-only accounts track burn through the agent CLI — the browser
    // extension is software they have no use for, so the wall never
    // applies. 'browser' and 'both' still need it, and an unset count_mode
    // (every pre-redesign account) keeps gating as browser.
    {
      name: 'tokens-only account on a capable browser passes without a handshake',
      input: { countMode: 'tokens' },
      expected: 'allow'
    },
    {
      name: 'browser count mode still hits the wall',
      input: { countMode: 'browser' },
      expected: 'install'
    },
    {
      name: "'both' count mode still needs the extension",
      input: { countMode: 'both' },
      expected: 'install'
    },
    // Non-capable browsers can never install — capable means a desktop
    // browser whose store listing is live (Chrome today, Firefox once its
    // AMO URL ships), so gating anyone else would demand the impossible.
    // They always pass, linked or not; phone users get the one-time
    // desktop-only notice (pinned below) instead.
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

// UA classification is pure so it can be pinned without stubbing navigator
// or the build env. Capability layers on top: a family is capable only
// while its store URL is set (a build-time constant), so "desktop Firefox
// becomes capable only when the Firefox listing ships" reduces to the UA
// mapping to 'firefox' here — the URL flips the rest at deploy time.
describe('extensionBrowserFamily', () => {
  const cases: {
    name: string
    ua: string
    family: ExtensionBrowserFamily | null
  }[] = [
    {
      name: 'desktop Chrome',
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      family: 'chromium'
    },
    {
      name: 'desktop Edge (Chromium)',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      family: 'chromium'
    },
    {
      // "like Gecko" boilerplate (present in Chrome and Safari UAs alike)
      // must never read as Firefox — only the "Firefox/" token counts.
      name: 'desktop Safari (no extension engine)',
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      family: null
    },
    {
      name: 'desktop Firefox',
      ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
      family: 'firefox'
    },
    {
      name: 'Android Chrome (mobile)',
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      family: null
    },
    {
      name: 'iOS Chrome (WebKit shell, CriOS)',
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
      family: null
    },
    {
      name: 'Android Firefox (mobile)',
      ua: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
      family: null
    },
    {
      name: 'iOS Firefox (WebKit shell, FxiOS)',
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15',
      family: null
    }
  ]

  for (const c of cases) {
    it(`classifies ${c.name} as ${c.family ?? 'no family'}`, () => {
      expect(extensionBrowserFamily(c.ua)).toBe(c.family)
    })
  }
})

// The wrapper only adds environment reads on top of the pure classifier
// above: navigator for the UA, the build-time store URLs for liveness.
// The URL half can't be exercised here (module-level constants, unset in
// the test env), so SSR is the one case worth pinning directly.
describe('isExtensionCapableBrowser', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers false without a navigator (SSR)', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isExtensionCapableBrowser()).toBe(false)
  })
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
      name: 'non-capable desktop (e.g. Safari, fine pointer) skips it',
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
