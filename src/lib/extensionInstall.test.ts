import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentExtensionBrowserFamily,
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
// Only Google Chrome and Firefox proper map to a family: the extension is
// published for those two alone, so every other desktop browser must read
// as no family and pass through the wall exactly like mobile does.
describe('extensionBrowserFamily', () => {
  const CHROME_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

  const cases: {
    name: string
    ua: string
    brands?: string[]
    family: ExtensionBrowserFamily | null
  }[] = [
    {
      name: 'desktop Chrome',
      ua: CHROME_UA,
      family: 'chrome'
    },
    {
      name: 'desktop Chrome with Client Hints brands',
      ua: CHROME_UA,
      brands: ['Chromium', 'Google Chrome', 'Not-A.Brand'],
      family: 'chrome'
    },
    // Chromium forks inherit the "Chrome/" token; the ones that also name
    // themselves in the UA are caught there.
    {
      name: 'desktop Edge (Chromium fork, not published for)',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      family: null
    },
    {
      name: 'desktop Opera (Chromium fork)',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
      family: null
    },
    {
      name: 'desktop Yandex Browser (Chromium fork)',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36',
      family: null
    },
    // Brave's UA is byte-identical to Chrome's; only its Client Hints
    // brand gives it away. Same for the open-source Chromium build, which
    // reports bare "Chromium" without Google's brand.
    {
      name: 'desktop Brave (Chrome UA, own brand)',
      ua: CHROME_UA,
      brands: ['Brave', 'Chromium', 'Not_A Brand'],
      family: null
    },
    {
      name: 'desktop Edge announcing itself via brands only',
      ua: CHROME_UA,
      brands: ['Microsoft Edge', 'Chromium', 'Not?A_Brand'],
      family: null
    },
    {
      name: 'open-source Chromium build (no Google Chrome brand)',
      ua: CHROME_UA,
      brands: ['Chromium', 'Not-A.Brand'],
      family: null
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
      expect(extensionBrowserFamily(c.ua, c.brands ?? [])).toBe(c.family)
    })
  }
})

// The navigator wrapper feeds the classifier both signals — the UA string
// and userAgentData.brands when the browser exposes them. Pinned against
// a stubbed navigator so the brands plumbing (a nested, untyped shape)
// can't silently stop reaching the classifier.
describe('currentExtensionBrowserFamily', () => {
  const CHROME_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers null without a navigator (SSR)', () => {
    vi.stubGlobal('navigator', undefined)
    expect(currentExtensionBrowserFamily()).toBeNull()
  })

  it('reads Chrome from the UA alone when brands are absent', () => {
    vi.stubGlobal('navigator', { userAgent: CHROME_UA })
    expect(currentExtensionBrowserFamily()).toBe('chrome')
  })

  it('reads Chrome when brands include Google Chrome', () => {
    vi.stubGlobal('navigator', {
      userAgent: CHROME_UA,
      userAgentData: {
        brands: [
          { brand: 'Chromium', version: '126' },
          { brand: 'Google Chrome', version: '126' },
          { brand: 'Not-A.Brand', version: '8' }
        ]
      }
    })
    expect(currentExtensionBrowserFamily()).toBe('chrome')
  })

  it('reads a Chrome-UA fork as no family from its own brand', () => {
    vi.stubGlobal('navigator', {
      userAgent: CHROME_UA,
      userAgentData: {
        brands: [
          { brand: 'Brave', version: '126' },
          { brand: 'Chromium', version: '126' },
          { brand: 'Not_A Brand', version: '24' }
        ]
      }
    })
    expect(currentExtensionBrowserFamily()).toBeNull()
  })

  it('ignores malformed brands and falls back to the UA', () => {
    vi.stubGlobal('navigator', {
      userAgent: CHROME_UA,
      userAgentData: { brands: 'not-an-array' }
    })
    expect(currentExtensionBrowserFamily()).toBe('chrome')
  })
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
