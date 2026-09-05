import type { CountMode } from '@/lib/countMode'
import type { ActiveDevice, MeUser } from '@/types/dashboard'

// Chrome Web Store listing URL. Null until the listing is live — every
// install surface (welcome step, dashboard nudge, settings link) hides
// itself when null, so this can ship before store approval.
export const EXTENSION_INSTALL_URL: string | null =
  process.env.NEXT_PUBLIC_EXTENSION_STORE_URL?.trim() || null

// Firefox Add-ons listing URL, same lifecycle: null until the AMO listing
// is live, and every Firefox install surface stays dark while it is.
export const FIREFOX_EXTENSION_INSTALL_URL: string | null =
  process.env.NEXT_PUBLIC_FIREFOX_EXTENSION_STORE_URL?.trim() || null

// The feature switch shared by the welcome extension step and the (app)
// ExtensionGate: with no listing in any store there is nothing to install,
// so both surfaces disappear entirely.
export function isExtensionInstallEnabled(): boolean {
  return EXTENSION_INSTALL_URL !== null || FIREFOX_EXTENSION_INSTALL_URL !== null
}

// "Chrome", "Firefox", or "Chrome or Firefox" — the desktop browsers with
// a live store listing right now. Copy on the welcome step and the mobile
// notice reads this so it can never name a store that isn't live.
export function installableBrowserNames(): string {
  const names: string[] = []
  if (EXTENSION_INSTALL_URL !== null) names.push('Chrome')
  if (FIREFOX_EXTENSION_INSTALL_URL !== null) names.push('Firefox')
  return names.join(' or ')
}

// Never-connected is distinct from temporarily offline: a user whose
// extension synced before (last_extension_sync set) just has it off/asleep
// and shouldn't be told to install. A null user means data hasn't loaded,
// which is not evidence of being unlinked.
export function isExtensionUnlinked(
  user: Pick<MeUser, 'last_extension_sync'> | null,
  activeDevice: Pick<ActiveDevice, 'device_uuid'> | null
): boolean {
  if (!user) return false
  return !activeDevice && !user.last_extension_sync
}

export type ExtensionBrowserFamily = 'chrome' | 'firefox'

// Chromium forks that name themselves in the UA on top of the "Chrome/"
// token they all inherit: Edge, Opera, Yandex, and pre-2020 Brave. None of
// them is Google Chrome, and the extension is only published and tested
// for Chrome, so they read as no family. Current Brave ships a UA
// identical to Chrome's and is told apart by Client Hints brands instead.
const CHROMIUM_FORK_TOKENS = /Edg\/|OPR\/|YaBrowser\/|Brave\//

// The Client Hints brand Google Chrome reports. Every other Chromium
// browser that exposes brands names itself instead ("Microsoft Edge",
// "Brave", "Opera") or reports bare "Chromium".
const CHROME_BRAND = 'Google Chrome'

// Which desktop browser the extension ships for, or null for anything
// else. Only Google Chrome and Firefox proper count — the store listings
// are for those two, so Edge, Opera, Brave, Safari, and every other
// desktop browser pass through exactly like mobile does. Mobile is out
// wholesale: mobile Chromium and mobile Firefox carry "Mobile"/"Android",
// and the iOS shells (CriOS, FxiOS) are WebKit underneath and carry
// "Mobile" too. Desktop Safari matches neither engine token — its "like
// Gecko" boilerplate (also in every Chrome UA) is not the "Firefox/"
// token. `brands` is navigator.userAgentData.brands when the browser
// exposes it (Chromium only) and empty otherwise; a populated list that
// lacks Chrome's own brand is a fork hiding behind Chrome's UA. Pure so
// tests can pin the classification without stubbing navigator or the
// build env.
export function extensionBrowserFamily(
  ua: string,
  brands: readonly string[] = []
): ExtensionBrowserFamily | null {
  if (/Mobi|Android/i.test(ua)) return null
  if (/Chrome\//.test(ua)) {
    if (CHROMIUM_FORK_TOKENS.test(ua)) return null
    if (brands.length > 0 && !brands.includes(CHROME_BRAND)) return null
    return 'chrome'
  }
  if (/Firefox\//.test(ua)) return 'firefox'
  return null
}

// navigator.userAgentData.brands, flattened to brand names. Client Hints
// are Chromium-only and absent on insecure origins, so everywhere else
// this is empty and the UA string decides alone. Not in lib.dom yet,
// hence the local cast — same shape agentCli's platform sniff uses.
function currentBrands(): string[] {
  const data = (
    navigator as Navigator & {
      userAgentData?: { brands?: unknown }
    }
  ).userAgentData
  if (!data || !Array.isArray(data.brands)) return []
  return data.brands
    .map((entry: unknown) =>
      typeof entry === 'object' && entry !== null
        ? (entry as { brand?: unknown }).brand
        : undefined
    )
    .filter((brand): brand is string => typeof brand === 'string')
}

// The running browser's family: null on SSR (no navigator) and on every
// browser the extension doesn't ship for. Reads navigator, so callers
// must resolve it in an effect, never during render.
export function currentExtensionBrowserFamily(): ExtensionBrowserFamily | null {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.userAgent !== 'string'
  ) {
    return null
  }
  return extensionBrowserFamily(navigator.userAgent, currentBrands())
}

