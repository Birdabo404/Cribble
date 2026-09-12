import { describe, expect, it } from 'vitest'
import type { ExtensionIdentity } from '@/lib/extensionBridge'
import {
  deriveExtensionPhase,
  isLinked,
  type ExtensionPhase,
  type ExtensionPhaseInput
} from './extensionPhase'

const LINKED_IDENTITY: ExtensionIdentity = {
  deviceUuid: 'device-abc',
  isRegistered: true,
  hasSyncToken: true,
  userId: 42
}

// The CTA unlocks on linked, not on detected, so every way an identity
// can fall short of linked is a way a user could otherwise reach the
// dashboard with an extension that will never sync. Each is pinned.
describe('isLinked', () => {
  const cases: {
    name: string
    identity: ExtensionIdentity | null
    userId: number | null
    linked: boolean
  }[] = [
    {
      name: 'no identity yet',
      identity: null,
      userId: 42,
      linked: false
    },
    {
      name: 'detected but never registered',
      identity: { ...LINKED_IDENTITY, isRegistered: false, userId: null, hasSyncToken: false },
      userId: 42,
      linked: false
    },
    {
      // A registered device without a token has its uploads rejected;
      // the dashboard re-registers in that case and so must the wizard.
      name: 'registered without a sync token',
      identity: { ...LINKED_IDENTITY, hasSyncToken: false },
      userId: 42,
      linked: false
    },
    {
      // Shared machine, or a previous account in this browser profile.
      name: 'registered to a different user',
      identity: { ...LINKED_IDENTITY, userId: 7 },
      userId: 42,
      linked: false
    },
    {
      name: 'registered with no user id on the extension side',
      identity: { ...LINKED_IDENTITY, userId: null },
      userId: 42,
      linked: false
    },
    {
      // Onboarding status not loaded: nothing to compare the binding to.
      name: 'session user id unknown',
      identity: LINKED_IDENTITY,
      userId: null,
      linked: false
    },
    {
      name: 'registered, tokened, bound to this user',
      identity: LINKED_IDENTITY,
      userId: 42,
      linked: true
    }
  ]

  for (const c of cases) {
    it(`${c.name} reads as ${c.linked ? 'linked' : 'not linked'}`, () => {
      expect(isLinked(c.identity, c.userId)).toBe(c.linked)
    })
  }
})

describe('deriveExtensionPhase', () => {
  const base: ExtensionPhaseInput = {
    detected: false,
    identity: null,
    userId: 42,
    pinAcknowledged: false
  }

  const cases: {
    name: string
    input: Partial<ExtensionPhaseInput>
    phase: ExtensionPhase
  }[] = [
    {
      name: 'nothing detected',
      input: {},
      phase: 'install'
    },
    {
      // detected is the hook's latch; a stale identity without it must
      // not skip the install step.
      name: 'identity present but detected flag off',
      input: { identity: LINKED_IDENTITY },
      phase: 'install'
    },
    {
      name: 'detected but unregistered',
      input: {
        detected: true,
        identity: { ...LINKED_IDENTITY, isRegistered: false, userId: null, hasSyncToken: false }
      },
      phase: 'link'
    },
    {
      name: 'detected with a detached identity (handshake answered null)',
      input: { detected: true, identity: null },
      phase: 'link'
    },
    {
      name: 'registered without a sync token',
      input: { detected: true, identity: { ...LINKED_IDENTITY, hasSyncToken: false } },
      phase: 'link'
    },
    {
      name: 'registered to a different user',
      input: { detected: true, identity: { ...LINKED_IDENTITY, userId: 7 } },
      phase: 'link'
    },
    {
      name: 'linked but session user id unknown',
      input: { detected: true, identity: LINKED_IDENTITY, userId: null },
      phase: 'link'
    },
    {
      name: 'linked, pin not acknowledged',
      input: { detected: true, identity: LINKED_IDENTITY },
      phase: 'pin'
    },
    {
      name: 'linked and pin acknowledged',
      input: { detected: true, identity: LINKED_IDENTITY, pinAcknowledged: true },
      phase: 'signal'
    },
    {
      // Acknowledging the pin can never carry a stage past a link that
      // isn't there — the extension's word outranks the user's.
      name: 'pin acknowledged but not linked',
      input: {
        detected: true,
        identity: { ...LINKED_IDENTITY, isRegistered: false, hasSyncToken: false },
        pinAcknowledged: true
      },
      phase: 'link'
    },
    {
      name: 'pin acknowledged but nothing detected',
      input: { pinAcknowledged: true },
      phase: 'install'
    }
  ]

  for (const c of cases) {
    it(`${c.name} derives ${c.phase}`, () => {
      expect(deriveExtensionPhase({ ...base, ...c.input })).toBe(c.phase)
    })
  }
})
