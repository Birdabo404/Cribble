import type { ActiveDevice, MeUser } from '@/types/dashboard'

// Chrome Web Store listing URL. Null until the listing is live — every
// install surface (welcome step, dashboard nudge, settings link) hides
// itself when null, so this can ship before store approval.
export const EXTENSION_INSTALL_URL: string | null =
  process.env.NEXT_PUBLIC_EXTENSION_STORE_URL?.trim() || null

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

// The extension only installs on desktop Chromium. Mobile Chromium carries
// "Mobile"/"Android" in the UA, iOS Chrome is a WebKit shell (CriOS — no
// "Chrome/" token), and Safari/Firefox never carry "Chrome/". SSR has no
// navigator, so the server always answers false.
export function isExtensionCapableBrowser(): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.userAgent !== 'string'
  ) {
    return false
  }
  const ua = navigator.userAgent
  return /Chrome\//.test(ua) && !/Mobi|Android/i.test(ua)
}

export type ExtensionGateVerdict = 'allow' | 'install'

export interface ExtensionGateInput {
  /** Feature switch — false while EXTENSION_INSTALL_URL is unset. */
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
// the store listing is desktop-Chromium only, so an install wall would
// hand Safari/Firefox/mobile users a task they cannot complete — a
// signed-in user who never linked would be locked on /welcome forever
// behind a dead CTA. They pass through instead; phone users get the
// one-time desktop-only notice (shouldShowMobileExtensionNotice below)
// so they know why nothing is tracking.
export function evaluateExtensionGate(
  input: ExtensionGateInput
): ExtensionGateVerdict {
  if (!input.enabled || !input.signedIn) return 'allow'
  if (input.accountType === 'team') return 'allow'
  if (input.capableBrowser) return input.detected ? 'allow' : 'install'
  return 'allow'
}

export interface MobileExtensionNoticeInput {
  /** Feature switch — false while EXTENSION_INSTALL_URL is unset. */
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
// Capable browsers never see it (they get the real install gate), desktop
// Safari/Firefox skip it too (the copy is written for phones), and it
// never shows signed out — the dismiss flag is keyed by user id, so
// without a user there'd be no way to make GOT IT stick.
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
