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

export type ExtensionBrowserFamily = 'chromium' | 'firefox'

// Which desktop browser family a UA belongs to, or null for anything the
// extension can't install on. Mobile is out wholesale: mobile Chromium and
// mobile Firefox carry "Mobile"/"Android", and the iOS shells (CriOS,
// FxiOS) are WebKit underneath and carry "Mobile" too. Desktop Safari
// matches neither engine token — its "like Gecko" boilerplate (also in
// every Chrome UA) is not the "Firefox/" token. Pure so tests can pin the
// classification without stubbing navigator or the build env.
export function extensionBrowserFamily(
  ua: string
): ExtensionBrowserFamily | null {
  if (/Mobi|Android/i.test(ua)) return null
  if (/Chrome\//.test(ua)) return 'chromium'
  if (/Firefox\//.test(ua)) return 'firefox'
  return null
}

// The store listing for a browser family — null while that listing isn't
// live, which is what keeps a family non-capable until its URL ships.
function extensionInstallUrlFor(
  family: ExtensionBrowserFamily
): string | null {
  switch (family) {
    case 'chromium':
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
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.userAgent !== 'string'
  ) {
    return null
  }
  const family = extensionBrowserFamily(navigator.userAgent)
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
// still hit the wall. Capable browsers must pass the live handshake
// (this is what catches "I removed the extension"; past linkage doesn't
// count). Browsers that can't install the extension are never gated:
// capable means a desktop browser whose store listing is live (Chrome
// today, Firefox once its AMO URL ships), so an install wall would hand
// everyone else — Safari, mobile, a desktop Firefox before its listing
// exists — a task they cannot complete: a signed-in user who never
// linked would be locked on /welcome forever behind a dead CTA. They
// pass through instead; phone users get the one-time desktop-only notice
// (shouldShowMobileExtensionNotice below) so they know why nothing is
// tracking.
export function evaluateExtensionGate(
  input: ExtensionGateInput
): ExtensionGateVerdict {
  if (!input.enabled || !input.signedIn) return 'allow'
  if (input.accountType === 'team') return 'allow'
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