// The store listing for a browser family — null while that listing isn't
// live, which is what keeps a family non-capable until its URL ships.
function extensionInstallUrlFor(
  family: ExtensionBrowserFamily
): string | null {
  switch (family) {
    case 'chrome':
      return EXTENSION_INSTALL_URL
    case 'firefox':
      return FIREFOX_EXTENSION_INSTALL_URL
    default: {
      const exhaustive: never = family
      return exhaustive
    }
  }
}

// Store URL matching the running browser: null on SSR (no navigator), on
// browsers the extension doesn't ship for, and on a desktop browser whose
// listing isn't live yet — exactly the cases where an install CTA would
// be a dead link.
export function currentExtensionInstallUrl(): string | null {
  const family = currentExtensionBrowserFamily()
  return family === null ? null : extensionInstallUrlFor(family)
}

// Capable means this browser could complete an install right now: a
// desktop family the extension ships for AND that family's store listing
// is live. Desktop Firefox before the AMO listing ships is deliberately
// not capable — it keeps the pass-through behavior (no wall, no dead CTA).
export function isExtensionCapableBrowser(): boolean {
  return currentExtensionInstallUrl() !== null
}

export type ExtensionGateVerdict = 'allow' | 'install'

export interface ExtensionGateInput {
  /** Feature switch — false while no store listing is live
   *  (isExtensionInstallEnabled). */
  enabled: boolean
  signedIn: boolean
  /** From onboarding metadata.account_type; anything but a literal
   *  'team' counts as solo. */
  accountType: 'solo' | 'team'
  /** From onboarding metadata.count_mode. 'tokens' accounts measure burn
   *  through the agent CLI, not the browser, so the wall never applies to
   *  them. Null (unset — every pre-redesign account) gates as a browser
   *  account, the strict default. */
  countMode: CountMode | null
  capableBrowser: boolean
  /** Live postMessage handshake result; only consulted on capable browsers. */
  detected: boolean
  /** Account ever linked (last_extension_sync / active_device_uuid).
   *  Deliberately unused by the verdict — capable browsers need the live
   *  handshake and non-capable ones are never gated — but kept in the
   *  input so tests can pin that linkage never changes the answer. */
  linked: boolean
}

// One decision shared by both enforcement points — the (app) ExtensionGate
// and /welcome — so they can never disagree and bounce a user in a loop.
// Team buyer accounts are never walled: they track nothing (checkout
// already leaves the wizard), so demanding the tracker would gate them
// on software they have no use for. Affiliated pilots sign up solo and
// still hit the wall. Tokens-only accounts are never walled either: they
// asked Cribble to count agent tokens (CLI), not browser time, so the
// extension is software they have no use for — 'browser' and 'both' still
// need it. Capable browsers must pass the live handshake
// (this is what catches "I removed the extension"; past linkage doesn't
// count). Browsers that can't install the extension are never gated:
// capable means a desktop browser whose store listing is live (Google
// Chrome today, Firefox once its AMO URL ships), so an install wall would
// hand everyone else — Safari, Edge and the other Chromium forks, mobile,
// a desktop Firefox before its listing exists — a task the extension
// isn't published for: a signed-in user who never linked would be locked
// on /welcome forever behind a dead CTA. They pass through instead; phone
// users get the one-time desktop-only notice
// (shouldShowMobileExtensionNotice below) so they know why nothing is
// tracking.
export function evaluateExtensionGate(
  input: ExtensionGateInput
): ExtensionGateVerdict {
  if (!input.enabled || !input.signedIn) return 'allow'
  if (input.accountType === 'team') return 'allow'
  if (input.countMode === 'tokens') return 'allow'
  if (input.capableBrowser) return input.detected ? 'allow' : 'install'
  return 'allow'
}

export interface MobileExtensionNoticeInput {
  /** Feature switch — false while no store listing is live
   *  (isExtensionInstallEnabled). */
  enabled: boolean
  signedIn: boolean
  capableBrowser: boolean
  /** Coarse-pointer device, computed in an effect (matchMedia is
   *  browser-only and 'use client' components still server-render). */
  mobileViewport: boolean
  /** Per-user localStorage flag — true once the notice was acknowledged. */
  dismissed: boolean
}

// The one-time "extension is desktop-only" notice for phone users. Purely
// informational: evaluateExtensionGate above already lets non-capable
// browsers straight through, this just tells them why nothing is tracking.
// Capable browsers never see it (they get the real install gate),
// non-capable desktops (Safari, or a Firefox before its listing ships)
// skip it too (the copy is written for phones), and it never shows signed
// out — the dismiss flag is keyed by user id, so without a user there'd
// be no way to make GOT IT stick.
export function shouldShowMobileExtensionNotice(
  input: MobileExtensionNoticeInput
): boolean {
  return (
    input.enabled &&
    input.signedIn &&
    !input.capableBrowser &&
    input.mobileViewport &&
    !input.dismissed
  )
}
