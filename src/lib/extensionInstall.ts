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

// The desktop browsers with a live store listing right now, as a phrase
// copy can drop into a sentence ("Open Cribble on desktop … to install").
// The Chrome entry spells out that any Chromium browser qualifies: Brave,
// Edge, Arc, Opera and Vivaldi all install from the Chrome Web Store, and
// a bare "Chrome" read as an exclusion to users on those. Copy on the
// welcome step and the mobile notice reads this so it can never name a
// store that isn't live.
export function installableBrowserNames(): string {
  const names: string[] = []
  if (EXTENSION_INSTALL_URL !== null) {
    names.push('Chrome (or any Chromium browser)')
  }
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

// Which store the extension installs from on this browser, or null for
// anything else. The 'chrome' family is every desktop Chromium browser,
// not just Google Chrome: Brave, Edge, Arc, Opera, Vivaldi and the rest
// all inherit the "Chrome/" UA token and all install from the Chrome Web
// Store, so they take the same install wall and the same store card.
// Treating them as "not capable" used to drop a signed-in Brave or Edge
// user straight onto a dashboard with nothing tracking. Mobile is out
// wholesale: mobile Chromium and mobile Firefox carry "Mobile"/"Android",
// and the iOS shells (CriOS, FxiOS) are WebKit underneath and carry
// "Mobile" too. Desktop Safari matches neither engine token — its "like
// Gecko" boilerplate (also in every Chrome UA) is not the "Firefox/"
// token. Client Hints brands are deliberately not consulted: no brand
// list changes which store a "Chrome/" browser installs from, and reading
// them is what used to demote Brave. Pure so tests can pin the
// classification without stubbing navigator or the build env.
export function extensionBrowserFamily(ua: string): ExtensionBrowserFamily | null {
  if (/Mobi|Android/i.test(ua)) return null
  if (/Chrome\//.test(ua)) return 'chrome'
  if (/Firefox\//.test(ua)) return 'firefox'
  return null
}

export type ChromiumForkName = 'Brave' | 'Edge' | 'Arc' | 'Opera' | 'Vivaldi'

// The Chromium fork's own name, for the store card's sublabel only
// ("Chrome Web Store · works in Brave") — never for capability, which is
// extensionBrowserFamily's job. Edge, Opera and Vivaldi append their own
// token to the inherited "Chrome/" UA. Brave and Arc ship a UA identical
// to Chrome's and only give themselves away through Client Hints brands.
// Google Chrome itself and any fork not listed here read as null, which
// the card renders as plain Chrome. Pure for the same reason as the
// classifier above.
export function chromiumForkName(
  ua: string,
  brands: readonly string[] = []
): ChromiumForkName | null {
  if (brands.includes('Brave')) return 'Brave'
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/Vivaldi\//.test(ua)) return 'Vivaldi'
  if (brands.includes('Arc')) return 'Arc'
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
  return extensionBrowserFamily(navigator.userAgent)
}

// The running Chromium fork's name for the store card, or null on SSR,
// on Google Chrome itself, and on anything that isn't a listed fork.
// Reads navigator like currentExtensionBrowserFamily, so effect-only.
export function currentChromiumForkName(): ChromiumForkName | null {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.userAgent !== 'string'
  ) {
    return null
  }
  return chromiumForkName(navigator.userAgent, currentBrands())
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
// capable means a desktop browser whose store listing is live (any
// desktop Chromium browser today, Firefox once its AMO URL ships), so an
// install wall would hand everyone else — Safari, mobile, a desktop
// Firefox before its listing exists — a task the extension isn't
// published for: a signed-in user who never linked would be locked on
// /welcome forever behind a dead CTA. They pass through instead; phone
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
