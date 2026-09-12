// The extension stage's phase machine, kept pure so its edges can be
// pinned in vitest without a browser. The stage advances on what the
// extension reports through the handshake, never on the user claiming a
// step — the one exception is PIN, which no handshake can observe, so it
// is the one acknowledged phase.
import type { ExtensionIdentity } from '@/lib/extensionBridge'

export type ExtensionPhase = 'install' | 'link' | 'pin' | 'signal'

// Linked means the extension is bound to this account and can actually
// sync: registered, holding a sync token (a registered device without
// one has its uploads rejected), and bound to the signed-in user rather
// than whoever used this browser profile before. A null userId means the
// onboarding status hasn't landed, which is not evidence of a link.
export function isLinked(
  identity: ExtensionIdentity | null,
  userId: number | null
): boolean {
  if (identity === null || userId === null) return false
  return (
    identity.isRegistered &&
    identity.hasSyncToken &&
    identity.userId === userId
  )
}

export interface ExtensionPhaseInput {
  detected: boolean
  identity: ExtensionIdentity | null
  userId: number | null
  pinAcknowledged: boolean
}

// INSTALL until the handshake answers, LINK until that answer says the
// device is bound to this account, PIN until the user says they pinned
// the toolbar mark, then FIRST SIGNAL. Later phases never regress the
// earlier ones: a missing identity puts the stage back on INSTALL
// whatever was acknowledged, because a pinned mark on an extension that
// is gone counts nothing.
export function deriveExtensionPhase(input: ExtensionPhaseInput): ExtensionPhase {
  if (!input.detected) return 'install'
  if (!isLinked(input.identity, input.userId)) return 'link'
  if (!input.pinAcknowledged) return 'pin'
  return 'signal'
}
